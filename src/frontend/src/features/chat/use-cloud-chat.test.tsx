import { act, render, renderHook, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ChatPanel } from "@/features/chat/chat-panel"
import { useCloudChat } from "@/features/chat/use-cloud-chat"
import { getCloudConversation, listCloudMessages, listCloudConversations, streamCloudMessage,
  type CloudConversation, type CloudMessage, type CloudMessagePage, type CloudStreamDone, type CloudStreamEvent,
} from "@/features/chat/cloud-chat-api"

vi.mock("@/features/chat/cloud-chat-api", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/features/chat/cloud-chat-api")>(),
  getCloudConversation: vi.fn(), listCloudMessages: vi.fn(), streamCloudMessage: vi.fn(), listCloudConversations: vi.fn(),
}))
vi.mock("@/features/auth/auth-context", () => ({ useAuth: () => ({ user: { id: "user-1" }, loading: false, refresh: unauthorized }) }))

const cid = "11111111-1111-4111-8111-111111111111"
const otherId = "22222222-2222-4222-8222-222222222222"
const conversation: CloudConversation = { id: cid, topic: "午饭", title: "午饭", mode: "chat", created_at: "2026-09-08T00:00:00Z", updated_at: "2026-09-08T00:00:00Z", archived_at: null }
function message(sequence: number, conversationId = cid): CloudMessage {
  return { id: `${sequence.toString().padStart(8, "0")}-1111-4111-8111-111111111111`, conversation_id: conversationId,
    sequence_no: sequence, role: sequence % 2 ? "user" : "assistant", content: `消息 ${sequence}`,
    status: "complete", source: "server", created_at: conversation.created_at, updated_at: conversation.updated_at,
    client_request_id: null, reply_to_message_id: null, finish_reason: null, error_code: null }
}
function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error("uninitialized deferred") }
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
const resolved = vi.fn()
const changed = vi.fn()
const unauthorized = vi.fn()
const listMock = vi.mocked(listCloudMessages)
const streamMock = vi.mocked(streamCloudMessage)
function hook(initial = cid) {
  return renderHook(({ route, enabled, userId }) => useCloudChat({ enabled, userId, routeConversationId: route,
    onConversationResolved: resolved, onHistoryChanged: changed, onUnauthorized: unauthorized,
  }), { initialProps: { route: initial, enabled: true, userId: "user-1" } })
}

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  vi.mocked(getCloudConversation).mockImplementation(async (id) => ({ ...conversation, id }))
  listMock.mockResolvedValue({ items: [message(3), message(4)], next_cursor: "older-3" })
  vi.mocked(listCloudConversations).mockResolvedValue({ items: [], next_cursor: null })
})

describe("bounded cloud history", () => {
  it("loads one page, disables duplicate earlier requests and merges by ID in sequence order", async () => {
    const view = hook()
    await waitFor(() => expect(view.result.current.initialLoading).toBe(false))
    expect(listMock).toHaveBeenCalledOnce()
    expect(view.result.current.state.phase).toBe("idle")
    const older = deferred<CloudMessagePage>()
    listMock.mockReturnValueOnce(older.promise)
    let loading: Promise<boolean> | undefined
    act(() => { loading = view.result.current.loadEarlier(); void view.result.current.loadEarlier() })
    expect(view.result.current.loadingEarlier).toBe(true)
    expect(listMock).toHaveBeenCalledTimes(2)
    await act(async () => { older.resolve({ items: [message(2), message(1), message(2), message(3)], next_cursor: null }); await loading })
    expect(view.result.current.state.messages.map((item) => item.content)).toEqual(["消息 1", "消息 2", "消息 3", "消息 4"])
    expect(view.result.current.nextCursor).toBeNull()
  })

  it("retains visible messages and retries the same cursor after failure", async () => {
    const view = hook()
    await waitFor(() => expect(view.result.current.initialLoading).toBe(false))
    listMock.mockRejectedValueOnce(new Error("offline"))
    await act(async () => { await view.result.current.loadEarlier() })
    expect(view.result.current.state.messages).toHaveLength(2)
    expect(view.result.current.nextCursor).toBe("older-3")
    expect(view.result.current.earlierError).toBe("offline")
    listMock.mockResolvedValueOnce({ items: [message(1), message(2)], next_cursor: null })
    await act(async () => { await view.result.current.loadEarlier() })
    expect(listMock.mock.calls.slice(1).map((call) => call[2])).toEqual(["older-3", "older-3"])
    expect(view.result.current.state.messages).toHaveLength(4)
  })

  it.each(["repeat", "cycle", "invalid", "no-progress"])("rejects %s pagination without clearing or advancing", async (kind) => {
    const view = hook()
    await waitFor(() => expect(view.result.current.initialLoading).toBe(false))
    if (kind === "cycle") {
      listMock.mockResolvedValueOnce({ items: [message(2)], next_cursor: "older-2" })
      await act(async () => { await view.result.current.loadEarlier() })
    }
    const cursor = view.result.current.nextCursor
    const previous = view.result.current.state.messages
    listMock.mockResolvedValueOnce(kind === "invalid" ? { items: [], next_cursor: "unexpected" } :
      { items: [message(kind === "no-progress" ? 4 : 1)], next_cursor: kind === "no-progress" ? null : "older-3" })
    await act(async () => { expect(await view.result.current.loadEarlier()).toBe(false) })
    expect(view.result.current.nextCursor).toBe(cursor)
    expect(view.result.current.state.messages).toEqual(previous)
    expect(view.result.current.earlierError).toBeTruthy()
  })

  it.each(["route", "logout", "account", "unmount"])("cancels initial history and isolates late responses on %s", async (action) => {
    const old = deferred<CloudMessagePage>()
    listMock.mockReturnValueOnce(old.promise)
    const view = hook()
    await waitFor(() => expect(listMock).toHaveBeenCalledOnce())
    const signal = listMock.mock.calls[0]?.[1]
    if (action === "unmount") view.unmount()
    else {
      listMock.mockResolvedValueOnce({ items: [message(10, action === "route" ? otherId : cid)], next_cursor: null })
      view.rerender({ route: action === "route" ? otherId : cid, enabled: action !== "logout", userId: action === "account" ? "user-2" : "user-1" })
    }
    expect(signal?.aborted).toBe(true)
    await act(async () => { old.resolve({ items: [message(1)], next_cursor: "old-cursor" }) })
    if (action !== "unmount") {
      await waitFor(() => expect(view.result.current.initialLoading).toBe(false))
      expect(view.result.current.state.messages.some((item) => item.content === "消息 1")).toBe(false)
      expect(view.result.current.nextCursor).toBeNull()
    }
  })

  it("cancels earlier requests when switching conversations", async () => {
    const view = hook()
    await waitFor(() => expect(view.result.current.initialLoading).toBe(false))
    const old = deferred<CloudMessagePage>()
    listMock.mockReturnValueOnce(old.promise)
    act(() => { void view.result.current.loadEarlier() })
    const signal = listMock.mock.calls[1]?.[1]
    listMock.mockResolvedValueOnce({ items: [message(8, otherId)], next_cursor: null })
    view.rerender({ route: otherId, enabled: true, userId: "user-1" })
    await act(async () => { old.resolve({ items: [message(1)], next_cursor: null }) })
    expect(signal?.aborted).toBe(true)
    await waitFor(() => expect(view.result.current.state.messages.map((item) => item.content)).toEqual(["消息 8"]))
  })

  it.each(["history-first", "stream-first"])("keeps SSE deltas and historical pages when %s completes", async (order) => {
    const view = hook()
    await waitFor(() => expect(view.result.current.initialLoading).toBe(false))
    const older = deferred<CloudMessagePage>()
    const completion = deferred<CloudStreamDone>()
    let emit: ((event: CloudStreamEvent) => void) | undefined
    streamMock.mockImplementation(async (_cid, _content, _request, options) => {
      emit = options.onEvent
      options.onEvent({ event: "start", data: { conversation_id: cid, user_message_id: message(5).id, assistant_message_id: message(6).id } })
      return completion.promise
    })
    listMock.mockReturnValueOnce(older.promise)
    act(() => { void view.result.current.loadEarlier(); view.result.current.setDraft("消息 5") })
    act(() => { void view.result.current.send() })
    act(() => { emit?.({ event: "delta", data: { conversation_id: cid, assistant_message_id: message(6).id, delta: "正在回复" } }) })
    expect(view.result.current.state.messages.at(-1)?.content).toBe("正在回复")
    const finishHistory = async () => { await act(async () => { older.resolve({ items: [message(1), message(2), message(3)], next_cursor: null }) }) }
    const finishStream = async () => { await act(async () => { completion.resolve({ conversation_id: cid, user_message_id: message(5).id, assistant_message: { ...message(6), reply_to_message_id: message(5).id } }) }) }
    if (order === "history-first") {
      await finishHistory()
      expect(view.result.current.state.messages.at(-1)?.content).toBe("正在回复")
      await finishStream()
    } else { await finishStream(); await finishHistory() }
    expect(view.result.current.state.messages.map((item) => item.content)).toEqual([1, 2, 3, 4, 5, 6].map((index) => `消息 ${index}`))
  })

  it("shows initial history loading and retry independently of generation controls", async () => {
    const initial = deferred<CloudMessagePage>()
    listMock.mockReturnValueOnce(initial.promise)
    render(<MemoryRouter initialEntries={[`/chat/${cid}`]}><Routes><Route path="/chat/:conversationId" element={<ChatPanel />} /></Routes></MemoryRouter>)
    expect(screen.getByText("正在加载最近消息…")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "停止生成" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "发送消息" })).toBeDisabled()
    await act(async () => { initial.resolve({ items: [message(3), message(4)], next_cursor: "older" }) })
    await screen.findByText("消息 3")
    listMock.mockRejectedValueOnce(new Error("连接断开"))
    await userEvent.click(screen.getByRole("button", { name: "加载更早消息" }))
    await screen.findByText(/连接断开/)
    expect(screen.getByText("消息 3")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "加载更早消息" })).toBeEnabled()
    expect(screen.queryByRole("button", { name: "停止生成" })).not.toBeInTheDocument()
  })

  it("blocks send after initial failure and retries the initial page", async () => {
    listMock.mockRejectedValueOnce(new Error("初始失败"))
    const view = hook()
    await waitFor(() => expect(view.result.current.initialError).toBe("初始失败"))
    act(() => view.result.current.setDraft("不要创建其他会话"))
    await act(async () => { expect(await view.result.current.send()).toBe(false) })
    expect(streamMock).not.toHaveBeenCalled()
    act(() => view.result.current.reloadHistory())
    await waitFor(() => expect(view.result.current.state.messages).toHaveLength(2))
  })

  it.each(["cancel", "failure"])("recovers the persisted user message after stream %s without losing older pages", async (outcome) => {
    const view = hook()
    await waitFor(() => expect(view.result.current.initialLoading).toBe(false))
    listMock.mockResolvedValueOnce({ items: [message(1), message(2)], next_cursor: null })
    await act(async () => { await view.result.current.loadEarlier() })
    const completion = deferred<CloudStreamDone>()
    let emit: ((event: CloudStreamEvent) => void) | undefined
    streamMock.mockImplementation(async (_id, _content, _key, options) => {
      emit = options.onEvent
      options.onEvent({ event: "start", data: { conversation_id: cid, user_message_id: message(5).id, assistant_message_id: message(6).id } })
      if (outcome === "failure") throw new Error("流式连接断开")
      return completion.promise
    })
    listMock.mockResolvedValueOnce({ items: [message(3), message(4), message(5), { ...message(6), status: "cancelled", content: "" }], next_cursor: null })
    act(() => view.result.current.setDraft("消息 5"))
    await act(async () => { void view.result.current.send() })
    if (outcome === "cancel") {
      await act(async () => view.result.current.stop())
      await act(async () => {
        emit?.({ event: "delta", data: { conversation_id: cid, assistant_message_id: message(6).id, delta: "忽略迟到内容" } })
        completion.resolve({ conversation_id: cid, user_message_id: message(5).id, assistant_message: message(6) })
      })
    }
    await waitFor(() => expect(view.result.current.initialLoading).toBe(false))
    expect(view.result.current.state.messages.map((item) => item.content)).toEqual([1, 2, 3, 4, 5].map((index) => `消息 ${index}`))
  })
})

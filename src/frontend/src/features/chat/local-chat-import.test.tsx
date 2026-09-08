/// <reference types="node" />
import { webcrypto } from "node:crypto"
import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { LocalChatImport, snapshotImportId } from "@/features/chat/local-chat-import"
import { CHAT_STORAGE_KEY, saveRecentConversation, loadRecentConversation } from "@/features/chat/chat-storage"
import { importCloudConversation, getCloudConversation, listCloudMessages, type CloudConversation, type CloudMessage } from "@/features/chat/cloud-chat-api"
import type { ChatConversation } from "@/types/chat"

vi.mock("@/features/chat/cloud-chat-api", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/features/chat/cloud-chat-api")>(),
  importCloudConversation: vi.fn(), getCloudConversation: vi.fn(), listCloudMessages: vi.fn(),
}))

const local: ChatConversation = {
  conversation_id: "guest", topic: "食堂", mode: "chat", updated_at: "2026-09-08T00:00:00Z",
  messages: [{ role: "user", content: "<img src=x onerror=alert(1)>午饭" }, { role: "assistant", content: "面条" }],
}
const cloud: CloudConversation = {
  id: "11111111-1111-4111-8111-111111111111", mode: "chat", topic: "食堂", title: "午饭",
  created_at: local.updated_at, updated_at: local.updated_at, archived_at: null,
}
const messages: CloudMessage[] = local.messages.map((message, index) => ({
  ...message, id: `${index + 2}1111111-1111-4111-8111-111111111111`, conversation_id: cloud.id,
  sequence_no: index + 1, source: "client_import", status: "complete", client_request_id: null,
  reply_to_message_id: null, finish_reason: null, error_code: null,
  created_at: local.updated_at, updated_at: local.updated_at,
}))
const onOpen = vi.fn()
const onHistoryChanged = vi.fn()
const importMock = vi.mocked(importCloudConversation)
const readMock = vi.mocked(listCloudMessages)

function entry(userId = "user-1") {
  return <LocalChatImport key={userId} userId={userId} onOpen={onOpen} onHistoryChanged={onHistoryChanged} />
}

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(local))
  vi.stubGlobal("crypto", webcrypto)
  vi.stubGlobal("navigator", Object.defineProperty(Object.create(navigator), "locks", {
    value: { request: async (_name: string, optionsOrAction: unknown, action?: () => unknown) => {
      if (typeof optionsOrAction === "function") return optionsOrAction()
      return action?.()
    } },
  }))
  importMock.mockResolvedValue(cloud)
  vi.mocked(getCloudConversation).mockResolvedValue(cloud)
  readMock.mockResolvedValue({ items: messages, next_cursor: null })
})
afterEach(() => vi.unstubAllGlobals())

describe("explicit local import", () => {
  it("previews plain text and never uploads before confirmation; can skip", async () => {
    const { container } = render(entry())
    expect(screen.getByText("当前本地会话：2 条消息")).toBeInTheDocument()
    expect(container.querySelector("img")).toBeNull()
    expect(importMock).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole("button", { name: "暂不保存" }))
    expect(importMock).not.toHaveBeenCalled()
    expect(loadRecentConversation()).toEqual(local)
  })

  it("opens verified cloud data, updates history and clears only the confirmed copy", async () => {
    render(entry())
    await userEvent.click(screen.getByRole("button", { name: "保存当前本地会话" }))
    await screen.findByText("已保存到云端，并清理对应本地副本。")
    expect(onOpen).toHaveBeenCalledWith(cloud, messages, null)
    expect(onHistoryChanged).toHaveBeenCalledOnce()
    expect(loadRecentConversation()).toBeNull()
    expect(localStorage.length).toBe(0)
  })

  it("preserves a new copy written in another tab while reading the cloud", async () => {
    let finish: ((value: { items: CloudMessage[]; next_cursor: null }) => void) | undefined
    readMock.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    render(entry())
    await userEvent.click(screen.getByRole("button", { name: "保存当前本地会话" }))
    await waitFor(() => expect(readMock).toHaveBeenCalledOnce())
    const changed = { ...local, updated_at: "2026-09-08T01:00:00Z", messages: [...local.messages, { role: "user" as const, content: "晚饭呢" }] }
    await act(async () => { await saveRecentConversation(changed) })
    await act(async () => { finish?.({ items: messages, next_cursor: null }) })
    await waitFor(() => expect(onOpen).toHaveBeenCalledOnce())
    expect(loadRecentConversation()).toEqual(changed)
  })

  it("reuses the same ID after a lost response and refresh, without storing credentials", async () => {
    importMock.mockRejectedValueOnce(new Error("网络中断"))
    const first = render(entry())
    await userEvent.click(screen.getByRole("button", { name: "保存当前本地会话" }))
    await screen.findByText("网络中断")
    const requestId = importMock.mock.calls[0]?.[0].import_request_id
    expect(loadRecentConversation()).toEqual(local)
    first.unmount()
    render(entry())
    await userEvent.click(screen.getByRole("button", { name: "保存当前本地会话" }))
    await waitFor(() => expect(importMock).toHaveBeenCalledTimes(2))
    expect(importMock.mock.calls[1]?.[0].import_request_id).toBe(requestId)
    expect(requestId).toHaveLength(64)
    await waitFor(() => expect(loadRecentConversation()).toBeNull())
    expect(localStorage.length).toBe(0)
  })

  it("isolates stable IDs by user and complete local snapshot", async () => {
    const id = await snapshotImportId("user-1", local)
    expect(await snapshotImportId("user-2", local)).not.toBe(id)
    expect(await snapshotImportId("user-1", { ...local, topic: "晚饭" })).not.toBe(id)
    expect(await snapshotImportId("user-1", { ...local, updated_at: "new revision" })).not.toBe(id)
  })

  it.each(["HTTP 500", "HTTP 401", "响应校验失败"])("preserves local data on %s", async (error) => {
    importMock.mockRejectedValue(new Error(error))
    render(entry())
    await userEvent.click(screen.getByRole("button", { name: "保存当前本地会话" }))
    await screen.findByText(error)
    expect(loadRecentConversation()).toEqual(local)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it.each(["unreadable", "mismatched"])("preserves local data when cloud data is %s", async (failure) => {
    if (failure === "unreadable") readMock.mockRejectedValue(new Error("读取失败"))
    else readMock.mockResolvedValue({ items: [{ ...messages[0], content: "不匹配" }, messages[1]], next_cursor: null })
    render(entry())
    await userEvent.click(screen.getByRole("button", { name: "保存当前本地会话" }))
    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument())
    expect(loadRecentConversation()).toEqual(local)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it.each(["cancel", "unmount", "account"])("aborts and ignores late success after %s", async (action) => {
    let finish: ((value: CloudConversation) => void) | undefined
    importMock.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const view = render(entry())
    await userEvent.click(screen.getByRole("button", { name: "保存当前本地会话" }))
    await waitFor(() => expect(importMock).toHaveBeenCalledOnce())
    expect(screen.getByRole("button", { name: "正在保存并核对…" })).toBeDisabled()
    const signal = importMock.mock.calls[0]?.[1]
    if (action === "cancel") await userEvent.click(screen.getByRole("button", { name: "取消保存" }))
    else if (action === "unmount") view.unmount()
    else view.rerender(entry("user-2"))
    expect(signal?.aborted).toBe(true)
    await act(async () => { finish?.(cloud) })
    expect(onOpen).not.toHaveBeenCalled()
    expect(onHistoryChanged).not.toHaveBeenCalled()
    expect(loadRecentConversation()).toEqual(local)
    if (action === "account") expect(screen.getByRole("button", { name: "保存当前本地会话" })).toBeEnabled()
  })

  it("explains oversized histories and never silently truncates or uploads", async () => {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify({ ...local, messages: Array.from({ length: 51 }, () => local.messages[0]) }))
    render(entry())
    expect(screen.getByRole("alert")).toHaveTextContent("最多导入 50 条消息")
    expect(screen.getByRole("button", { name: "保存当前本地会话" })).toBeDisabled()
    expect(importMock).not.toHaveBeenCalled()
    expect(loadRecentConversation()?.messages).toHaveLength(51)
  })

  it("retains the local copy if the browser cannot lock cross-tab storage", async () => {
    vi.stubGlobal("navigator", {})
    render(entry())
    await userEvent.click(screen.getByRole("button", { name: "保存当前本地会话" }))
    await waitFor(() => expect(onOpen).toHaveBeenCalledOnce())
    expect(loadRecentConversation()).toEqual(local)
  })
})

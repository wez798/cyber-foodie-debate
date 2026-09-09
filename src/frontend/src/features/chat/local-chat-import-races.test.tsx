/// <reference types="node" />
import { webcrypto } from "node:crypto"
import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { AuthProvider, useAuth } from "@/features/auth/auth-context"
import { AUTH_CHANGED_MESSAGE, AUTH_STORAGE_KEY } from "@/features/auth/auth-sync"
import { CHAT_STORAGE_KEY, loadRecentConversation, saveRecentConversation } from "@/features/chat/chat-storage"
import { LocalChatImport } from "@/features/chat/local-chat-import"
import type { CloudMessage, ConfirmedImportRequest } from "@/features/chat/cloud-chat-api"
import type { ChatConversation } from "@/types/chat"

const a = "11111111-1111-4111-8111-111111111111"
const b = "22222222-2222-4222-8222-222222222222"
const cid = "33333333-3333-4333-8333-333333333333"
const timestamp = "2026-09-09T00:00:00Z"
const snapshot: ChatConversation = {
  conversation_id: "guest", topic: "食堂", mode: "chat", updated_at: timestamp,
  messages: Array.from({ length: 50 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `原始消息 ${i + 1}` })),
}
const cloud = { id: cid, mode: "chat", title: "午饭", topic: "食堂", created_at: timestamp, updated_at: timestamp, archived_at: null }
const onOpen = vi.fn()
const onHistoryChanged = vi.fn()
let owner: string
let saved: ConfirmedImportRequest | undefined
let rows: CloudMessage[]
let loseResponse: boolean
let beforePost: (() => void) | undefined
let afterPost: (() => Promise<void>) | undefined
let duringVerify: (() => Promise<void>) | undefined
let beforeCleanup: (() => void) | undefined
let mismatch: boolean
const requests: string[] = []

function switchCookie(id: string, notify = false) {
  owner = id
  document.cookie = `cfd_csrf=session-${id}; Path=/`
  if (notify) {
    const marker = crypto.randomUUID()
    localStorage.setItem(AUTH_STORAGE_KEY, marker)
    window.dispatchEvent(new StorageEvent("storage", { key: AUTH_STORAGE_KEY, newValue: marker }))
  }
}

function message(content: string, index: number, source: "client_import" | "server" = "client_import"): CloudMessage {
  return { id: crypto.randomUUID(), conversation_id: cid, sequence_no: index + 1,
    role: index % 2 ? "assistant" : "user", content, source, status: "complete",
    client_request_id: null, reply_to_message_id: null, finish_reason: null, error_code: null,
    created_at: timestamp, updated_at: timestamp }
}

function entry() {
  return <LocalChatImport userId={a} onOpen={onOpen} onHistoryChanged={onHistoryChanged} />
}

// Exercise actual apiFetch, request schemas, response parsing, cookies and React effects.
// The real authenticated HTTP/DB boundary is independently covered by integration tests.
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal("crypto", webcrypto)
  localStorage.clear()
  localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(snapshot))
  switchCookie(a)
  saved = undefined; rows = []; loseResponse = false; mismatch = false
  beforePost = undefined; afterPost = undefined; duringVerify = undefined; beforeCleanup = undefined
  requests.length = 0
  vi.stubGlobal("navigator", Object.defineProperty(Object.create(navigator), "locks", {
    value: { request: async (_name: string, options: unknown, action?: () => unknown) => {
      if (typeof options === "function") return options()
      beforeCleanup?.()
      return action?.()
    } },
  }))
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname
    requests.push(path + new URL(url).search)
    if (path.endsWith("/auth/me")) return Response.json({ id: owner, email: `${owner}@example.com`, display_name: null, created_at: timestamp })
    if (path.endsWith("/import")) {
      beforePost?.()
      const body = JSON.parse(String(init.body)) as ConfirmedImportRequest
      if (body.expected_user_id !== owner) return Response.json({ detail: { code: "auth_identity_changed", message: AUTH_CHANGED_MESSAGE } }, { status: 409 })
      if (!saved) { saved = body; rows = body.messages.map((m, i) => message(m.content, i)) }
      else expect(body).toEqual(saved)
      await afterPost?.()
      if (loseResponse) { loseResponse = false; throw new Error("响应丢失") }
      return Response.json(cloud)
    }
    if (path.endsWith("/import/verify")) {
      await duringVerify?.()
      return Response.json({ conversation_id: cid, import_request_id: saved?.import_request_id,
        items: rows.slice(0, 50).map((m, i) => mismatch && i === 0 ? { ...m, content: "损坏" } : m) })
    }
    if (path.endsWith("/messages")) return Response.json({ items: rows.slice(-50), next_cursor: rows.length > 50 ? "earlier" : null })
    if (path.endsWith(cid)) return Response.json(cloud)
    throw new Error(`Unexpected request: ${path}`)
  }))
})
afterEach(() => vi.unstubAllGlobals())

it.each(["stale UI", "after preflight"])("rejects a real cookie change with %s, without changing userId props", async (timing) => {
  render(entry())
  if (timing === "stale UI") switchCookie(b)
  else beforePost = () => switchCookie(b) // After client validation, at transport dispatch.
  await userEvent.click(screen.getByRole("button", { name: "保存当前本地会话" }))
  await screen.findByText(AUTH_CHANGED_MESSAGE)
  expect(saved).toBeUndefined()
  expect(rows).toHaveLength(0)
  expect(loadRecentConversation()).toEqual(snapshot)
  expect(onOpen).not.toHaveBeenCalled()
})

it.each(["post", "verify", "cleanup lock"])("preserves the snapshot when Cookie changes during %s even without a storage event", async (timing) => {
  if (timing === "post") afterPost = async () => { switchCookie(b) }
  if (timing === "verify") duringVerify = async () => { switchCookie(b) }
  if (timing === "cleanup lock") beforeCleanup = () => switchCookie(b)
  render(entry())
  await userEvent.click(screen.getByRole("button", { name: "保存当前本地会话" }))
  await screen.findByText(AUTH_CHANGED_MESSAGE)
  expect(saved?.expected_user_id).toBe(a)
  expect(loadRecentConversation()).toEqual(snapshot)
  expect(onOpen).not.toHaveBeenCalled()
  expect(onHistoryChanged).not.toHaveBeenCalled()
})

it("updates AuthProvider from another tab and ignores the old late response", async () => {
  let release: (() => void) | undefined
  afterPost = () => new Promise<void>((resolve) => { release = resolve })
  function Probe() {
    const { user } = useAuth()
    return <><span>{user?.id}</span>{user && <LocalChatImport key={user.id} userId={user.id} onOpen={onOpen} onHistoryChanged={onHistoryChanged} />}</>
  }
  render(<AuthProvider><Probe /></AuthProvider>)
  await screen.findByText(a)
  await userEvent.click(screen.getByRole("button", { name: "保存当前本地会话" }))
  await waitFor(() => expect(saved).toBeDefined())
  await act(async () => switchCookie(b, true))
  await screen.findByText(b)
  const restores = requests.filter((path) => path.endsWith("/auth/me")).length
  await act(async () => release?.())
  expect(requests.filter((path) => path.endsWith("/auth/me"))).toHaveLength(restores)
  expect(onOpen).not.toHaveBeenCalled()
  expect(loadRecentConversation()).toEqual(snapshot)
  expect(localStorage.getItem(AUTH_STORAGE_KEY)).toMatch(/^[\da-f-]{36}$/)
})

it.each([2, 206])("retries the original 50-message import after %i appends using only bounded verification and the latest page", async (appends) => {
  loseResponse = true
  const first = render(entry())
  await userEvent.click(screen.getByRole("button", { name: "保存当前本地会话" }))
  await screen.findByText("响应丢失")
  const id = saved?.import_request_id
  for (let i = 0; i < appends; i++) rows.push(message(`追加 ${i}`, rows.length, "server"))
  cloud.title = "已经改名"
  first.unmount()
  requests.length = 0
  render(entry())
  await userEvent.click(screen.getByRole("button", { name: "保存当前本地会话" }))
  await screen.findByText("已保存到云端，并清理对应本地副本。")
  expect(saved?.import_request_id).toBe(id)
  expect(rows).toHaveLength(50 + appends)
  expect(requests.filter((path) => path.endsWith("/import/verify"))).toHaveLength(1)
  expect(requests.filter((path) => path.includes("/messages"))).toEqual([`/api/v1/conversations/${cid}/messages?limit=50`])
  expect(onOpen).toHaveBeenCalledWith(cloud, rows.slice(-50), "earlier")
  expect(loadRecentConversation()).toBeNull()
})

it("keeps a concurrently updated full snapshot during original-range verification", async () => {
  const changed = { ...snapshot, updated_at: "new", messages: [...snapshot.messages, { role: "user" as const, content: "另一标签页的新内容" }] }
  duringVerify = async () => { await saveRecentConversation(changed) }
  render(entry())
  await userEvent.click(screen.getByRole("button", { name: "保存当前本地会话" }))
  await waitFor(() => expect(onOpen).toHaveBeenCalledOnce())
  expect(loadRecentConversation()).toEqual(changed)
})

it("keeps the local snapshot when an original message does not match", async () => {
  mismatch = true
  render(entry())
  await userEvent.click(screen.getByRole("button", { name: "保存当前本地会话" }))
  await screen.findByText("未能核对全部导入消息，本地副本已保留")
  expect(loadRecentConversation()).toEqual(snapshot)
  expect(onOpen).not.toHaveBeenCalled()
})

it("keeps the local snapshot on a storage write failure", async () => {
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("storage unavailable") })
  render(entry())
  await userEvent.click(screen.getByRole("button", { name: "保存当前本地会话" }))
  await waitFor(() => expect(onOpen).toHaveBeenCalledOnce())
  expect(loadRecentConversation()).toEqual(snapshot)
  vi.restoreAllMocks()
})

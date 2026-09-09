import { act, renderHook } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"

import { CHAT_STORAGE_KEY, clearImportedConversation, loadRecentConversation, saveRecentConversation } from "@/features/chat/chat-storage"
import { useChat } from "@/features/chat/use-chat"
import type { ChatConversation } from "@/types/chat"

afterEach(() => { localStorage.clear(); vi.unstubAllGlobals() })

it("serializes cross-tab writes with cleanup and synchronizes guest memory on logout", async () => {
  let queue = Promise.resolve<unknown>(undefined)
  vi.stubGlobal("navigator", { locks: { request: (_name: string, optionsOrAction: unknown, action?: () => unknown) => {
    const task = queue.then(() => typeof optionsOrAction === "function" ? optionsOrAction() : action?.())
    queue = task.catch(() => undefined)
    return task
  } } })
  const snapshot: ChatConversation = { conversation_id: "guest", topic: "", mode: "chat", updated_at: "now", messages: [{ role: "user", content: "午饭" }] }
  localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(snapshot))
  const hook = renderHook(({ enabled }) => useChat(enabled), { initialProps: { enabled: false } })
  expect(hook.result.current.state.messages).toHaveLength(1)
  await act(async () => { expect(await clearImportedConversation(snapshot, new AbortController().signal)).toBe(true) })
  hook.rerender({ enabled: true })
  expect(hook.result.current.state.messages).toEqual([])
  const newer = { ...snapshot, topic: "晚饭" }
  await act(async () => {
    await saveRecentConversation(snapshot)
    const clearing = clearImportedConversation(snapshot, new AbortController().signal)
    const writing = saveRecentConversation(newer)
    await Promise.all([clearing, writing])
  })
  expect(loadRecentConversation()).toEqual(newer)
  expect(hook.result.current.state.topic).toBe("晚饭")
})

import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  CHAT_STORAGE_EVENT, CHAT_STORAGE_KEY, clearImportedConversation,
  loadRecentConversation, serializeConversation,
} from "@/features/chat/chat-storage"
import {
  getCloudConversation, importCloudConversation, importHistorySchema, listCloudMessages,
  type CloudConversation, type CloudMessage,
} from "@/features/chat/cloud-chat-api"
import type { ChatConversation } from "@/types/chat"

export async function snapshotImportId(userId: string, snapshot: ChatConversation): Promise<string> {
  if (!crypto.subtle) throw new Error("当前浏览器无法生成稳定导入标识，请使用 HTTPS 或 localhost，本地副本已保留")
  const bytes = new TextEncoder().encode(JSON.stringify([userId, serializeConversation(snapshot)]))
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

interface LocalChatImportProps {
  userId: string
  onOpen: (conversation: CloudConversation, messages: CloudMessage[], nextCursor: string | null) => void
  onHistoryChanged: () => void
}

// Mount with key=userId so account changes dispose all request and UI state.
export function LocalChatImport({ userId, onOpen, onHistoryChanged }: LocalChatImportProps) {
  const [snapshot, setSnapshot] = useState(loadRecentConversation)
  const [busy, setBusy] = useState(false)
  const [skipped, setSkipped] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  useEffect(() => {
    const sync = (event: Event) => {
      if (event instanceof StorageEvent && event.key !== CHAT_STORAGE_KEY && event.key !== null) return
      setSnapshot(loadRecentConversation())
      setSkipped(false)
    }
    window.addEventListener("storage", sync)
    window.addEventListener(CHAT_STORAGE_EVENT, sync)
    return () => {
      controllerRef.current?.abort()
      controllerRef.current = null
      window.removeEventListener("storage", sync)
      window.removeEventListener(CHAT_STORAGE_EVENT, sync)
    }
  }, [userId])

  const validation = snapshot ? importHistorySchema.safeParse({
    import_request_id: "preview", topic: snapshot.topic,
    messages: snapshot.messages.map(({ role, content }) => ({ role, content })),
  }) : null
  const reason = validation && !validation.success ? validation.error.issues[0]?.message : null

  const submit = async () => {
    if (controllerRef.current || !snapshot || !validation?.success) return
    const submitted = snapshot
    const controller = new AbortController()
    controllerRef.current = controller
    setBusy(true)
    setNotice(null)
    try {
      const importRequestId = await snapshotImportId(userId, submitted)
      if (controller.signal.aborted) return
      const request = { ...validation.data, import_request_id: importRequestId }
      const imported = await importCloudConversation(request, controller.signal)
      if (controller.signal.aborted) return
      const [conversation, page] = await Promise.all([
        getCloudConversation(imported.id, controller.signal),
        listCloudMessages(imported.id, controller.signal),
      ])
      if (controller.signal.aborted) return
      if (conversation.id !== imported.id || conversation.mode !== "chat" || conversation.topic !== request.topic) {
        throw new Error("云端会话校验失败，本地副本已保留")
      }
      for (const [index, message] of request.messages.entries()) {
        const saved = page.items.filter((item) => item.sequence_no === index + 1)
        if (saved.length !== 1 || saved[0].conversation_id !== imported.id ||
          saved[0].role !== message.role || saved[0].content !== message.content ||
          saved[0].source !== "client_import" || saved[0].status !== "complete") {
          throw new Error("未能核对全部导入消息，本地副本已保留")
        }
      }
      onOpen(conversation, page.items, page.next_cursor)
      onHistoryChanged()
      const cleared = await clearImportedConversation(submitted, controller.signal)
      if (controller.signal.aborted) return
      setNotice(cleared ? "已保存到云端，并清理对应本地副本。" : "已保存到云端；本地副本已变化或浏览器不支持安全清理，已保留。")
    } catch (error) {
      if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : "保存失败，本地副本已保留")
    } finally {
      if (controllerRef.current === controller && !controller.signal.aborted) {
        controllerRef.current = null
        setBusy(false)
      }
    }
  }

  const cancel = () => {
    controllerRef.current?.abort()
    controllerRef.current = null
    setBusy(false)
    setNotice("已取消，本地副本已保留，可重新保存。")
  }

  return <div className="space-y-2 rounded-md border bg-background p-3 text-xs leading-5">
    {snapshot && snapshot.messages.length > 0 && !skipped && <>
      <p>当前本地会话：{snapshot.messages.length} 条消息</p>
      <p className="line-clamp-3 break-all">{Array.from(snapshot.messages[0].content).slice(0, 100).join("")}</p>
      {reason && <p role="alert" className="text-destructive">无法导入：{reason}。请保留本地副本，不会自动截断。</p>}
      <Button className="w-full" size="sm" onClick={() => void submit()} disabled={busy || Boolean(reason)}>
        {busy ? "正在保存并核对…" : "保存当前本地会话"}
      </Button>
      {busy ? <Button size="sm" variant="ghost" onClick={cancel}>取消保存</Button> :
        <Button size="sm" variant="ghost" onClick={() => setSkipped(true)}>暂不保存</Button>}
    </>}
    {notice && <p role="status">{notice}</p>}
    {skipped && <Button size="sm" variant="ghost" onClick={() => setSkipped(false)}>查看本地会话</Button>}
    {!snapshot && !notice && <p className="text-muted-foreground">没有待保存的本地会话</p>}
  </div>
}

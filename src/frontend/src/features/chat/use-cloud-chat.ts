import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"

import {
  CloudStreamApiError, createClientRequestId, createCloudConversation,
  getCloudConversation, listCloudMessages, mergeCloudMessages, streamCloudMessage,
  validateMessagePage, type CloudConversation, type CloudMessage,
} from "@/features/chat/cloud-chat-api"
import { ApiError } from "@/lib/api-client"
import { AUTH_CHANGE_EVENT } from "@/features/auth/auth-sync"
import type { ChatViewState } from "@/types/chat"

function blankState(): ChatViewState {
  return { conversationId: null, messages: [], mode: "chat", topic: "", updatedAt: null, phase: "idle", error: null }
}

interface PendingTurn {
  userId: string
  assistantId: string
  content: string
  assistantContent: string
}

interface CloudChatOptions {
  enabled: boolean
  userId?: string
  routeConversationId: string | null
  onConversationResolved: (conversationId: string) => void
  onHistoryChanged: () => void
  onUnauthorized: () => void
}

export function useCloudChat({ enabled, userId, routeConversationId, onConversationResolved, onHistoryChanged, onUnauthorized }: CloudChatOptions) {
  const [metadata, setMetadata] = useState(blankState)
  const [messages, setMessages] = useState<CloudMessage[]>([])
  const messagesRef = useRef<CloudMessage[]>([])
  const [pending, setPending] = useState<PendingTurn | null>(null)
  const [draft, setDraft] = useState("")
  const [initialLoading, setInitialLoading] = useState(false)
  const [initialError, setInitialError] = useState<string | null>(null)
  const [earlierError, setEarlierError] = useState<string | null>(null)
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [reloadVersion, setReloadVersion] = useState(0)
  const cursorRef = useRef<string | null>(null)
  const seenCursorsRef = useRef(new Set<string>())
  const streamControllerRef = useRef<AbortController | null>(null)
  const initialControllerRef = useRef<AbortController | null>(null)
  const earlierControllerRef = useRef<AbortController | null>(null)
  const locallyResolvedRef = useRef<{ id: string; userId?: string } | null>(null)

  const replaceMessages = useCallback((items: CloudMessage[]) => {
    messagesRef.current = items
    setMessages(items)
  }, [])
  const advanceCursor = useCallback((cursor: string | null) => {
    cursorRef.current = cursor
    setNextCursor(cursor)
  }, [])
  const cancelRequests = useCallback(() => {
    streamControllerRef.current?.abort()
    initialControllerRef.current?.abort()
    earlierControllerRef.current?.abort()
    streamControllerRef.current = null
    initialControllerRef.current = null
    earlierControllerRef.current = null
  }, [])
  const clearView = useCallback(() => {
    replaceMessages([])
    setMetadata(blankState())
    setPending(null)
    setDraft("")
    setInitialLoading(false)
    setLoadingEarlier(false)
    setInitialError(null)
    setEarlierError(null)
    advanceCursor(null)
    seenCursorsRef.current.clear()
  }, [advanceCursor, replaceMessages])

  useLayoutEffect(() => {
    if (enabled && routeConversationId && locallyResolvedRef.current?.id === routeConversationId && locallyResolvedRef.current.userId === userId) {
      locallyResolvedRef.current = null
      return
    }
    locallyResolvedRef.current = null
    cancelRequests()
    clearView()
    if (!enabled || !routeConversationId) return
    const controller = new AbortController()
    initialControllerRef.current = controller
    setInitialLoading(true)
    void Promise.all([
      getCloudConversation(routeConversationId, controller.signal),
      listCloudMessages(routeConversationId, controller.signal),
    ]).then(([conversation, response]) => {
      if (controller.signal.aborted) return
      if (conversation.id !== routeConversationId) throw new Error("云端会话 ID 不匹配")
      const page = validateMessagePage(response, conversation.id, null)
      replaceMessages(page.items)
      advanceCursor(page.next_cursor)
      setMetadata({ ...blankState(), conversationId: conversation.id, topic: conversation.topic ?? "", updatedAt: conversation.updated_at })
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return
      if (error instanceof ApiError && error.status === 401) onUnauthorized()
      setInitialError(error instanceof Error ? error.message : "加载云端会话失败")
    }).finally(() => {
      if (initialControllerRef.current === controller) {
        initialControllerRef.current = null
        setInitialLoading(false)
      }
    })
    return () => controller.abort()
  }, [enabled, userId, routeConversationId, reloadVersion, onUnauthorized, advanceCursor, cancelRequests, clearView, replaceMessages])

  useEffect(() => cancelRequests, [cancelRequests])
  useEffect(() => {
    const changed = () => { cancelRequests(); clearView() }
    window.addEventListener(AUTH_CHANGE_EVENT, changed)
    return () => window.removeEventListener(AUTH_CHANGE_EVENT, changed)
  }, [cancelRequests, clearView])

  const openImported = useCallback((conversation: CloudConversation, items: CloudMessage[], cursor: string | null) => {
    cancelRequests()
    clearView()
    locallyResolvedRef.current = { id: conversation.id, userId }
    replaceMessages(items)
    advanceCursor(cursor)
    setMetadata({ ...blankState(), conversationId: conversation.id, topic: conversation.topic ?? "", updatedAt: conversation.updated_at })
    onConversationResolved(conversation.id)
  }, [userId, onConversationResolved, advanceCursor, cancelRequests, clearView, replaceMessages])

  const loadEarlier = useCallback(async () => {
    const cursor = cursorRef.current
    const conversationId = metadata.conversationId
    if (!enabled || !conversationId || !cursor || initialControllerRef.current || earlierControllerRef.current) return false
    const controller = new AbortController()
    earlierControllerRef.current = controller
    setLoadingEarlier(true)
    setEarlierError(null)
    try {
      const response = await listCloudMessages(conversationId, controller.signal, cursor)
      if (controller.signal.aborted) return false
      const page = validateMessagePage(response, conversationId, cursor, seenCursorsRef.current)
      const current = messagesRef.current
      if (page.items.length && current.length && page.items[0].sequence_no >= current[0].sequence_no) {
        throw new Error("云端消息分页未返回更早消息")
      }
      const merged = mergeCloudMessages(current, page.items)
      replaceMessages(merged)
      seenCursorsRef.current.add(cursor)
      advanceCursor(page.next_cursor)
      return true
    } catch (error) {
      if (!controller.signal.aborted) {
        if (error instanceof ApiError && error.status === 401) onUnauthorized()
        setEarlierError(error instanceof Error ? error.message : "加载更早消息失败")
      }
      return false
    } finally {
      if (earlierControllerRef.current === controller) {
        earlierControllerRef.current = null
        setLoadingEarlier(false)
      }
    }
  }, [enabled, metadata.conversationId, onUnauthorized, advanceCursor, replaceMessages])

  const setTopic = useCallback((topic: string) => setMetadata((current) => ({ ...current, topic })), [])
  const refreshLatest = useCallback(async (conversationId: string) => {
    const controller = new AbortController()
    initialControllerRef.current?.abort()
    initialControllerRef.current = controller
    setInitialLoading(true)
    try {
      const response = await listCloudMessages(conversationId, controller.signal)
      if (controller.signal.aborted) return
      const page = validateMessagePage(response, conversationId, null)
      replaceMessages(mergeCloudMessages(messagesRef.current, page.items))
      setPending(null)
    } catch (error) {
      if (!controller.signal.aborted) {
        if (error instanceof ApiError && error.status === 401) onUnauthorized()
        setInitialError(error instanceof Error ? error.message : "无法确认云端最新消息，请重试加载历史")
      }
    } finally {
      if (initialControllerRef.current === controller) {
        initialControllerRef.current = null
        setInitialLoading(false)
      }
    }
  }, [onUnauthorized, replaceMessages])
  const send = useCallback(async () => {
    const content = draft.trim()
    if (!enabled || !content || initialLoading || initialError || initialControllerRef.current || streamControllerRef.current) return false
    const controller = new AbortController()
    streamControllerRef.current = controller
    const clientRequestId = createClientRequestId()
    let conversationId = metadata.conversationId
    let userMessageId = `pending-user-${clientRequestId}`
    let assistantMessageId = `pending-assistant-${clientRequestId}`
    setDraft("")
    setPending({ userId: userMessageId, assistantId: assistantMessageId, content, assistantContent: "" })
    setMetadata((current) => ({ ...current, phase: "streaming", error: null }))
    try {
      if (!conversationId) {
        const conversation = await createCloudConversation(metadata.topic.trim() || null, controller.signal)
        if (controller.signal.aborted) return false
        conversationId = conversation.id
        locallyResolvedRef.current = { id: conversation.id, userId }
        setMetadata((current) => ({ ...current, conversationId: conversation.id }))
        onConversationResolved(conversation.id)
      }
      const done = await streamCloudMessage(conversationId, content, clientRequestId, {
        signal: controller.signal,
        onEvent: (event) => {
          if (controller.signal.aborted) return
          if (event.event === "start") {
            userMessageId = event.data.user_message_id
            assistantMessageId = event.data.assistant_message_id
            setPending((current) => current ? { ...current, userId: userMessageId, assistantId: assistantMessageId } : null)
            onHistoryChanged()
          }
          if (event.event === "delta") setPending((current) => current ? { ...current, assistantContent: current.assistantContent + event.data.delta } : null)
        },
      })
      if (controller.signal.aborted) return false
      const assistant = done.assistant_message
      const userMessage: CloudMessage = {
        id: done.user_message_id, conversation_id: conversationId,
        sequence_no: assistant.sequence_no - 1, role: "user", content,
        status: "complete", client_request_id: clientRequestId, reply_to_message_id: null,
        finish_reason: null, error_code: null, source: "server",
        created_at: assistant.created_at, updated_at: assistant.created_at,
      }
      replaceMessages(mergeCloudMessages(
        messagesRef.current.filter((message) => message.id !== userMessage.id && message.id !== assistant.id),
        [userMessage, assistant],
      ))
      setPending(null)
      setMetadata((current) => ({ ...current, updatedAt: assistant.updated_at, phase: "idle", error: null }))
      onHistoryChanged()
      return true
    } catch (error) {
      if (controller.signal.aborted) return false
      if (error instanceof ApiError && error.status === 401) onUnauthorized()
      setDraft(content)
      setMetadata((current) => ({ ...current, phase: "error", error:
        error instanceof CloudStreamApiError && error.retryable ? `${error.message}（可重试）` :
          error instanceof Error ? error.message : "云端对话请求失败",
      }))
      if (conversationId) void refreshLatest(conversationId)
      else setPending(null)
      return false
    } finally {
      if (streamControllerRef.current === controller) streamControllerRef.current = null
    }
  }, [draft, enabled, userId, initialLoading, initialError, metadata, onConversationResolved, onHistoryChanged, onUnauthorized, replaceMessages, refreshLatest])

  const stop = useCallback(() => {
    streamControllerRef.current?.abort()
    streamControllerRef.current = null
    setMetadata((current) => ({ ...current, phase: "idle", error: null }))
    if (metadata.conversationId) void refreshLatest(metadata.conversationId)
    else {
      if (pending) setDraft(pending.content)
      setPending(null)
    }
  }, [metadata.conversationId, pending, refreshLatest])
  const reset = useCallback(() => {
    cancelRequests()
    locallyResolvedRef.current = null
    clearView()
  }, [cancelRequests, clearView])
  const reloadHistory = useCallback(() => setReloadVersion((version) => version + 1), [])

  const displayed = messages.filter((message) => (message.role === "user" || message.status === "complete") &&
    message.id !== pending?.userId && message.id !== pending?.assistantId)
    .map(({ id, role, content }) => ({ id, role, content }))
  if (pending) {
    displayed.push({ id: pending.userId, role: "user", content: pending.content })
    if (metadata.phase === "streaming") displayed.push({ id: pending.assistantId, role: "assistant", content: pending.assistantContent })
  }
  const state = { ...metadata, messages: displayed }
  return { state, draft, setDraft, setTopic, send, stop, reset, openImported,
    initialLoading, initialError, loadingEarlier, earlierError, nextCursor, loadEarlier, reloadHistory }
}

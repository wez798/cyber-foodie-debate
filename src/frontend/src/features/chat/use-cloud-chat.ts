import { useCallback, useEffect, useRef, useState } from "react"

import {
  CloudStreamApiError,
  createClientRequestId,
  createCloudConversation,
  getCloudConversation,
  listAllCloudMessages,
  streamCloudMessage,
} from "@/features/chat/cloud-chat-api"
import { ApiError } from "@/lib/api-client"
import type { ChatMessage, ChatViewState } from "@/types/chat"

function blankState(): ChatViewState {
  return {
    conversationId: null,
    messages: [],
    mode: "chat",
    topic: "",
    updatedAt: null,
    phase: "idle",
    error: null,
  }
}

function pendingAssistant(
  messages: ChatMessage[],
  content: string,
): ChatMessage[] {
  return [...messages, { role: "assistant", content }]
}

interface CloudChatOptions {
  enabled: boolean
  routeConversationId: string | null
  onConversationResolved: (conversationId: string) => void
  onHistoryChanged: () => void
  onUnauthorized: () => void
}

export function useCloudChat({
  enabled,
  routeConversationId,
  onConversationResolved,
  onHistoryChanged,
  onUnauthorized,
}: CloudChatOptions) {
  const [state, setState] = useState<ChatViewState>(blankState)
  const [draft, setDraft] = useState("")
  const streamControllerRef = useRef<AbortController | null>(null)
  const loadControllerRef = useRef<AbortController | null>(null)
  const locallyResolvedRouteRef = useRef<string | null>(null)

  useEffect(() => {
    if (
      enabled &&
      routeConversationId &&
      locallyResolvedRouteRef.current === routeConversationId
    ) {
      locallyResolvedRouteRef.current = null
      return
    }
    streamControllerRef.current?.abort()
    streamControllerRef.current = null
    loadControllerRef.current?.abort()
    if (!enabled || !routeConversationId) {
      setState(blankState())
      return
    }

    const controller = new AbortController()
    loadControllerRef.current = controller
    setState((current) => ({ ...current, phase: "streaming", error: null }))
    void Promise.all([
      getCloudConversation(routeConversationId, controller.signal),
      listAllCloudMessages(routeConversationId, controller.signal),
    ])
      .then(([conversation, cloudMessages]) => {
        if (controller.signal.aborted) return
        const messages: ChatMessage[] = cloudMessages
          .filter(
            (message) =>
              message.role === "user" ||
              (message.role === "assistant" && message.status === "complete"),
          )
          .map((message) => ({
            role: message.role,
            content: message.content,
          }))
        setState({
          conversationId: conversation.id,
          messages,
          mode: "chat",
          topic: conversation.topic ?? "",
          updatedAt: conversation.updated_at,
          phase: "idle",
          error: null,
        })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        if (error instanceof ApiError && error.status === 401) onUnauthorized()
        setState((current) => ({
          ...current,
          phase: "error",
          error: error instanceof Error ? error.message : "加载云端会话失败",
        }))
      })
      .finally(() => {
        if (loadControllerRef.current === controller) {
          loadControllerRef.current = null
        }
      })
    return () => controller.abort()
  }, [enabled, routeConversationId, onUnauthorized])

  const setTopic = useCallback((topic: string) => {
    setState((current) => ({ ...current, topic }))
  }, [])

  const send = useCallback(async () => {
    const content = draft.trim()
    if (!enabled || !content || state.phase === "streaming") return false

    const controller = new AbortController()
    streamControllerRef.current?.abort()
    streamControllerRef.current = controller
    let conversationId = state.conversationId
    let historyAnnounced = false
    const userMessage: ChatMessage = { role: "user", content }
    const outgoingMessages = [...state.messages, userMessage]
    let assistantContent = ""
    setDraft("")
    setState((current) => ({
      ...current,
      messages: pendingAssistant(outgoingMessages, ""),
      phase: "streaming",
      error: null,
    }))

    try {
      if (!conversationId) {
        const conversation = await createCloudConversation(
          state.topic.trim() || null,
          controller.signal,
        )
        if (controller.signal.aborted) return false
        conversationId = conversation.id
        locallyResolvedRouteRef.current = conversation.id
        onConversationResolved(conversation.id)
      }
      setState((current) => ({
        ...current,
        conversationId,
        messages: pendingAssistant(outgoingMessages, ""),
        phase: "streaming",
        error: null,
      }))

      const done = await streamCloudMessage(
        conversationId,
        content,
        createClientRequestId(),
        {
          signal: controller.signal,
          onEvent: (event) => {
            if (event.event === "start" && !historyAnnounced) {
              historyAnnounced = true
              onHistoryChanged()
            }
            if (event.event === "delta") {
              assistantContent += event.data.delta
              setState((current) => ({
                ...current,
                messages: pendingAssistant(
                  outgoingMessages,
                  assistantContent,
                ),
              }))
            }
            if (event.event === "done") {
              assistantContent = event.data.assistant_message.content
            }
          },
        },
      )

      setState((current) => ({
        ...current,
        conversationId,
        messages: [
          ...outgoingMessages,
          { role: "assistant", content: done.assistant_message.content },
        ],
        updatedAt: done.assistant_message.updated_at,
        phase: "idle",
        error: null,
      }))
      onHistoryChanged()
      return true
    } catch (error) {
      if (controller.signal.aborted) {
        if (streamControllerRef.current === controller) {
          setState((current) => ({
            ...current,
            messages: outgoingMessages,
            phase: "idle",
            error: null,
          }))
        }
        return false
      }
      if (error instanceof ApiError && error.status === 401) onUnauthorized()
      setState((current) => ({
        ...current,
        conversationId,
        messages: outgoingMessages,
        phase: "error",
        error:
          error instanceof CloudStreamApiError && error.retryable
            ? `${error.message}（可重试）`
            : error instanceof Error
              ? error.message
              : "云端对话请求失败",
      }))
      return false
    } finally {
      if (streamControllerRef.current === controller) {
        streamControllerRef.current = null
      }
    }
  }, [
    draft,
    enabled,
    state,
    onConversationResolved,
    onHistoryChanged,
    onUnauthorized,
  ])

  const stop = useCallback(() => {
    streamControllerRef.current?.abort()
  }, [])

  const reset = useCallback(() => {
    streamControllerRef.current?.abort()
    streamControllerRef.current = null
    loadControllerRef.current?.abort()
    loadControllerRef.current = null
    setDraft("")
    setState(blankState())
  }, [])

  useEffect(
    () => () => {
      streamControllerRef.current?.abort()
      loadControllerRef.current?.abort()
    },
    [],
  )

  return { state, draft, setDraft, setTopic, send, stop, reset }
}

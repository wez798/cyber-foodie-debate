import { useCallback, useEffect, useRef, useState } from "react"

import { streamChat } from "@/features/chat/chat-api"
import {
  clearRecentConversation,
  CHAT_STORAGE_EVENT,
  CHAT_STORAGE_KEY,
  loadRecentConversation,
  saveRecentConversation,
} from "@/features/chat/chat-storage"
import type { ChatMessage, ChatRequest, ChatViewState } from "@/types/chat"

function initialState(): ChatViewState {
  const restored = loadRecentConversation()
  return {
    conversationId: restored?.conversation_id ?? null,
    messages: restored?.messages ?? [],
    mode: "chat",
    topic: restored?.topic ?? "",
    updatedAt: restored?.updated_at ?? null,
    phase: "idle",
    error: null,
  }
}

function withPendingAssistant(
  messages: ChatMessage[],
  content: string,
): ChatMessage[] {
  return [...messages, { role: "assistant", content }]
}

export function useChat(enabled = true) {
  const [state, setState] = useState<ChatViewState>(initialState)
  const [draft, setDraft] = useState("")
  const controllerRef = useRef<AbortController | null>(null)

  const setTopic = useCallback((topic: string) => {
    setState((current) => ({ ...current, topic }))
  }, [])

  const send = useCallback(async () => {
    const content = draft.trim()
    if (!enabled || !content || state.phase === "streaming") return false

    const controller = new AbortController()
    controllerRef.current?.abort()
    controllerRef.current = controller

    const userMessage: ChatMessage = { role: "user", content }
    const outgoingMessages = [...state.messages.slice(-49), userMessage]
    let assistantContent = ""
    let conversationId = state.conversationId
    setDraft("")
    setState((current) => ({
      ...current,
      messages: withPendingAssistant(outgoingMessages, ""),
      phase: "streaming",
      error: null,
    }))

    const request: ChatRequest = {
      conversation_id: state.conversationId,
      messages: outgoingMessages,
      mode: "chat",
      topic: state.topic.trim() || null,
      metadata: { client: "web", tts_requested: false },
    }

    try {
      const done = await streamChat(request, {
        signal: controller.signal,
        onEvent: (event) => {
          if (controller.signal.aborted) return
          if (event.event === "start") {
            conversationId = event.data.conversation_id
            setState((current) => ({
              ...current,
              conversationId,
            }))
          }
          if (event.event === "delta") {
            assistantContent += event.data.delta
            setState((current) => ({
              ...current,
              messages: withPendingAssistant(
                outgoingMessages,
                assistantContent,
              ),
            }))
          }
          if (event.event === "done") {
            conversationId = event.data.conversation_id
            assistantContent = event.data.message.content
          }
        },
      })

      if (controller.signal.aborted) return false

      const completedMessages = [...outgoingMessages, done.message]
      const updatedAt = new Date().toISOString()
      const resolvedId = conversationId ?? done.conversation_id
      setState((current) => ({
        ...current,
        conversationId: resolvedId,
        messages: completedMessages,
        updatedAt,
        phase: "idle",
        error: null,
      }))
      await saveRecentConversation({
        conversation_id: resolvedId,
        messages: completedMessages,
        mode: "chat",
        topic: state.topic,
        updated_at: updatedAt,
      })
      return true
    } catch (error) {
      if (controller.signal.aborted) {
        if (controllerRef.current === controller) {
          setState((current) => ({
            ...current,
            messages: outgoingMessages,
            phase: "idle",
            error: null,
          }))
        }
        return false
      }
      setState((current) => ({
        ...current,
        messages: outgoingMessages,
        phase: "error",
        error: error instanceof Error ? error.message : "对话请求失败",
      }))
      return false
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null
    }
  }, [draft, state, enabled])

  const stop = useCallback(() => {
    controllerRef.current?.abort()
  }, [])

  const reset = useCallback(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
    void clearRecentConversation()
    setDraft("")
    setState({
      conversationId: null,
      messages: [],
      mode: "chat",
      topic: "",
      updatedAt: null,
      phase: "idle",
      error: null,
    })
  }, [])

  useEffect(() => () => controllerRef.current?.abort(), [])

  useEffect(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
    setState(initialState())
    setDraft("")
  }, [enabled])

  useEffect(() => {
    const sync = (event: Event) => {
      if (event instanceof StorageEvent && event.key !== CHAT_STORAGE_KEY && event.key !== null) return
      if (!controllerRef.current) setState(initialState())
    }
    window.addEventListener("storage", sync)
    window.addEventListener(CHAT_STORAGE_EVENT, sync)
    return () => {
      window.removeEventListener("storage", sync)
      window.removeEventListener(CHAT_STORAGE_EVENT, sync)
    }
  }, [])

  return {
    state,
    draft,
    setDraft,
    setTopic,
    send,
    stop,
    reset,
  }
}

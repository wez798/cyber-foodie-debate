export type ChatMode =
  | "chat"
  | "debate_pro"
  | "debate_con"
  | "judge"
  | "recommend"

export interface ChatMessage {
  role: "user" | "assistant"
  content: string
}

export interface ChatConversation {
  conversation_id: string
  messages: ChatMessage[]
  mode: ChatMode
  topic: string
  updated_at: string
}

export interface ChatRequest {
  conversation_id: string | null
  messages: ChatMessage[]
  mode: ChatMode
  topic: string | null
  metadata: Record<string, unknown>
}

export interface ChatStreamStart {
  conversation_id: string
  mode: ChatMode
  metadata: Record<string, unknown>
}

export interface ChatStreamDelta {
  conversation_id: string
  delta: string
}

export interface ChatStreamDone {
  conversation_id: string
  message: ChatMessage
  finish_reason: string
  tts: {
    status: "not_requested"
    audio_url: null
  }
}

export interface ChatStreamError {
  conversation_id: string
  error: {
    code: string
    message: string
    retryable: boolean
  }
}

export type ChatStreamEvent =
  | { event: "start"; data: ChatStreamStart }
  | { event: "delta"; data: ChatStreamDelta }
  | { event: "done"; data: ChatStreamDone }
  | { event: "error"; data: ChatStreamError }

export type ChatPhase = "idle" | "streaming" | "error"

export interface ChatViewState {
  conversationId: string | null
  messages: ChatMessage[]
  mode: ChatMode
  topic: string
  updatedAt: string | null
  phase: ChatPhase
  error: string | null
}

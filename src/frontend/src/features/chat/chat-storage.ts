import type {
  ChatConversation,
  ChatMessage,
  ChatMode,
} from "@/types/chat"

export const CHAT_STORAGE_KEY = "cyber-foodie-debate:recent-chat"

const CHAT_MODES: ChatMode[] = [
  "chat",
  "debate_pro",
  "debate_con",
  "judge",
  "recommend",
]

function isChatMode(value: unknown): value is ChatMode {
  return typeof value === "string" && CHAT_MODES.some((mode) => mode === value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isMessage(value: unknown): value is ChatMessage {
  return (
    isRecord(value) &&
    (value.role === "user" || value.role === "assistant") &&
    typeof value.content === "string" &&
    value.content.trim().length > 0
  )
}

export function loadRecentConversation(): ChatConversation | null {
  try {
    const raw = window.localStorage.getItem(CHAT_STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (
      !isRecord(parsed) ||
      typeof parsed.conversation_id !== "string" ||
      !Array.isArray(parsed.messages) ||
      !parsed.messages.every(isMessage) ||
      !isChatMode(parsed.mode) ||
      typeof parsed.topic !== "string" ||
      typeof parsed.updated_at !== "string"
    ) {
      return null
    }
    return {
      conversation_id: parsed.conversation_id,
      messages: parsed.messages,
      mode: parsed.mode,
      topic: parsed.topic,
      updated_at: parsed.updated_at,
    }
  } catch {
    return null
  }
}

export function saveRecentConversation(conversation: ChatConversation) {
  try {
    window.localStorage.setItem(
      CHAT_STORAGE_KEY,
      JSON.stringify(conversation),
    )
  } catch {
    // Storage can be unavailable in private browsing or when the quota is full.
  }
}

export function clearRecentConversation() {
  try {
    window.localStorage.removeItem(CHAT_STORAGE_KEY)
  } catch {
    // Keep the in-memory reset usable even if browser storage is unavailable.
  }
}

import { SseParser, type ServerSentEvent } from "@/lib/sse"
import { z } from "zod"
import type {
  ChatRequest,
  ChatStreamDelta,
  ChatStreamDone,
  ChatStreamError,
  ChatStreamEvent,
  ChatStreamStart,
} from "@/types/chat"

const localBackendOrigin = `${window.location.protocol}//${window.location.hostname}:8000`
const CHAT_API_BASE_URL = (
  import.meta.env.VITE_CHAT_API_BASE_URL ?? `${localBackendOrigin}/api`
).replace(/\/$/, "")

interface StreamChatOptions {
  signal: AbortSignal
  onEvent: (event: ChatStreamEvent) => void
}

const chatModeSchema = z.enum([
  "chat",
  "debate_pro",
  "debate_con",
  "judge",
  "recommend",
])

const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(8000),
})

const chatStreamStartSchema: z.ZodType<ChatStreamStart> = z.object({
  conversation_id: z.string().min(1),
  mode: chatModeSchema,
  metadata: z.record(z.string(), z.unknown()),
})

const chatStreamDeltaSchema: z.ZodType<ChatStreamDelta> = z.object({
  conversation_id: z.string().min(1),
  delta: z.string().min(1),
})

const chatStreamDoneSchema: z.ZodType<ChatStreamDone> = z.object({
  conversation_id: z.string().min(1),
  message: chatMessageSchema,
  finish_reason: z.string().min(1),
  tts: z.object({
    status: z.literal("not_requested"),
    audio_url: z.null(),
  }),
})

const chatStreamErrorSchema: z.ZodType<ChatStreamError> = z.object({
  conversation_id: z.string().min(1),
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    retryable: z.boolean(),
  }),
})

const httpErrorSchema = z.object({
  error: z.object({ message: z.string().min(1) }).optional(),
  detail: z.string().min(1).optional(),
})

async function responseError(response: Response) {
  try {
    const body = httpErrorSchema.parse(await response.json())
    return body.error?.message || body.detail || `请求失败（${response.status}）`
  } catch {
    return `请求失败（${response.status}）`
  }
}

function decodeChatEvent(message: ServerSentEvent): ChatStreamEvent | null {
  let data: unknown
  try {
    data = JSON.parse(message.data)
  } catch {
    throw new Error(`无法解析 ${message.event} 事件数据`)
  }

  try {
    switch (message.event) {
      case "start":
        return { event: "start", data: chatStreamStartSchema.parse(data) }
      case "delta":
        return { event: "delta", data: chatStreamDeltaSchema.parse(data) }
      case "done":
        return { event: "done", data: chatStreamDoneSchema.parse(data) }
      case "error":
        return { event: "error", data: chatStreamErrorSchema.parse(data) }
      default:
        return null
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`${message.event} 事件数据格式无效`)
    }
    throw error
  }
}

export async function streamChat(
  request: ChatRequest,
  { signal, onEvent }: StreamChatOptions,
): Promise<ChatStreamDone> {
  const response = await fetch(`${CHAT_API_BASE_URL}/chat/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(request),
    signal,
  })

  if (!response.ok) throw new Error(await responseError(response))
  if (!response.body) throw new Error("浏览器未提供流式响应内容")

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const parser = new SseParser()
  let completed: ChatStreamDone | null = null
  let conversationId: string | null = null
  let terminalReceived = false

  const emit = (messages: ServerSentEvent[]) => {
    for (const message of messages) {
      const event = decodeChatEvent(message)
      if (!event) continue
      if (terminalReceived) {
        throw new Error("对话流在终止事件后仍返回了数据")
      }
      if (event.event === "start") {
        if (conversationId) throw new Error("对话流重复返回了开始事件")
        conversationId = event.data.conversation_id
      } else {
        if (!conversationId) throw new Error("对话流缺少开始事件")
        if (event.data.conversation_id !== conversationId) {
          throw new Error("对话流返回了不匹配的会话 ID")
        }
      }
      if (event.event === "error") {
        terminalReceived = true
        throw new Error(event.data.error.message)
      }
      if (event.event === "done") {
        terminalReceived = true
        completed = event.data
      }
      onEvent(event)
    }
  }

  try {
    while (true) {
      if (signal.aborted) throw new DOMException("请求已取消", "AbortError")
      const { done, value } = await reader.read()
      if (done) break
      emit(parser.push(decoder.decode(value, { stream: true })))
    }
    emit(parser.push(decoder.decode()))
    emit(parser.flush())
    if (!completed) throw new Error("对话流在完成前意外中断")
    return completed
  } catch (error) {
    try {
      await reader.cancel()
    } catch {
      // Preserve the original parsing, stream, or cancellation error.
    }
    throw error
  } finally {
    reader.releaseLock()
  }
}

import { SseParser, type ServerSentEvent } from "@/lib/sse"
import type {
  ChatRequest,
  ChatStreamDone,
  ChatStreamEvent,
} from "@/types/chat"

const CHAT_API_BASE_URL = (
  import.meta.env.VITE_CHAT_API_BASE_URL ?? "http://localhost:8000/api"
).replace(/\/$/, "")

interface StreamChatOptions {
  signal: AbortSignal
  onEvent: (event: ChatStreamEvent) => void
}

async function responseError(response: Response) {
  try {
    const body = (await response.json()) as {
      error?: { message?: string }
      detail?: string
    }
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

  switch (message.event) {
    case "start":
      return { event: "start", data: data as ChatStreamEvent["data"] } as ChatStreamEvent
    case "delta":
      return { event: "delta", data: data as ChatStreamEvent["data"] } as ChatStreamEvent
    case "done":
      return { event: "done", data: data as ChatStreamEvent["data"] } as ChatStreamEvent
    case "error":
      return { event: "error", data: data as ChatStreamEvent["data"] } as ChatStreamEvent
    default:
      return null
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

  const emit = (messages: ServerSentEvent[]) => {
    for (const message of messages) {
      const event = decodeChatEvent(message)
      if (!event) continue
      if (event.event === "error") throw new Error(event.data.error.message)
      if (event.event === "done") completed = event.data
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
  } finally {
    reader.releaseLock()
  }

  if (!completed) throw new Error("对话流在完成前意外中断")
  return completed
}

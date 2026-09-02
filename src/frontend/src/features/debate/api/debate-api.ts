import { SseParser, type ServerSentEvent } from "@/lib/sse"
import type {
  DebateRequest,
  DebateStreamEvent,
  ResultData,
  RoundData,
  SessionStartData,
} from "@/types/debate"

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000/api/v1"
).replace(/\/$/, "")

interface StreamDebateOptions {
  signal: AbortSignal
  onOpen?: () => void
  onEvent: (event: DebateStreamEvent) => void
}

async function responseError(response: Response) {
  try {
    const body = (await response.json()) as { detail?: string }
    return body.detail || `请求失败（${response.status}）`
  } catch {
    return `请求失败（${response.status}）`
  }
}

function decodeDebateEvent(message: ServerSentEvent): DebateStreamEvent | null {
  let payload: unknown
  try {
    payload = JSON.parse(message.data)
  } catch {
    throw new Error(`无法解析 ${message.event} 事件数据`)
  }

  switch (message.event) {
    case "session_start":
      return { event: "session_start", data: payload as SessionStartData }
    case "round":
      return { event: "round", data: payload as RoundData }
    case "result":
      return { event: "result", data: payload as ResultData }
    default:
      return null
  }
}

export async function streamDebate(
  request: DebateRequest,
  { signal, onOpen, onEvent }: StreamDebateOptions,
) {
  const response = await fetch(`${API_BASE_URL}/debate/start-stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  })

  if (!response.ok) throw new Error(await responseError(response))
  if (!response.body) throw new Error("浏览器未提供流式响应内容")
  onOpen?.()

  const parser = new SseParser()
  const decoder = new TextDecoder()
  const reader = response.body.getReader()

  const emit = (messages: ServerSentEvent[]) => {
    for (const message of messages) {
      const event = decodeDebateEvent(message)
      if (event) onEvent(event)
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
}

export async function synthesizeDebateResult(
  sessionId: string,
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({ session_id: sessionId })
  const response = await fetch(
    `${API_BASE_URL}/tts/synthesize-debate-result?${query.toString()}`,
    { method: "POST", signal },
  )

  if (!response.ok) throw new Error(await responseError(response))
  return response.blob()
}

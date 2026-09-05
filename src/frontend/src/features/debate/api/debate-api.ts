import { SseParser, type ServerSentEvent } from "@/lib/sse"
import { z } from "zod"
import type {
  DebateRequest,
  DebateStreamErrorData,
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

const agentPersonaSchema = z.enum(["sichuan_spicy", "cantonese_healthy"])

const debateRoundSchema = z.object({
  round_number: z.number().int().min(1),
  speaker: agentPersonaSchema,
  content: z.string().min(1),
  reasoning: z.string().nullable().optional(),
})

const debateResultSchema = z.object({
  winner: agentPersonaSchema,
  recommendation: z.string().min(1),
  dish_name: z.string().min(1),
  restaurant_suggestion: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1),
})

const sessionStartSchema: z.ZodType<SessionStartData> = z.object({
  session_id: z.string().min(1),
  status: z.literal("running"),
})

const roundDataSchema: z.ZodType<RoundData> = z.object({
  round: debateRoundSchema,
  side: z.enum(["agent_a", "agent_b"]),
})

const resultDataSchema: z.ZodType<ResultData> = z.object({
  session_id: z.string().min(1),
  status: z.literal("completed"),
  rounds: z.array(debateRoundSchema),
  result: debateResultSchema,
})

const debateStreamErrorSchema: z.ZodType<DebateStreamErrorData> = z.object({
  session_id: z.string().min(1),
  status: z.enum(["failed", "timeout"]),
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    retryable: z.boolean(),
  }),
})

const httpErrorSchema = z.object({
  detail: z.string().min(1).optional(),
})

async function responseError(response: Response) {
  try {
    const body = httpErrorSchema.parse(await response.json())
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

  try {
    switch (message.event) {
      case "session_start":
        return { event: "session_start", data: sessionStartSchema.parse(payload) }
      case "round":
        return { event: "round", data: roundDataSchema.parse(payload) }
      case "result":
        return { event: "result", data: resultDataSchema.parse(payload) }
      case "error":
        return { event: "error", data: debateStreamErrorSchema.parse(payload) }
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

export async function streamDebate(
  request: DebateRequest,
  { signal, onOpen, onEvent }: StreamDebateOptions,
): Promise<ResultData> {
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
  let completedResult: ResultData | undefined
  let sessionId: string | undefined
  let terminalReceived = false

  const emit = (messages: ServerSentEvent[]) => {
    for (const message of messages) {
      const event = decodeDebateEvent(message)
      if (!event) continue
      if (terminalReceived) {
        throw new Error("辩论流在终止事件后仍返回了数据")
      }
      if (event.event === "session_start") {
        if (sessionId) throw new Error("辩论流重复返回了会话开始事件")
        sessionId = event.data.session_id
      } else {
        if (!sessionId) throw new Error("辩论流缺少会话开始事件")
        if ("session_id" in event.data && event.data.session_id !== sessionId) {
          throw new Error("辩论流返回了不匹配的会话 ID")
        }
      }
      if (event.event === "round") {
        const expectedSpeaker =
          event.data.side === "agent_a"
            ? request.agent_a_persona
            : request.agent_b_persona
        if (event.data.round.speaker !== expectedSpeaker) {
          throw new Error("辩论轮次的发言方与角色不匹配")
        }
      }
      onEvent(event)
      if (event.event === "error") {
        terminalReceived = true
        throw new Error(event.data.error.message)
      }
      if (event.event === "result") {
        terminalReceived = true
        completedResult = event.data
      }
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
    if (!completedResult) throw new Error("辩论流在返回结果前意外中断")
    return completedResult
  } catch (error) {
    try {
      await reader.cancel()
    } catch {
      // Preserve the original stream or cancellation error.
    }
    throw error
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

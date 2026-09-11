import { afterEach, describe, expect, it, vi } from "vitest"

import { streamDebate } from "@/features/debate/api/debate-api"
import type { DebateRequest } from "@/types/debate"

const request: DebateRequest = {
  preference: {
    口味: "辣",
    预算: "10-20元",
    天气: "晴天",
    忌口: null,
    其他要求: null,
  },
  agent_a_persona: "sichuan_spicy",
  agent_b_persona: "cantonese_healthy",
  max_rounds: 3,
}

const round = {
  round_number: 1,
  speaker: "sichuan_spicy" as const,
  content: "麻辣香锅适合今天。",
}

const result = {
  session_id: "session-1",
  status: "completed" as const,
  rounds: [round],
  result: {
    winner: "sichuan_spicy" as const,
    recommendation: "推荐麻辣香锅。",
    dish_name: "麻辣香锅",
    restaurant_suggestion: "二食堂",
    confidence: 0.8,
  },
}

const encoder = new TextEncoder()

function event(name: string, data: unknown) {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`
}

function streamResponse(body: string) {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(body))
        controller.close()
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("streamDebate", () => {
  it("delivers deltas while the response remains open", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const body = new ReadableStream<Uint8Array>({ start(value) { controller = value } })
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)))
    let firstDelta!: () => void
    const received = new Promise<void>((resolve) => { firstDelta = resolve })
    const onEvent = vi.fn((value) => { if (value.event === "round_delta") firstDelta() })
    const pending = streamDebate(request, { signal: new AbortController().signal, onEvent })
    const data = { round_number: 1, speaker: "sichuan_spicy", side: "agent_a", delta: "麻辣" }
    controller.enqueue(encoder.encode(event("session_start", { session_id: "session-1", status: "running" }) + event("round_delta", data)))
    await received
    expect(onEvent).toHaveBeenLastCalledWith({ event: "round_delta", data })
    controller.enqueue(encoder.encode(event("result", result)))
    controller.close()
    await expect(pending).resolves.toEqual(result)
  })

  it("rejects malformed incremental speech", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse(
      event("session_start", { session_id: "session-1", status: "running" }) +
      event("round_delta", { round_number: 0, speaker: "sichuan_spicy", side: "agent_a", delta: "" }),
    )))
    await expect(streamDebate(request, { signal: new AbortController().signal, onEvent: vi.fn() })).rejects.toThrow("round_delta 事件数据格式无效")
  })
  it("resolves only after a valid result event", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      streamResponse(
        event("session_start", {
          session_id: "session-1",
          status: "running",
        }) + event("result", result),
      ),
    )
    const onEvent = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      streamDebate(request, {
        signal: new AbortController().signal,
        onEvent,
      }),
    ).resolves.toEqual(result)
    expect(onEvent).toHaveBeenCalledTimes(2)
  })

  it("rejects when the stream closes after partial rounds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        streamResponse(
          event("session_start", {
            session_id: "session-1",
            status: "running",
          }) + event("round", { round, side: "agent_a" }),
        ),
      ),
    )

    await expect(
      streamDebate(request, {
        signal: new AbortController().signal,
        onEvent: vi.fn(),
      }),
    ).rejects.toThrow("辩论流在返回结果前意外中断")
  })

  it("rejects a malformed result payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        streamResponse(event("result", { status: "completed" })),
      ),
    )

    await expect(
      streamDebate(request, {
        signal: new AbortController().signal,
        onEvent: vi.fn(),
      }),
    ).rejects.toThrow("result 事件数据格式无效")
  })

  it("rejects a structured backend error instead of completing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        streamResponse(
          event("session_start", {
            session_id: "session-1",
            status: "running",
          }) +
            event("error", {
              session_id: "session-1",
              status: "timeout",
              error: {
                code: "debate_timeout",
                message: "辩论生成超时，请稍后重试",
                retryable: true,
              },
            }),
        ),
      ),
    )

    await expect(
      streamDebate(request, {
        signal: new AbortController().signal,
        onEvent: vi.fn(),
      }),
    ).rejects.toThrow("辩论生成超时，请稍后重试")
  })

  it("rejects data returned after the terminal event", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        streamResponse(
          event("session_start", {
            session_id: "session-1",
            status: "running",
          }) +
            event("result", result) +
            event("round", { round, side: "agent_a" }),
        ),
      ),
    )

    await expect(
      streamDebate(request, {
        signal: new AbortController().signal,
        onEvent: vi.fn(),
      }),
    ).rejects.toThrow("辩论流在终止事件后仍返回了数据")
  })

  it("cancels the response reader when the user aborts", async () => {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({ cancel })
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(body, { status: 200 })),
    )
    const controller = new AbortController()
    controller.abort()

    await expect(
      streamDebate(request, {
        signal: controller.signal,
        onEvent: vi.fn(),
      }),
    ).rejects.toMatchObject({ name: "AbortError" })
    expect(cancel).toHaveBeenCalledOnce()
  })
})

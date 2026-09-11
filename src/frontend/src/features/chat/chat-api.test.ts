import { afterEach, describe, expect, it, vi } from "vitest"

import { streamChat } from "@/features/chat/chat-api"
import type { ChatRequest } from "@/types/chat"

const request: ChatRequest = {
  conversation_id: null,
  messages: [{ role: "user", content: "推荐一道菜" }],
  mode: "chat",
  topic: null,
  metadata: { client: "test" },
}

const done = {
  conversation_id: "conversation-1",
  message: { role: "assistant" as const, content: "推荐番茄鸡蛋面。" },
  finish_reason: "stop",
  tts: { status: "not_requested" as const, audio_url: null },
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

describe("streamChat", () => {
  it("returns a validated completed response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        streamResponse(
          event("start", {
            conversation_id: "conversation-1",
            mode: "chat",
            metadata: { client: "test" },
          }) +
            event("delta", {
              conversation_id: "conversation-1",
              delta: "推荐番茄鸡蛋面。",
            }) +
            event("done", done),
        ),
      ),
    )

    await expect(
      streamChat(request, {
        signal: new AbortController().signal,
        onEvent: vi.fn(),
      }),
    ).resolves.toEqual(done)
  })

  it("rejects when the response ends before done", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        streamResponse(
          event("start", {
            conversation_id: "conversation-1",
            mode: "chat",
            metadata: {},
          }) +
            event("delta", {
              conversation_id: "conversation-1",
              delta: "只有一部分",
            }),
        ),
      ),
    )

    await expect(
      streamChat(request, {
        signal: new AbortController().signal,
        onEvent: vi.fn(),
      }),
    ).rejects.toThrow("对话流在完成前意外中断")
  })

  it("rejects a malformed done event", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        streamResponse(
          event("start", {
            conversation_id: "conversation-1",
            mode: "chat",
            metadata: {},
          }) + event("done", { conversation_id: "conversation-1" }),
        ),
      ),
    )

    await expect(
      streamChat(request, {
        signal: new AbortController().signal,
        onEvent: vi.fn(),
      }),
    ).rejects.toThrow("done 事件数据格式无效")
  })

  it("rejects events from a different conversation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        streamResponse(
          event("start", {
            conversation_id: "conversation-1",
            mode: "chat",
            metadata: {},
          }) + event("done", { ...done, conversation_id: "conversation-2" }),
        ),
      ),
    )

    await expect(
      streamChat(request, {
        signal: new AbortController().signal,
        onEvent: vi.fn(),
      }),
    ).rejects.toThrow("对话流返回了不匹配的会话 ID")
  })

  it("rejects data returned after the terminal event", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        streamResponse(
          event("start", {
            conversation_id: "conversation-1",
            mode: "chat",
            metadata: {},
          }) +
            event("done", done) +
            event("delta", {
              conversation_id: "conversation-1",
              delta: "不应出现",
            }),
        ),
      ),
    )

    await expect(
      streamChat(request, {
        signal: new AbortController().signal,
        onEvent: vi.fn(),
      }),
    ).rejects.toThrow("对话流在终止事件后仍返回了数据")
  })

  it("cancels the response reader after user cancellation", async () => {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({ cancel })
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(body, { status: 200 })),
    )
    const controller = new AbortController()
    controller.abort()

    await expect(
      streamChat(request, {
        signal: controller.signal,
        onEvent: vi.fn(),
      }),
    ).rejects.toMatchObject({ name: "AbortError" })
    expect(cancel).toHaveBeenCalledOnce()
  })
})

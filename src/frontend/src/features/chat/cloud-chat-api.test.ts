import { afterEach, describe, expect, it, vi } from "vitest"

import {
  CloudStreamApiError,
  createClientRequestId,
  listAllCloudMessages,
  streamCloudMessage,
  type CloudMessage,
} from "@/features/chat/cloud-chat-api"

const conversationId = "11111111-1111-4111-8111-111111111111"
const userMessageId = "22222222-2222-4222-8222-222222222222"
const assistantMessageId = "33333333-3333-4333-8333-333333333333"
const encoder = new TextEncoder()

function event(name: string, data: unknown) {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`
}

function response(body: string) {
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

function isRequestInit(value: unknown): value is RequestInit {
  return typeof value === "object" && value !== null && "headers" in value
}

const start = {
  conversation_id: conversationId,
  user_message_id: userMessageId,
  assistant_message_id: assistantMessageId,
}

const done = {
  conversation_id: conversationId,
  user_message_id: userMessageId,
  assistant_message: {
    id: assistantMessageId,
    conversation_id: conversationId,
    sequence_no: 2,
    role: "assistant",
    content: "云端回复",
    status: "complete",
    client_request_id: null,
    reply_to_message_id: userMessageId,
    finish_reason: "stop",
    error_code: null,
    source: "server",
    created_at: "2026-09-06T00:00:00Z",
    updated_at: "2026-09-06T00:00:01Z",
  },
}

function cloudMessage(sequenceNo: number): CloudMessage {
  const id = `${sequenceNo.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`
  return {
    id,
    conversation_id: conversationId,
    sequence_no: sequenceNo,
    role: sequenceNo % 2 === 0 ? "assistant" : "user",
    content: `消息 ${sequenceNo}`,
    status: "complete",
    client_request_id: sequenceNo % 2 === 0 ? null : `request-${sequenceNo}`,
    reply_to_message_id: null,
    finish_reason: sequenceNo % 2 === 0 ? "stop" : null,
    error_code: null,
    source: "server",
    created_at: "2026-09-06T00:00:00Z",
    updated_at: "2026-09-06T00:00:01Z",
  }
}

afterEach(() => {
  document.cookie = "cfd_csrf=; Max-Age=0; Path=/"
  vi.unstubAllGlobals()
})

describe("streamCloudMessage", () => {
  it("validates identifiers and resolves only after done", async () => {
    document.cookie = "cfd_csrf=csrf-value; Path=/"
    const fetchMock = vi.fn().mockResolvedValue(
      response(
        event("start", start) +
          event("delta", {
            conversation_id: conversationId,
            assistant_message_id: assistantMessageId,
            delta: "云端回复",
          }) +
          event("done", done),
      ),
    )
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      streamCloudMessage(conversationId, "问题", "request-1", {
        signal: new AbortController().signal,
        onEvent: vi.fn(),
      }),
    ).resolves.toEqual(done)

    const request: unknown = fetchMock.mock.calls[0]?.[1]
    expect(isRequestInit(request)).toBe(true)
    if (!isRequestInit(request)) throw new Error("fetch init 缺失")
    expect(request.credentials).toBe("include")
    expect(new Headers(request.headers).get("X-CSRF-Token")).toBe("csrf-value")
  })

  it("rejects a stream that ends before done", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response(
          event("start", start) +
            event("delta", {
              conversation_id: conversationId,
              assistant_message_id: assistantMessageId,
              delta: "部分内容",
            }),
        ),
      ),
    )

    await expect(
      streamCloudMessage(conversationId, "问题", "request-2", {
        signal: new AbortController().signal,
        onEvent: vi.fn(),
      }),
    ).rejects.toThrow("云端对话在完成前意外中断")
  })

  it("rejects mismatched assistant identifiers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response(
          event("start", start) +
            event("delta", {
              conversation_id: conversationId,
              assistant_message_id: "44444444-4444-4444-8444-444444444444",
              delta: "非法内容",
            }),
        ),
      ),
    )

    await expect(
      streamCloudMessage(conversationId, "问题", "request-3", {
        signal: new AbortController().signal,
        onEvent: vi.fn(),
      }),
    ).rejects.toThrow("云端对话返回了不匹配的消息 ID")
  })

  it("cancels the response reader after user cancellation", async () => {
    const cancel = vi.fn()
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(new ReadableStream<Uint8Array>({ cancel }), { status: 200 }),
      ),
    )
    const controller = new AbortController()
    controller.abort()

    await expect(
      streamCloudMessage(conversationId, "问题", "request-4", {
        signal: controller.signal,
        onEvent: vi.fn(),
      }),
    ).rejects.toMatchObject({ name: "AbortError" })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it("preserves structured server error details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response(
          event("start", start) +
            event("error", {
              conversation_id: conversationId,
              assistant_message_id: assistantMessageId,
              error: {
                code: "timeout",
                message: "模型响应超时",
                retryable: true,
              },
            }),
        ),
      ),
    )

    const error = await streamCloudMessage(
      conversationId,
      "问题",
      "request-5",
      {
        signal: new AbortController().signal,
        onEvent: vi.fn(),
      },
    ).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(CloudStreamApiError)
    expect(error).toMatchObject({
      message: "模型响应超时",
      code: "timeout",
      retryable: true,
    })
  })
})

describe("cloud message history", () => {
  it("loads every cursor page and restores chronological order", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          items: [cloudMessage(101), cloudMessage(102)],
          next_cursor: "older-page",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          items: [cloudMessage(1), cloudMessage(2)],
          next_cursor: null,
        }),
      )
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      listAllCloudMessages(conversationId, new AbortController().signal),
    ).resolves.toEqual([
      cloudMessage(1),
      cloudMessage(2),
      cloudMessage(101),
      cloudMessage(102),
    ])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("messages?limit=100")
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      "messages?limit=100&cursor=older-page",
    )
  })

  it("creates a backend-compatible idempotency key", () => {
    expect(createClientRequestId()).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/)
  })
})

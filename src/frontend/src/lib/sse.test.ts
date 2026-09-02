import { describe, expect, it } from "vitest"

import { SseParser } from "@/lib/sse"

describe("SseParser", () => {
  it("buffers fragmented chunks until a complete event block arrives", () => {
    const parser = new SseParser()

    expect(parser.push("event: rou")).toEqual([])
    expect(parser.pendingText).toBe("event: rou")

    const events = parser.push(
      "nd\r\ndata: {\"round\":{\"round_number\":1}}\r\n\r\n",
    )

    expect(events).toEqual([
      {
        event: "round",
        data: '{"round":{"round_number":1}}',
        id: undefined,
        retry: undefined,
      },
    ])
    expect(parser.pendingText).toBe("")
  })

  it("supports multiple data lines and multiple events in one chunk", () => {
    const parser = new SseParser()

    const events = parser.push(
      [
        "event: session_start",
        "data: {\"session_id\":",
        "data: \"abc123\"}",
        "",
        "event: result",
        "id: final",
        "retry: 1500",
        "data: {\"status\":\"completed\"}",
        "",
        "",
      ].join("\n"),
    )

    expect(events).toHaveLength(2)
    expect(events[0].data).toBe('{"session_id":\n"abc123"}')
    expect(events[1]).toMatchObject({
      event: "result",
      id: "final",
      retry: 1500,
    })
  })

  it("keeps residual text and flushes it when the stream closes", () => {
    const parser = new SseParser()

    expect(parser.push("event: result\ndata: {\"ok\":true}")).toEqual([])
    expect(parser.pendingText).not.toBe("")
    expect(parser.flush()).toEqual([
      {
        event: "result",
        data: '{"ok":true}',
        id: undefined,
        retry: undefined,
      },
    ])
    expect(parser.pendingText).toBe("")
  })

  it("ignores comments and fields without data", () => {
    const parser = new SseParser()

    expect(parser.push(": keep-alive\nevent: ping\n\n")).toEqual([])
  })
})

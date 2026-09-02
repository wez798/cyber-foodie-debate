import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import App from "@/App"
import { streamDebate } from "@/features/debate/api/debate-api"
import type { DebateStreamEvent } from "@/types/debate"

vi.mock("@/features/debate/api/debate-api", () => ({
  streamDebate: vi.fn(),
  synthesizeDebateResult: vi.fn(),
}))

const streamDebateMock = vi.mocked(streamDebate)

const rounds = Array.from({ length: 6 }, (_, index) => ({
  round_number: Math.floor(index / 2) + 1,
  speaker: index % 2 === 0 ? ("sichuan_spicy" as const) : ("cantonese_healthy" as const),
  content: `第 ${Math.floor(index / 2) + 1} 轮观点 ${index + 1}`,
}))

const completeStream: typeof streamDebate = async (_request, options) => {
  options.onOpen?.()
  const events: DebateStreamEvent[] = [
    {
      event: "session_start",
      data: { session_id: "session-1", status: "running" },
    },
    ...rounds.map(
      (round): DebateStreamEvent => ({
        event: "round",
        data: {
          round,
          side: round.speaker === "sichuan_spicy" ? "agent_a" : "agent_b",
        },
      }),
    ),
    {
      event: "result",
      data: {
        session_id: "session-1",
        status: "completed",
        rounds,
        result: {
          winner: "sichuan_spicy",
          recommendation: "天气凉爽，麻辣香锅更适合今天。",
          dish_name: "麻辣香锅",
          restaurant_suggestion: "学校二食堂",
          confidence: 0.86,
        },
      },
    },
  ]

  for (const event of events) options.onEvent(event)
}

async function fillRequiredFields() {
  const user = userEvent.setup()
  await user.selectOptions(screen.getByLabelText("口味偏好"), "辣")
  await user.selectOptions(screen.getByLabelText("预算范围"), "10-20元")
  return user
}

describe("Cyber Foodie Debate app", () => {
  beforeEach(() => {
    streamDebateMock.mockReset()
  })

  it("shows required validation before starting", async () => {
    render(<App />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "开始三轮辩论" }))

    expect(screen.getByText("请选择口味偏好")).toBeInTheDocument()
    expect(screen.getByText("请选择预算范围")).toBeInTheDocument()
    expect(streamDebateMock).not.toHaveBeenCalled()
  })

  it("disables submission while the stream is pending", async () => {
    streamDebateMock.mockImplementation(
      () => new Promise<void>(() => undefined),
    )
    render(<App />)
    const user = await fillRequiredFields()

    await user.click(screen.getByRole("button", { name: "开始三轮辩论" }))

    expect(screen.getByRole("button", { name: "正在连接赛场" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "取消" })).toBeEnabled()
    await user.click(screen.getByRole("button", { name: "取消" }))
  })

  it("renders six arguments and the structured result", async () => {
    streamDebateMock.mockImplementation(completeStream)
    render(<App />)
    const user = await fillRequiredFields()

    await user.click(screen.getByRole("button", { name: "开始三轮辩论" }))

    expect(await screen.findByText("今日推荐：麻辣香锅")).toBeInTheDocument()
    expect(screen.getByText("86%")).toBeInTheDocument()
    expect(screen.getByText("学校二食堂")).toBeInTheDocument()
    expect(screen.getByText("第 1 轮观点 1")).toBeInTheDocument()
    expect(screen.getByText("第 3 轮观点 6")).toBeInTheDocument()
  })

  it("offers retry after an error and completes on the next attempt", async () => {
    streamDebateMock
      .mockRejectedValueOnce(new Error("服务暂不可用"))
      .mockImplementationOnce(completeStream)
    render(<App />)
    const user = await fillRequiredFields()

    await user.click(screen.getByRole("button", { name: "开始三轮辩论" }))
    expect(await screen.findByText("服务暂不可用")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "重试" }))
    await waitFor(() => expect(streamDebateMock).toHaveBeenCalledTimes(2))
    expect(await screen.findByText("今日推荐：麻辣香锅")).toBeInTheDocument()
  })
})

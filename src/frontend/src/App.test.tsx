import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import App from "@/App"
import { streamDebate, synthesizeDebateResult } from "@/features/debate/api/debate-api"
import type { DebateStreamEvent, ResultData } from "@/types/debate"

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

const completedResult: ResultData = {
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
}

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
      data: completedResult,
    },
  ]

  for (const event of events) options.onEvent(event)
  return completedResult
}

async function fillRequiredFields() {
  const user = userEvent.setup()
  await user.selectOptions(screen.getByLabelText("口味偏好"), "辣")
  await user.selectOptions(screen.getByLabelText("预算范围"), "10-20元")
  return user
}

describe("Cyber Foodie Debate app", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/debate")
    window.localStorage.clear()
    streamDebateMock.mockReset()
  })

  it("renders incremental speech before completion without duplicating the round", async () => {
    let emit: ((event: DebateStreamEvent) => void) | undefined
    let finish: (() => void) | undefined
    streamDebateMock.mockImplementation(async (_request, options) => {
      emit = options.onEvent
      options.onOpen?.()
      options.onEvent({ event: "session_start", data: { session_id: "session-1", status: "running" } })
      await new Promise<void>((resolve) => { finish = resolve })
      return completedResult
    })
    render(<App />)
    const user = await fillRequiredFields()
    await user.click(screen.getByRole("button", { name: "开始三轮辩论" }))
    const delta = { round_number: 1, speaker: "sichuan_spicy" as const, side: "agent_a" as const }
    act(() => emit?.({ event: "round_delta", data: { ...delta, delta: "推荐" } }))
    expect(screen.getByText("推荐")).toBeInTheDocument()
    expect(screen.getByText("0 / 6 条发言")).toBeInTheDocument()
    expect(screen.getByText("发言中")).toBeInTheDocument()
    act(() => emit?.({ event: "round_delta", data: { ...delta, delta: "番茄鸡蛋面。" } }))
    expect(screen.getByText("推荐番茄鸡蛋面。")).toBeInTheDocument()
    act(() => emit?.({ event: "round", data: { side: "agent_a", round: { round_number: 1, speaker: "sichuan_spicy", content: "推荐番茄鸡蛋面。" } } }))
    expect(screen.getAllByText("推荐番茄鸡蛋面。")).toHaveLength(1)
    expect(screen.getByText("1 / 6 条发言")).toBeInTheDocument()
    expect(screen.queryByText("发言中")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "取消" }))
    act(() => emit?.({ event: "round_delta", data: { ...delta, delta: "迟到内容" } }))
    expect(screen.queryByText("迟到内容")).not.toBeInTheDocument()
    await act(async () => finish?.())
  })

  it("switches between separate chat and debate pages", async () => {
    window.history.replaceState(null, "", "/chat")
    render(<App />)
    const user = userEvent.setup()

    expect(await screen.findByText("擂台主持人已就位")).toBeInTheDocument()
    expect(screen.queryByLabelText("口味偏好")).not.toBeInTheDocument()
    const chatTab = screen.getByRole("tab", { name: "自由聊" })
    const debateTab = screen.getByRole("tab", { name: "辩论赛" })
    expect(screen.getAllByRole("tab")).toHaveLength(2)
    expect(chatTab).toHaveAttribute("aria-selected", "true")
    expect(debateTab).toHaveAttribute("aria-selected", "false")

    await user.click(debateTab)

    expect(screen.getByLabelText("口味偏好")).toBeInTheDocument()
    expect(screen.queryByText("擂台主持人已就位")).not.toBeInTheDocument()
    expect(window.location.pathname).toBe("/debate")
    expect(chatTab).toHaveAttribute("aria-selected", "false")
    expect(debateTab).toHaveAttribute("aria-selected", "true")

    const ripple = screen.getByTestId("page-mode-ripple")
    fireEvent.animationEnd(ripple)
    await waitFor(() =>
      expect(screen.queryByTestId("page-mode-ripple")).not.toBeInTheDocument(),
    )

    await user.click(chatTab)
    expect(window.location.pathname).toBe("/chat")
    expect(await screen.findByText("擂台主持人已就位")).toBeInTheDocument()
  })

  it("supports arrow-key page switching", async () => {
    window.history.replaceState(null, "", "/chat")
    render(<App />)
    const user = userEvent.setup()
    const chatTab = screen.getByRole("tab", { name: "自由聊" })
    const debateTab = screen.getByRole("tab", { name: "辩论赛" })

    chatTab.focus()
    await user.keyboard("{ArrowRight}")
    expect(debateTab).toHaveFocus()
    expect(debateTab).toHaveAttribute("aria-selected", "true")
    expect(window.location.pathname).toBe("/debate")

    await user.keyboard("{ArrowLeft}")
    expect(chatTab).toHaveFocus()
    expect(chatTab).toHaveAttribute("aria-selected", "true")
    expect(window.location.pathname).toBe("/chat")
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
      () => new Promise<never>(() => undefined),
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

  it("keeps the result usable when speech synthesis fails", async () => {
    streamDebateMock.mockImplementation(completeStream)
    vi.mocked(synthesizeDebateResult).mockRejectedValueOnce(new Error("语音暂不可用"))
    render(<App />)
    const user = await fillRequiredFields()
    await user.click(screen.getByRole("button", { name: "开始三轮辩论" }))
    await user.click(await screen.findByRole("button", { name: "播放语音战报" }))
    expect(await screen.findByText("语音暂不可用")).toBeInTheDocument()
    expect(screen.getByText("今日推荐：麻辣香锅")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "播放语音战报" })).toBeEnabled()
    await user.click(screen.getByRole("button", { name: "再来一场" }))
    expect(screen.queryByText("今日推荐：麻辣香锅")).not.toBeInTheDocument()
  })

  it("ignores results delivered after cancellation", async () => {
    let finish!: () => void
    streamDebateMock.mockImplementation((_request, options) => new Promise((resolve) => {
      finish = () => { options.onEvent({ event: "result", data: completedResult }); resolve(completedResult) }
    }))
    render(<App />)
    const user = await fillRequiredFields()
    await user.click(screen.getByRole("button", { name: "开始三轮辩论" }))
    await user.click(screen.getByRole("button", { name: "取消" }))
    await act(async () => finish())
    expect(screen.queryByText("今日推荐：麻辣香锅")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "开始三轮辩论" })).toBeEnabled()
  })
})

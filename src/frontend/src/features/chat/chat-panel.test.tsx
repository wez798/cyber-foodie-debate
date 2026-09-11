import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ChatPanel } from "@/features/chat/chat-panel"
import { streamChat } from "@/features/chat/chat-api"
import { CHAT_STORAGE_KEY } from "@/features/chat/chat-storage"
import type { ChatStreamDone } from "@/types/chat"

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }))

vi.mock("@/features/chat/chat-api", () => ({
  streamChat: vi.fn(),
}))
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    refresh: refreshMock,
  }),
}))

const streamChatMock = vi.mocked(streamChat)

function renderChatPanel() {
  return render(
    <MemoryRouter initialEntries={["/chat"]}>
      <ChatPanel />
    </MemoryRouter>,
  )
}

const doneEvent: ChatStreamDone = {
  conversation_id: "conversation-1",
  message: { role: "assistant", content: "麻辣香锅" },
  finish_reason: "stop",
  tts: { status: "not_requested", audio_url: null },
}

describe("chat panel", () => {
  beforeEach(() => {
    window.localStorage.clear()
    streamChatMock.mockReset()
  })

  it("renders deltas and saves only after the full response completes", async () => {
    let finishStream: (() => void) | undefined
    streamChatMock.mockImplementation(async (_request, options) => {
      options.onEvent({
        event: "start",
        data: {
          conversation_id: "conversation-1",
          mode: "chat",
          metadata: {},
        },
      })
      options.onEvent({
        event: "delta",
        data: { conversation_id: "conversation-1", delta: "麻辣" },
      })
      await new Promise<void>((resolve) => {
        finishStream = resolve
      })
      options.onEvent({
        event: "delta",
        data: { conversation_id: "conversation-1", delta: "香锅" },
      })
      options.onEvent({ event: "done", data: doneEvent })
      return doneEvent
    })

    renderChatPanel()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText("聊天消息"), "推荐一道菜")
    await user.click(screen.getByRole("button", { name: "发送消息" }))

    expect(await screen.findByText("麻辣")).toBeInTheDocument()
    expect(window.localStorage.getItem(CHAT_STORAGE_KEY)).toBeNull()

    finishStream?.()

    expect(await screen.findByText("麻辣香锅")).toBeInTheDocument()
    await waitFor(() => {
      const saved = JSON.parse(
        window.localStorage.getItem(CHAT_STORAGE_KEY) ?? "{}",
      )
      expect(saved).toMatchObject({
        conversation_id: "conversation-1",
        mode: "chat",
        topic: "",
        messages: [
          { role: "user", content: "推荐一道菜" },
          { role: "assistant", content: "麻辣香锅" },
        ],
      })
      expect(saved.updated_at).toEqual(expect.any(String))
    })
  })

  it("restores the most recent completed conversation", () => {
    window.localStorage.setItem(
      CHAT_STORAGE_KEY,
      JSON.stringify({
        conversation_id: "restored-conversation",
        messages: [
          { role: "user", content: "想吃清淡的" },
          { role: "assistant", content: "可以试试番茄鸡蛋面。" },
        ],
        mode: "recommend",
        topic: "晚饭",
        updated_at: "2026-09-03T02:00:00.000Z",
      }),
    )

    renderChatPanel()

    expect(screen.getByText("想吃清淡的")).toBeInTheDocument()
    expect(screen.getByText("可以试试番茄鸡蛋面。")).toBeInTheDocument()
    expect(screen.getByLabelText("话题")).toHaveValue("晚饭")
    expect(screen.getByText("会话：restored-conversation")).toBeInTheDocument()
    expect(screen.queryByLabelText("对话模式")).not.toBeInTheDocument()
  })

  it("does not send while Enter confirms a Chinese input composition", async () => {
    renderChatPanel()
    const input = screen.getByLabelText("聊天消息")
    await userEvent.type(input, "午饭")
    fireEvent.keyDown(input, { key: "Enter", isComposing: true, keyCode: 229 })
    expect(streamChatMock).not.toHaveBeenCalled()
    expect(input).toHaveValue("午饭")
  })

  it("retains local history when starting a new guest conversation is cancelled", async () => {
    const snapshot = JSON.stringify({ conversation_id: "guest-1", messages: [{ role: "user", content: "保留这条消息" }],
      mode: "chat", topic: "午饭", updated_at: "2026-09-09T00:00:00Z" })
    localStorage.setItem(CHAT_STORAGE_KEY, snapshot)
    vi.spyOn(window, "confirm").mockReturnValue(false)
    renderChatPanel()
    await userEvent.click(screen.getByRole("button", { name: "新对话" }))
    expect(screen.getByText("保留这条消息")).toBeInTheDocument()
    expect(localStorage.getItem(CHAT_STORAGE_KEY)).toBe(snapshot)
  })
})

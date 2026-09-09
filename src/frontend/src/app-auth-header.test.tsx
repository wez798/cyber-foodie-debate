import { render, screen, within, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import App from "@/App"
import { getCurrentUser, loginUser, logoutUser, registerUser } from "@/features/auth/auth-api"
import { listCloudConversations } from "@/features/chat/cloud-chat-api"

vi.mock("@/features/auth/auth-api", () => ({ getCurrentUser: vi.fn(), loginUser: vi.fn(), registerUser: vi.fn(), logoutUser: vi.fn() }))
vi.mock("@/features/chat/cloud-chat-api", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/features/chat/cloud-chat-api")>(), listCloudConversations: vi.fn(),
}))
const account = { id: "11111111-1111-4111-8111-111111111111", email: "foodie@example.com", display_name: "校园干饭搭子", created_at: "2026-09-08T00:00:00Z" }

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  window.history.replaceState(null, "", "/chat")
  vi.mocked(getCurrentUser).mockRejectedValue(new Error("not signed in"))
  vi.mocked(loginUser).mockResolvedValue(account)
  vi.mocked(registerUser).mockResolvedValue(account)
  vi.mocked(logoutUser).mockResolvedValue()
  vi.mocked(listCloudConversations).mockResolvedValue({ items: [], next_cursor: null })
})

describe("header authentication transitions", () => {
  it.each(["登录", "注册"])("switches after %s and restores links after logout using the existing auth flow", async (mode) => {
    render(<App />)
    const user = userEvent.setup()
    const auth = await screen.findByRole("navigation", { name: "账户" })
    await waitFor(() => expect(within(auth).getByRole("link", { name: mode })).toBeInTheDocument())
    await user.click(within(auth).getByRole("link", { name: mode }))
    await user.type(screen.getByLabelText("邮箱"), account.email)
    await user.type(screen.getByLabelText("密码"), "offline-test-password")
    if (mode === "注册") await user.type(screen.getByLabelText("昵称（选填）"), account.display_name)
    await user.click(screen.getByRole("button", { name: mode === "注册" ? "注册并登录" : "登录" }))
    const username = await screen.findByText(account.display_name)
    expect(screen.getByRole("banner")).toContainElement(username)
    expect(screen.queryByRole("link", { name: "注册" })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "登录" })).not.toBeInTheDocument()
    await user.click(screen.getByRole("tab", { name: "辩论赛" }))
    expect(within(screen.getByRole("banner")).getByRole("button", { name: "退出登录" })).toBeInTheDocument()
    expect(within(screen.getByRole("banner")).queryByText("待开赛")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "退出登录" }))
    await waitFor(() => expect(within(screen.getByRole("navigation", { name: "账户" })).getByRole("link", { name: "登录" })).toBeInTheDocument())
    expect(within(screen.getByRole("navigation", { name: "账户" })).getByRole("link", { name: "注册" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "退出登录" })).not.toBeInTheDocument()
    expect(logoutUser).toHaveBeenCalledOnce()
    expect(window.location.pathname).toBe("/chat")
    expect(mode === "注册" ? registerUser : loginUser).toHaveBeenCalledOnce()
  })
})

import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { AuthPage } from "@/features/auth/auth-page"

const { loginMock, registerMock } = vi.hoisted(() => ({
  loginMock: vi.fn(),
  registerMock: vi.fn(),
}))

vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    login: loginMock,
    register: registerMock,
  }),
}))

function renderPage(mode: "login" | "register") {
  return render(
    <MemoryRouter initialEntries={[`/${mode}`]}>
      <Routes>
        <Route path={`/${mode}`} element={<AuthPage mode={mode} />} />
        <Route path="/chat" element={<p>聊天页</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe("AuthPage", () => {
  beforeEach(() => {
    loginMock.mockReset()
    registerMock.mockReset()
    window.localStorage.clear()
  })

  it("registers without persisting credentials in localStorage", async () => {
    registerMock.mockResolvedValue(undefined)
    renderPage("register")
    const user = userEvent.setup()

    await user.type(screen.getByLabelText("昵称（选填）"), "小厨")
    await user.type(screen.getByLabelText("邮箱"), "cook@example.com")
    await user.type(screen.getByLabelText("密码"), "a secure password")
    await user.click(screen.getByRole("button", { name: "注册并登录" }))

    expect(registerMock).toHaveBeenCalledWith({
      email: "cook@example.com",
      password: "a secure password",
      display_name: "小厨",
    })
    expect(await screen.findByText("聊天页")).toBeInTheDocument()
    expect(window.localStorage.length).toBe(0)
  })

  it("shows a safe login failure", async () => {
    loginMock.mockRejectedValue(new Error("邮箱或密码错误"))
    renderPage("login")
    const user = userEvent.setup()

    await user.type(screen.getByLabelText("邮箱"), "cook@example.com")
    await user.type(screen.getByLabelText("密码"), "wrong")
    await user.click(screen.getByRole("button", { name: "登录" }))

    expect(await screen.findByText("邮箱或密码错误")).toBeInTheDocument()
  })
})

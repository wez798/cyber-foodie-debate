import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"

import { AppHeader } from "@/components/app-header"
import type { PageMode } from "@/components/page-mode-switch"

const account = { id: "11111111-1111-4111-8111-111111111111", email: "foodie@example.com", display_name: "校园干饭搭子", created_at: "2026-09-08T00:00:00Z" }

describe("app header", () => {
  it.each<PageMode>(["chat", "debate"])("groups auth links in the header and hides round/status labels on %s", (page) => {
    render(<MemoryRouter><AppHeader page={page} onPageChange={vi.fn()} user={null} loading={false} onLogout={vi.fn()} /></MemoryRouter>)
    const header = within(screen.getByRole("banner"))
    const auth = within(header.getByRole("navigation", { name: "账户" }))
    expect(auth.getByRole("link", { name: "登录" })).toHaveAttribute("href", "/login")
    expect(auth.getByRole("link", { name: "注册" })).toHaveAttribute("href", "/register")
    expect(header.queryByText("固定 3 轮")).not.toBeInTheDocument()
    expect(header.queryByText("待开赛")).not.toBeInTheDocument()
    expect(header.queryByRole("button", { name: "退出登录" })).not.toBeInTheDocument()
    expect(header.getAllByRole("tab")).toHaveLength(2)
  })

  it("keeps the username and logout action in the account area", async () => {
    const logout = vi.fn()
    render(<MemoryRouter><AppHeader page="chat" onPageChange={vi.fn()} user={account} loading={false} onLogout={logout} /></MemoryRouter>)
    const auth = within(screen.getByRole("navigation", { name: "账户" }))
    expect(auth.getByText(account.display_name)).toHaveAttribute("title", account.display_name)
    expect(auth.queryByRole("link", { name: "登录" })).not.toBeInTheDocument()
    expect(auth.queryByRole("link", { name: "注册" })).not.toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: "退出登录" })).toHaveLength(1)
    await userEvent.click(auth.getByRole("button", { name: "退出登录" }))
    expect(logout).toHaveBeenCalledOnce()
  })

  it("uses the email when the user has no display name", () => {
    render(<MemoryRouter><AppHeader page="debate" onPageChange={vi.fn()} user={{ ...account, display_name: null }} loading={false} onLogout={vi.fn()} /></MemoryRouter>)
    expect(within(screen.getByRole("navigation", { name: "账户" })).getByText(account.email)).toBeInTheDocument()
  })

  it("does not flash signed-out controls while authentication is loading", () => {
    render(<MemoryRouter><AppHeader page="chat" onPageChange={vi.fn()} user={null} loading onLogout={vi.fn()} /></MemoryRouter>)
    const auth = screen.getByRole("navigation", { name: "账户" })
    expect(auth).toHaveAttribute("aria-busy", "true")
    expect(within(auth).queryByRole("link")).not.toBeInTheDocument()
  })
})

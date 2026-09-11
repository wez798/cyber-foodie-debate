import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { AuthProvider, useAuth } from "@/features/auth/auth-context"
import { AUTH_STORAGE_KEY } from "@/features/auth/auth-sync"

const {
  getCurrentUserMock,
  loginUserMock,
  logoutUserMock,
  registerUserMock,
} = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  loginUserMock: vi.fn(),
  logoutUserMock: vi.fn(),
  registerUserMock: vi.fn(),
}))

vi.mock("@/features/auth/auth-api", () => ({
  getCurrentUser: getCurrentUserMock,
  loginUser: loginUserMock,
  logoutUser: logoutUserMock,
  registerUser: registerUserMock,
}))

const restoredUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "restored@example.com",
  display_name: "已恢复",
  created_at: "2026-09-06T00:00:00Z",
}
const loggedInUser = {
  ...restoredUser,
  id: "22222222-2222-4222-8222-222222222222",
  email: "login@example.com",
  display_name: "新登录",
}

function AuthProbe() {
  const { user, loading, login, logout } = useAuth()
  return (
    <div>
      <span>{loading ? "loading" : user?.email ?? "guest"}</span>
      <button
        type="button"
        onClick={() =>
          void login({ email: "login@example.com", password: "password123" })
        }
      >
        login
      </button>
      <button type="button" onClick={() => void logout().catch(() => undefined)}>
        logout
      </button>
    </div>
  )
}

describe("AuthProvider", () => {
  beforeEach(() => {
    getCurrentUserMock.mockReset()
    loginUserMock.mockReset()
    logoutUserMock.mockReset()
    registerUserMock.mockReset()
  })

  it("restores a valid cookie session with /me", async () => {
    getCurrentUserMock.mockResolvedValue(restoredUser)
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    )

    expect(await screen.findByText("restored@example.com")).toBeInTheDocument()
    expect(getCurrentUserMock).toHaveBeenCalledOnce()
  })

  it("clears memory state when /me reports an expired session", async () => {
    getCurrentUserMock.mockRejectedValue(new Error("请先登录"))
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    )

    expect(await screen.findByText("guest")).toBeInTheDocument()
  })

  it("does not let a stale /me response overwrite a newer login", async () => {
    let resolveRestore: ((value: typeof restoredUser) => void) | undefined
    getCurrentUserMock.mockReturnValue(
      new Promise<typeof restoredUser>((resolve) => {
        resolveRestore = resolve
      }),
    )
    loginUserMock.mockResolvedValue(loggedInUser)
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    )

    await userEvent.click(screen.getByRole("button", { name: "login" }))
    expect(await screen.findByText("login@example.com")).toBeInTheDocument()
    await act(async () => resolveRestore?.(restoredUser))
    expect(screen.getByText("login@example.com")).toBeInTheDocument()
  })

  it("clears user state after the server confirms logout", async () => {
    let finishLogout: (() => void) | undefined
    getCurrentUserMock.mockResolvedValue(restoredUser)
    logoutUserMock.mockReturnValue(
      new Promise<void>((resolve) => {
        finishLogout = resolve
      }),
    )
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    )
    expect(await screen.findByText("restored@example.com")).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "logout" }))
    expect(screen.getByText("restored@example.com")).toBeInTheDocument()
    await act(async () => finishLogout?.())
    expect(screen.getByText("guest")).toBeInTheDocument()
  })

  it("keeps the user signed in when logout fails before revocation", async () => {
    getCurrentUserMock.mockResolvedValue(restoredUser)
    logoutUserMock.mockRejectedValue(new Error("network unavailable"))
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    )
    expect(await screen.findByText("restored@example.com")).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "logout" }))
    expect(screen.getByText("restored@example.com")).toBeInTheDocument()
  })

  it("does not let a late logout overwrite another tab's newer login", async () => {
    let finishLogout: (() => void) | undefined
    getCurrentUserMock.mockResolvedValue(restoredUser)
    logoutUserMock.mockReturnValue(new Promise<void>((resolve) => { finishLogout = resolve }))
    render(<AuthProvider><AuthProbe /></AuthProvider>)
    await screen.findByText("restored@example.com")
    await userEvent.click(screen.getByRole("button", { name: "logout" }))
    getCurrentUserMock.mockResolvedValue(loggedInUser)
    await act(async () => window.dispatchEvent(new StorageEvent("storage", { key: AUTH_STORAGE_KEY, newValue: "changed" })))
    await screen.findByText("login@example.com")
    await act(async () => finishLogout?.())
    expect(screen.getByText("login@example.com")).toBeInTheDocument()
  })
})

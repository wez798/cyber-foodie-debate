import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ConversationHistory } from "@/features/chat/conversation-history"

const active = { id: "11111111-1111-4111-8111-111111111111", title: "午饭", mode: "chat", topic: null,
  created_at: "2026-09-09T00:00:00Z", updated_at: "2026-09-09T00:00:00Z", archived_at: null }
const archived = { ...active, id: "22222222-2222-4222-8222-222222222222", title: "昨日晚饭", archived_at: active.created_at }
const page = (items: unknown[], next_cursor: string | null = null) => Response.json({ items, next_cursor })
const callbacks = () => ({ onSelect: vi.fn(), onNew: vi.fn(), onChanged: vi.fn() })

beforeEach(() => {
  document.cookie = "cfd_csrf=history-test; Path=/"
})

describe("cloud history operations", () => {
  it("finds archived conversations through bounded pages and restores them with the existing API", async () => {
    let restored = false
    const requests: { url: string; init?: RequestInit }[] = []
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, init })
      if (init?.method === "PATCH") { restored = true; return Response.json({}) }
      if (url.includes("cursor=older")) return page([archived])
      if (url.includes("include_archived=true")) return page([active], restored ? null : "older")
      return page(restored ? [active, { ...archived, archived_at: null }] : [active])
    }))
    const props = callbacks()
    render(<ConversationHistory activeId={null} refreshVersion={0} {...props} />)
    const user = userEvent.setup()
    await screen.findByText("午饭")
    await user.click(screen.getByRole("button", { name: "已归档" }))
    expect(await screen.findByText("本页暂无归档会话，可加载更多继续查找。")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "加载更多" }))
    await user.click(await screen.findByRole("button", { name: "恢复 昨日晚饭" }))
    await screen.findByText("暂无已归档会话。")
    await user.click(screen.getByRole("button", { name: "最近会话" }))
    await user.click(await screen.findByRole("button", { name: /^昨日晚饭/ }))
    expect(props.onSelect).toHaveBeenCalledWith(archived.id)
    const patch = requests.find((request) => request.init?.method === "PATCH")
    expect(patch?.init?.body).toBe(JSON.stringify({ archived: false }))
    expect(new Headers(patch?.init?.headers).get("X-CSRF-Token")).toBe("history-test")
    expect(requests.filter((request) => request.init?.method === "GET").every((request) => request.url.includes("limit=50"))).toBe(true)
  })

  it("distinguishes loading from empty and offers recovery after a list failure", async () => {
    let resolve!: (value: Response) => void
    const fetchMock = vi.fn().mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done }))
      .mockResolvedValueOnce(page([]))
    vi.stubGlobal("fetch", fetchMock)
    render(<ConversationHistory activeId={null} refreshVersion={0} {...callbacks()} />)
    expect(screen.getByText("正在加载历史…")).toBeInTheDocument()
    expect(screen.queryByText(/暂无云端会话/)).not.toBeInTheDocument()
    await act(async () => resolve(Response.json({ detail: "离线" }, { status: 503 })))
    await userEvent.click(await screen.findByRole("button", { name: "重新加载列表" }))
    expect(await screen.findByText(/暂无云端会话/)).toBeInTheDocument()
  })

  it("ignores a delayed page after changing filters", async () => {
    let resolve!: (value: Response) => void
    vi.stubGlobal("fetch", vi.fn().mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done }))
      .mockResolvedValue(page([archived])))
    render(<ConversationHistory activeId={null} refreshVersion={0} {...callbacks()} />)
    await userEvent.click(screen.getByRole("button", { name: "已归档" }))
    await screen.findByText("昨日晚饭")
    await act(async () => resolve(page([active])))
    expect(screen.queryByText("午饭")).not.toBeInTheDocument()
    expect(screen.getByText("昨日晚饭")).toBeInTheDocument()
  })

  it("prevents duplicate mutations and ignores their completion after unmount", async () => {
    let resolve!: (value: Response) => void
    const fetchMock = vi.fn().mockResolvedValueOnce(page([active]))
      .mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done }))
    vi.stubGlobal("fetch", fetchMock)
    const props = callbacks()
    const view = render(<ConversationHistory activeId={active.id} refreshVersion={0} {...props} />)
    const button = await screen.findByRole("button", { name: "归档 午饭" })
    await userEvent.click(button)
    expect(button).toBeDisabled()
    await userEvent.click(button)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    view.unmount()
    await act(async () => resolve(Response.json({})))
    expect(props.onNew).not.toHaveBeenCalled()
    expect(props.onChanged).not.toHaveBeenCalled()
  })

  it("retains the conversation on failed deletion and refreshes only after success", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true)
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(page([active]))
      .mockResolvedValueOnce(Response.json({ detail: "删除失败" }, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 })).mockResolvedValue(page([])))
    const props = callbacks()
    render(<ConversationHistory activeId={active.id} refreshVersion={0} {...props} />)
    await userEvent.click(await screen.findByRole("button", { name: "删除 午饭" }))
    expect(await screen.findByText("删除失败")).toBeInTheDocument()
    expect(props.onNew).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole("button", { name: "删除 午饭" }))
    await waitFor(() => expect(props.onNew).toHaveBeenCalledOnce())
    expect(await screen.findByText(/暂无云端会话/)).toBeInTheDocument()
  })

  it("does not close a newly selected conversation when an older archive completes", async () => {
    let resolve!: (value: Response) => void
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(page([active]))
      .mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done }))
      .mockResolvedValue(page([])))
    const props = callbacks()
    const view = render(<ConversationHistory activeId={active.id} refreshVersion={0} {...props} />)
    await userEvent.click(await screen.findByRole("button", { name: "归档 午饭" }))
    view.rerender(<ConversationHistory activeId={archived.id} refreshVersion={0} {...props} />)
    await act(async () => resolve(Response.json({})))
    expect(props.onNew).not.toHaveBeenCalled()
    expect(props.onChanged).toHaveBeenCalledOnce()
  })
})

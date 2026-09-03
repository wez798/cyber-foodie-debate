import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { MarkdownContent } from "@/components/markdown-content"

describe("MarkdownContent", () => {
  it("renders formatting instead of displaying markdown source", () => {
    const { container } = render(
      <MarkdownContent content={"**今日推荐**\n\n- 番茄鸡蛋面\n- 鸡腿饭"} />,
    )

    expect(screen.getByText("今日推荐").tagName).toBe("STRONG")
    expect(screen.getByText("番茄鸡蛋面").tagName).toBe("LI")
    expect(screen.getByText("鸡腿饭").tagName).toBe("LI")
    expect(container.textContent).not.toContain("**")
    expect(container.querySelector("ul")).toBeInTheDocument()
  })

  it("does not interpret raw html as executable markup", () => {
    const { container } = render(
      <MarkdownContent content={'<img src=x onerror="alert(1)">'} />,
    )

    expect(container.querySelector("img")).not.toBeInTheDocument()
    expect(
      screen.getByText('<img src=x onerror="alert(1)">'),
    ).toBeInTheDocument()
  })
})

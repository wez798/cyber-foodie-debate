import { useState } from "react"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"

describe("NativeSelect", () => {
  it.each(["default", "sm"] as const)("keeps Chinese options selectable in %s size", async (size) => {
    function ControlledSelect() {
      const [value, setValue] = useState("")
      return <>
        <label htmlFor="taste">口味偏好</label>
        <NativeSelect id="taste" size={size} value={value} onChange={(event) => setValue(event.target.value)}>
          <NativeSelectOption value="">请选择口味</NativeSelectOption>
          <NativeSelectOption value="清淡">清淡养生</NativeSelectOption>
        </NativeSelect>
      </>
    }
    render(<ControlledSelect />)
    const select = screen.getByRole("combobox", { name: "口味偏好" })
    expect(select).toHaveDisplayValue("请选择口味")
    await userEvent.selectOptions(select, "清淡")
    expect(select).toHaveDisplayValue("清淡养生")
  })

  it("preserves a disabled selection without emitting changes", async () => {
    const onChange = vi.fn()
    render(<NativeSelect aria-label="今天天气" value="晴天" disabled onChange={onChange}>
      <NativeSelectOption value="晴天">晴天</NativeSelectOption>
      <NativeSelectOption value="雨天">雨天</NativeSelectOption>
    </NativeSelect>)
    const select = screen.getByRole("combobox", { name: "今天天气" })
    await userEvent.selectOptions(select, "雨天")
    expect(select).toHaveDisplayValue("晴天")
    expect(onChange).not.toHaveBeenCalled()
  })
})

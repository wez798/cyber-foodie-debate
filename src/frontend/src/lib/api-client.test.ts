import { afterEach, describe, expect, it, vi } from "vitest"

import { ApiError, apiFetch } from "@/lib/api-client"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("apiFetch", () => {
  it("surfaces FastAPI field validation details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            detail: [
              {
                type: "string_too_short",
                loc: ["body", "password"],
                msg: "String should have at least 10 characters",
                input: "short",
              },
            ],
          },
          { status: 422 },
        ),
      ),
    )

    const error = await apiFetch("/auth/register", {
      method: "POST",
      body: JSON.stringify({}),
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      status: 422,
      message: "password：String should have at least 10 characters",
    })
  })
})

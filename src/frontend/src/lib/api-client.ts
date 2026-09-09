import { z } from "zod"

const localBackendOrigin = `${window.location.protocol}//${window.location.hostname}:8000`
export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ?? `${localBackendOrigin}/api/v1`
).replace(/\/$/, "")
const CSRF_COOKIE_NAME = import.meta.env.VITE_CSRF_COOKIE_NAME ?? "cfd_csrf"

const validationIssueSchema = z.object({
  loc: z.array(z.union([z.string(), z.number()])),
  msg: z.string(),
})

const errorSchema = z.object({
  detail: z
    .union([
      z.string(),
      z.object({
        code: z.string().optional(),
        message: z.string().optional(),
      }),
      z.array(validationIssueSchema),
    ])
    .optional(),
  error: z.object({ message: z.string().optional() }).optional(),
})

export class ApiError extends Error {
  readonly status: number
  readonly code: string | null

  constructor(message: string, status: number, code: string | null = null) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
  }
}

function cookieValue(name: string): string | null {
  const prefix = `${encodeURIComponent(name)}=`
  const match = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
  if (!match) return null
  try {
    return decodeURIComponent(match.slice(prefix.length))
  } catch {
    return null
  }
}

async function responseError(response: Response): Promise<ApiError> {
  try {
    const parsed = errorSchema.parse(await response.json())
    if (typeof parsed.detail === "string") {
      return new ApiError(parsed.detail, response.status)
    }
    if (Array.isArray(parsed.detail)) {
      const message = parsed.detail
        .map((issue) => {
          const field = issue.loc.filter((part) => part !== "body").join(".")
          return field ? `${field}：${issue.msg}` : issue.msg
        })
        .join("；")
      return new ApiError(message || `请求失败（${response.status}）`, response.status)
    }
    if (parsed.detail) {
      return new ApiError(
        parsed.detail.message ?? `请求失败（${response.status}）`,
        response.status,
        parsed.detail.code ?? null,
      )
    }
    if (parsed.error?.message) {
      return new ApiError(parsed.error.message, response.status)
    }
  } catch {
    // Fall through to the stable status-only error.
  }
  return new ApiError(`请求失败（${response.status}）`, response.status)
}

export async function apiFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase()
  const headers = new Headers(init.headers)
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const csrf = cookieValue(CSRF_COOKIE_NAME)
    if (csrf) headers.set("X-CSRF-Token", csrf)
  }
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    method,
    headers,
    credentials: "include",
  })
  if (!response.ok) throw await responseError(response)
  return response
}

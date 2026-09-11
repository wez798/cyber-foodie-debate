import { z } from "zod"

import { ApiError, apiFetch, captureAuthScope } from "@/lib/api-client"
import { publishAuthChange } from "@/features/auth/auth-sync"

const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  display_name: z.string().nullable(),
  created_at: z.string().min(1),
})

const authResponseSchema = z.object({ user: userSchema })

export type AuthUser = z.infer<typeof userSchema>

export interface AuthCredentials {
  email: string
  password: string
  display_name?: string
}

export async function getCurrentUser(signal?: AbortSignal): Promise<AuthUser> {
  const assertCurrent = captureAuthScope()
  const response = await apiFetch("/auth/me", { signal })
  const user = userSchema.parse(await response.json())
  assertCurrent()
  return user
}

export async function loginUser(
  credentials: AuthCredentials,
): Promise<AuthUser> {
  const response = await apiFetch("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: credentials.email,
      password: credentials.password,
    }),
  })
  publishAuthChange()
  return authResponseSchema.parse(await response.json()).user
}

export async function registerUser(
  credentials: AuthCredentials,
): Promise<AuthUser> {
  const response = await apiFetch("/auth/register", {
    method: "POST",
    body: JSON.stringify(credentials),
  })
  publishAuthChange()
  return authResponseSchema.parse(await response.json()).user
}

export async function logoutUser(): Promise<void> {
  try {
    await apiFetch("/auth/logout", { method: "POST" })
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) publishAuthChange()
    throw error
  }
  publishAuthChange()
}

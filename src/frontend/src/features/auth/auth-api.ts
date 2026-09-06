import { z } from "zod"

import { apiFetch } from "@/lib/api-client"

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
  const response = await apiFetch("/auth/me", { signal })
  return userSchema.parse(await response.json())
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
  return authResponseSchema.parse(await response.json()).user
}

export async function registerUser(
  credentials: AuthCredentials,
): Promise<AuthUser> {
  const response = await apiFetch("/auth/register", {
    method: "POST",
    body: JSON.stringify(credentials),
  })
  return authResponseSchema.parse(await response.json()).user
}

export async function logoutUser(): Promise<void> {
  await apiFetch("/auth/logout", { method: "POST" })
}

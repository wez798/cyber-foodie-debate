// Only a random invalidation marker crosses tabs. Credentials and chat data stay out.
export const AUTH_STORAGE_KEY = "cyber-foodie-debate:auth-revision"
export const AUTH_CHANGE_EVENT = "cyber-foodie-debate:auth-changed"
export const AUTH_CHANGED_MESSAGE = "登录身份已变化或无法确认，本地副本已保留，请重新确认账号后保存。"
let revision = 0

export function authGeneration(): number { return revision }

export function authRevision(): string {
  try { return `${revision}:${localStorage.getItem(AUTH_STORAGE_KEY) ?? ""}` }
  catch { return String(revision) }
}

export function invalidateAuth(source: "local" | "remote" | "unknown" = "unknown") {
  revision += 1
  window.dispatchEvent(new CustomEvent(AUTH_CHANGE_EVENT, { detail: source }))
}

export function publishAuthChange() {
  try { localStorage.setItem(AUTH_STORAGE_KEY, crypto.randomUUID()) }
  catch { /* Cookie fencing still protects requests if storage is unavailable. */ }
  invalidateAuth("local")
}

window.addEventListener("storage", (event) => {
  if (event.key === AUTH_STORAGE_KEY || event.key === null) invalidateAuth("remote")
})

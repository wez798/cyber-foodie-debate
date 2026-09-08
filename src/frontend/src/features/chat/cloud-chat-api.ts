import { z } from "zod"

import { apiFetch } from "@/lib/api-client"
import { SseParser, type ServerSentEvent } from "@/lib/sse"

const conversationSchema = z.object({
  id: z.string().uuid(),
  mode: z.enum(["chat", "debate_pro", "debate_con", "judge", "recommend"]),
  topic: z.string().nullable(),
  title: z.string().min(1),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
  archived_at: z.string().nullable(),
})

const messageSchema = z.object({
  id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  sequence_no: z.number().int().positive(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  status: z.enum(["complete", "generating", "failed", "cancelled"]),
  client_request_id: z.string().nullable(),
  reply_to_message_id: z.string().uuid().nullable(),
  finish_reason: z.string().nullable(),
  error_code: z.string().nullable(),
  source: z.enum(["server", "client_import"]),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
})

const conversationPageSchema = z.object({
  items: z.array(conversationSchema),
  next_cursor: z.string().nullable(),
})

const messagePageSchema = z.object({
  items: z.array(messageSchema).max(50),
  next_cursor: z.string().min(1).max(512).nullable(),
})

const streamStartSchema = z.object({
  conversation_id: z.string().uuid(),
  user_message_id: z.string().uuid(),
  assistant_message_id: z.string().uuid(),
})

const streamDeltaSchema = z.object({
  conversation_id: z.string().uuid(),
  assistant_message_id: z.string().uuid(),
  delta: z.string().min(1),
})

const streamDoneSchema = z.object({
  conversation_id: z.string().uuid(),
  user_message_id: z.string().uuid(),
  assistant_message: messageSchema,
})

const streamErrorSchema = z.object({
  conversation_id: z.string().uuid(),
  assistant_message_id: z.string().uuid(),
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    retryable: z.boolean(),
  }),
})

export type CloudConversation = z.infer<typeof conversationSchema>
const characterCount = (value: string) => Array.from(value).length

export const importHistorySchema = z.object({
  import_request_id: z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  topic: z.string().nullable().transform((value) => value?.trim() || null)
    .refine((value) => characterCount(value ?? "") <= 200, "话题不能超过 200 字符"),
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().refine((value) => value.trim().length > 0 && characterCount(value) <= 8000,
      "单条消息需包含 1–8000 字符且不能为纯空白"),
  }).strict()).min(1, "没有可导入的消息").max(50, "最多导入 50 条消息"),
}).strict().superRefine((value, context) => {
  if (!value.messages.some((message) => message.role === "user")) {
    context.addIssue({ code: "custom", message: "历史必须包含用户消息" })
  }
  if (characterCount(value.topic ?? "") + value.messages.reduce((sum, message) => sum + characterCount(message.content), 0) > 64000) {
    context.addIssue({ code: "custom", message: "话题与消息合计不能超过 64000 字符" })
  }
})

export type ImportHistoryRequest = z.infer<typeof importHistorySchema>

export async function importCloudConversation(
  request: ImportHistoryRequest,
  signal?: AbortSignal,
): Promise<CloudConversation> {
  const response = await apiFetch("/conversations/import", {
    method: "POST",
    body: JSON.stringify(importHistorySchema.parse(request)),
    signal,
  })
  const conversation = conversationSchema.parse(await response.json())
  if (conversation.mode !== "chat") throw new Error("导入响应的会话模式无效")
  return conversation
}

export type CloudMessage = z.infer<typeof messageSchema>
export type CloudConversationPage = z.infer<typeof conversationPageSchema>
export type CloudMessagePage = z.infer<typeof messagePageSchema>
export type CloudStreamStart = z.infer<typeof streamStartSchema>
export type CloudStreamDelta = z.infer<typeof streamDeltaSchema>
export type CloudStreamDone = z.infer<typeof streamDoneSchema>
export type CloudStreamError = z.infer<typeof streamErrorSchema>

export type CloudStreamEvent =
  | { event: "start"; data: CloudStreamStart }
  | { event: "delta"; data: CloudStreamDelta }
  | { event: "done"; data: CloudStreamDone }
  | { event: "error"; data: CloudStreamError }

export class CloudStreamApiError extends Error {
  readonly code: string
  readonly retryable: boolean

  constructor(message: string, code: string, retryable: boolean) {
    super(message)
    this.name = "CloudStreamApiError"
    this.code = code
    this.retryable = retryable
  }
}

export async function createCloudConversation(
  topic: string | null,
  signal?: AbortSignal,
): Promise<CloudConversation> {
  const response = await apiFetch("/conversations", {
    method: "POST",
    body: JSON.stringify({ mode: "chat", topic }),
    signal,
  })
  return conversationSchema.parse(await response.json())
}

export async function listCloudConversations(
  signal?: AbortSignal,
  cursor?: string | null,
): Promise<CloudConversationPage> {
  const query = new URLSearchParams({ limit: "50" })
  if (cursor) query.set("cursor", cursor)
  const response = await apiFetch(`/conversations?${query.toString()}`, { signal })
  return conversationPageSchema.parse(await response.json())
}

export async function getCloudConversation(
  conversationId: string,
  signal?: AbortSignal,
): Promise<CloudConversation> {
  const response = await apiFetch(`/conversations/${conversationId}`, { signal })
  const conversation = conversationSchema.parse(await response.json())
  if (conversation.id !== conversationId) throw new Error("云端会话 ID 不匹配")
  return conversation
}

export async function listCloudMessages(
  conversationId: string,
  signal?: AbortSignal,
  cursor?: string | null,
): Promise<CloudMessagePage> {
  const query = new URLSearchParams({ limit: "50" })
  if (cursor) query.set("cursor", cursor)
  const response = await apiFetch(
    `/conversations/${conversationId}/messages?${query.toString()}`,
    { signal },
  )
  return validateMessagePage(await response.json(), conversationId, cursor ?? null)
}

export function validateMessagePage(
  value: unknown, conversationId: string, cursor: string | null,
  seenCursors: ReadonlySet<string> = new Set(),
): CloudMessagePage {
  const parsed = messagePageSchema.safeParse(value)
  if (!parsed.success) throw new Error("云端消息分页响应无效")
  const page = parsed.data
  if (page.next_cursor && (page.next_cursor === cursor || seenCursors.has(page.next_cursor))) {
    throw new Error("云端消息分页游标重复，请重试当前页")
  }
  if ((page.next_cursor && page.items.length === 0) || page.items.some((item) => item.conversation_id !== conversationId)) {
    throw new Error("云端消息分页响应无效")
  }
  return { ...page, items: mergeCloudMessages([], page.items) }
}

export function mergeCloudMessages(current: CloudMessage[], incoming: CloudMessage[]): CloudMessage[] {
  const merged = new Map<string, CloudMessage>()
  const sequences = new Map<number, string>()
  for (const message of [...current, ...incoming]) {
    const existing = merged.get(message.id)
    if ((existing && (existing.sequence_no !== message.sequence_no || existing.role !== message.role || existing.conversation_id !== message.conversation_id)) ||
      (sequences.has(message.sequence_no) && sequences.get(message.sequence_no) !== message.id)) {
      throw new Error("云端消息 ID 或顺序不一致")
    }
    // Existing complete content wins over an older history response.
    if (!existing || (existing.status === "generating" && message.status !== "generating")) merged.set(message.id, message)
    sequences.set(message.sequence_no, message.id)
  }
  return [...merged.values()].sort((left, right) => left.sequence_no - right.sequence_no)
}

export function createClientRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID()
  }
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
    return [
      hex.slice(0, 4).join(""),
      hex.slice(4, 6).join(""),
      hex.slice(6, 8).join(""),
      hex.slice(8, 10).join(""),
      hex.slice(10).join(""),
    ].join("-")
  }
  return `request-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export async function archiveCloudConversation(
  conversationId: string,
): Promise<void> {
  await apiFetch(`/conversations/${conversationId}`, {
    method: "PATCH",
    body: JSON.stringify({ archived: true }),
  })
}

export async function deleteCloudConversation(
  conversationId: string,
): Promise<void> {
  await apiFetch(`/conversations/${conversationId}`, { method: "DELETE" })
}

function decodeCloudEvent(message: ServerSentEvent): CloudStreamEvent | null {
  let data: unknown
  try {
    data = JSON.parse(message.data)
  } catch {
    throw new Error(`无法解析 ${message.event} 事件数据`)
  }
  try {
    switch (message.event) {
      case "start":
        return { event: "start", data: streamStartSchema.parse(data) }
      case "delta":
        return { event: "delta", data: streamDeltaSchema.parse(data) }
      case "done":
        return { event: "done", data: streamDoneSchema.parse(data) }
      case "error":
        return { event: "error", data: streamErrorSchema.parse(data) }
      default:
        return null
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`${message.event} 事件数据格式无效`)
    }
    throw error
  }
}

export async function streamCloudMessage(
  conversationId: string,
  content: string,
  clientRequestId: string,
  options: {
    signal: AbortSignal
    onEvent: (event: CloudStreamEvent) => void
  },
): Promise<CloudStreamDone> {
  const response = await apiFetch(
    `/conversations/${conversationId}/messages/stream`,
    {
      method: "POST",
      headers: { Accept: "text/event-stream" },
      body: JSON.stringify({
        content,
        client_request_id: clientRequestId,
      }),
      signal: options.signal,
    },
  )
  if (!response.body) throw new Error("浏览器未提供流式响应内容")

  const reader = response.body.getReader()
  const parser = new SseParser()
  const decoder = new TextDecoder()
  let started: CloudStreamStart | null = null
  let completed: CloudStreamDone | null = null
  let terminalReceived = false

  const emit = (messages: ServerSentEvent[]) => {
    for (const message of messages) {
      const event = decodeCloudEvent(message)
      if (!event) continue
      if (terminalReceived) throw new Error("云端对话在终止事件后仍返回了数据")
      if (event.data.conversation_id !== conversationId) {
        throw new Error("云端对话返回了不匹配的会话 ID")
      }
      if (event.event === "start") {
        if (started) throw new Error("云端对话重复返回了开始事件")
        started = event.data
      } else {
        if (!started) throw new Error("云端对话缺少开始事件")
        if (
          "assistant_message_id" in event.data &&
          event.data.assistant_message_id !== started.assistant_message_id
        ) {
          throw new Error("云端对话返回了不匹配的消息 ID")
        }
      }
      if (event.event === "error") {
        terminalReceived = true
        throw new CloudStreamApiError(
          event.data.error.message,
          event.data.error.code,
          event.data.error.retryable,
        )
      }
      if (event.event === "done") {
        if (
          event.data.user_message_id !== started.user_message_id ||
          event.data.assistant_message.id !== started.assistant_message_id ||
          event.data.assistant_message.conversation_id !== conversationId ||
          event.data.assistant_message.reply_to_message_id !==
            started.user_message_id ||
          event.data.assistant_message.role !== "assistant" ||
          event.data.assistant_message.status !== "complete"
        ) {
          throw new Error("云端对话完成事件的数据不一致")
        }
        terminalReceived = true
        completed = event.data
      }
      options.onEvent(event)
    }
  }

  try {
    while (true) {
      if (options.signal.aborted) {
        throw new DOMException("请求已取消", "AbortError")
      }
      const { done, value } = await reader.read()
      if (done) break
      emit(parser.push(decoder.decode(value, { stream: true })))
    }
    emit(parser.push(decoder.decode()))
    emit(parser.flush())
    if (!completed) throw new Error("云端对话在完成前意外中断")
    return completed
  } catch (error) {
    try {
      await reader.cancel()
    } catch {
      // Preserve the original stream, validation or cancellation error.
    }
    throw error
  } finally {
    reader.releaseLock()
  }
}

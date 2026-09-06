import { Archive, MessageSquare, Plus, Trash2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  archiveCloudConversation,
  deleteCloudConversation,
  listCloudConversations,
  type CloudConversation,
} from "@/features/chat/cloud-chat-api"

interface ConversationHistoryProps {
  activeId: string | null
  refreshVersion: number
  onSelect: (conversationId: string) => void
  onNew: () => void
  onChanged: () => void
}

export function ConversationHistory({
  activeId,
  refreshVersion,
  onSelect,
  onNew,
  onChanged,
}: ConversationHistoryProps) {
  const [items, setItems] = useState<CloudConversation[]>([])
  const [error, setError] = useState<string | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const loadMoreControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void listCloudConversations(controller.signal)
      .then((page) => {
        if (!controller.signal.aborted) {
          setItems(page.items)
          setNextCursor(page.next_cursor)
          setError(null)
        }
      })
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "加载历史失败",
          )
        }
      })
    return () => {
      controller.abort()
      loadMoreControllerRef.current?.abort()
      loadMoreControllerRef.current = null
    }
  }, [refreshVersion])

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return
    const controller = new AbortController()
    loadMoreControllerRef.current?.abort()
    loadMoreControllerRef.current = controller
    setLoadingMore(true)
    try {
      const page = await listCloudConversations(controller.signal, nextCursor)
      if (controller.signal.aborted) return
      setItems((current) => [...current, ...page.items])
      setNextCursor(page.next_cursor)
      setError(null)
    } catch (requestError) {
      if (!controller.signal.aborted) {
        setError(
          requestError instanceof Error ? requestError.message : "加载更多失败",
        )
      }
    } finally {
      if (loadMoreControllerRef.current === controller) {
        loadMoreControllerRef.current = null
        setLoadingMore(false)
      }
    }
  }

  const mutate = async (
    action: (conversationId: string) => Promise<void>,
    conversationId: string,
  ) => {
    try {
      await action(conversationId)
      if (activeId === conversationId) onNew()
      onChanged()
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "操作失败",
      )
    }
  }

  const confirmDelete = (conversation: CloudConversation) => {
    if (!window.confirm(`确定删除“${conversation.title}”吗？此操作不可撤销。`)) {
      return
    }
    void mutate(deleteCloudConversation, conversation.id)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">云端历史</span>
        <Button type="button" size="xs" variant="outline" onClick={onNew}>
          <Plus aria-hidden="true" />
          新建
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="max-h-72 space-y-2 overflow-y-auto">
        {items.length === 0 && !error && (
          <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            暂无云端会话，发送第一条消息后会出现在这里。
          </p>
        )}
        {items.map((conversation) => (
          <div
            key={conversation.id}
            className={`rounded-md border p-2 ${
              activeId === conversation.id ? "bg-accent" : "bg-background"
            }`}
          >
            <button
              type="button"
              className="flex w-full items-start gap-2 text-left"
              onClick={() => onSelect(conversation.id)}
            >
              <MessageSquare className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">
                  {conversation.title}
                </span>
                <span className="block text-[11px] text-muted-foreground">
                  {new Date(conversation.updated_at).toLocaleString()}
                </span>
              </span>
            </button>
            <div className="mt-2 flex justify-end gap-1">
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label={`归档 ${conversation.title}`}
                onClick={() => void mutate(archiveCloudConversation, conversation.id)}
              >
                <Archive aria-hidden="true" />
              </Button>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label={`删除 ${conversation.title}`}
                onClick={() => confirmDelete(conversation)}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
          </div>
        ))}
        {nextCursor && (
          <Button
            type="button"
            className="w-full"
            size="sm"
            variant="ghost"
            disabled={loadingMore}
            onClick={() => void loadMore()}
          >
            {loadingMore ? "加载中…" : "加载更多"}
          </Button>
        )}
      </div>
    </div>
  )
}

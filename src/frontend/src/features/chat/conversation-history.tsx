import { Archive, ArchiveRestore, MessageSquare, Plus, Trash2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  archiveCloudConversation,
  deleteCloudConversation,
  listCloudConversations,
  restoreCloudConversation,
  type CloudConversation,
} from "@/features/chat/cloud-chat-api"
import { captureAuthScope } from "@/lib/api-client"

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
  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId
  const [archived, setArchived] = useState(false)
  const [loading, setLoading] = useState(true)
  const [reloadVersion, setReloadVersion] = useState(0)
  const [pending, setPending] = useState<string | null>(null)
  const mutationRef = useRef<AbortController | null>(null)
  const [items, setItems] = useState<CloudConversation[]>([])
  const [error, setError] = useState<string | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const loadMoreControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const assertCurrent = captureAuthScope()
    setLoading(true)
    setItems([])
    setNextCursor(null)
    setError(null)
    setPending(null)
    setLoadingMore(false)
    void listCloudConversations(controller.signal, null, archived)
      .then((page) => {
        if (!controller.signal.aborted) {
          assertCurrent()
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
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => {
      controller.abort()
      mutationRef.current?.abort()
      mutationRef.current = null
      loadMoreControllerRef.current?.abort()
      loadMoreControllerRef.current = null
    }
  }, [refreshVersion, archived, reloadVersion])

  const loadMore = async () => {
    if (!nextCursor || loading || loadMoreControllerRef.current) return
    const assertCurrent = captureAuthScope()
    const controller = new AbortController()
    loadMoreControllerRef.current = controller
    setLoadingMore(true)
    try {
      const page = await listCloudConversations(controller.signal, nextCursor, archived)
      if (controller.signal.aborted) return
      assertCurrent()
      setItems((current) => [...new Map([...current, ...page.items].map((item) => [item.id, item])).values()])
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
    action: (conversationId: string, signal?: AbortSignal) => Promise<void>,
    conversationId: string,
  ) => {
    if (mutationRef.current) return
    const controller = new AbortController()
    const assertCurrent = captureAuthScope()
    mutationRef.current = controller
    setPending(conversationId)
    setError(null)
    try {
      await action(conversationId, controller.signal)
      if (controller.signal.aborted) return
      assertCurrent()
      if (activeIdRef.current === conversationId) onNew()
      setReloadVersion((version) => version + 1)
      onChanged()
    } catch (requestError) {
      if (controller.signal.aborted) return
      setError(
        requestError instanceof Error ? requestError.message : "操作失败",
      )
    } finally {
      if (mutationRef.current === controller) {
        mutationRef.current = null
        setPending(null)
      }
    }
  }

  const confirmDelete = (conversation: CloudConversation) => {
    if (!window.confirm(`确定删除“${conversation.title}”吗？此操作不可撤销。`)) {
      return
    }
    void mutate(deleteCloudConversation, conversation.id)
  }

  const visibleItems = items.filter((item) => Boolean(item.archived_at) === archived)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">云端历史</span>
        <Button type="button" size="xs" variant="outline" onClick={onNew}>
          <Plus aria-hidden="true" />
          新建
        </Button>
      </div>
      <div role="group" aria-label="历史筛选" className="flex gap-2">
        <Button size="xs" variant={archived ? "outline" : "secondary"} aria-pressed={!archived} onClick={() => setArchived(false)}>最近会话</Button>
        <Button size="xs" variant={archived ? "secondary" : "outline"} aria-pressed={archived} onClick={() => setArchived(true)}>已归档</Button>
      </div>
      {loading && <p role="status" className="text-xs text-muted-foreground">正在加载历史…</p>}
      {pending && <p role="status" className="text-xs text-muted-foreground">正在保存操作…</p>}
      {error && <div role="alert" className="text-xs text-destructive">
        <p>{error}</p>
        <Button size="xs" variant="outline" onClick={() => setReloadVersion((version) => version + 1)}>重新加载列表</Button>
      </div>}
      <div className="max-h-72 space-y-2 overflow-y-auto">
        {visibleItems.length === 0 && !loading && !error && (
          <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            {archived ? (nextCursor ? "本页暂无归档会话，可加载更多继续查找。" : "暂无已归档会话。") : "暂无云端会话，发送第一条消息后会出现在这里。"}
          </p>
        )}
        {visibleItems.map((conversation) => (
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
                disabled={Boolean(pending)}
                aria-label={`${archived ? "恢复" : "归档"} ${conversation.title}`}
                onClick={() => void mutate(archived ? restoreCloudConversation : archiveCloudConversation, conversation.id)}
              >
                {archived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
              </Button>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                disabled={Boolean(pending)}
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

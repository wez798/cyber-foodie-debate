import {
  Bot,
  MessageCircleMore,
  Send,
  Square,
  Trash2,
  UserRound,
} from "lucide-react"
import type { FormEvent, KeyboardEvent } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { MarkdownContent } from "@/components/markdown-content"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useChat } from "@/features/chat/use-chat"

export function ChatPanel() {
  const {
    state,
    draft,
    setDraft,
    setTopic,
    send,
    stop,
    reset,
  } = useChat()
  const isStreaming = state.phase === "streaming"

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await send()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  return (
    <Card className="gap-0 overflow-hidden border-border/90 py-0 shadow-none">
      <CardHeader className="gap-4 border-b bg-[#fffdf8] px-5 py-5 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <MessageCircleMore className="size-5 text-primary" aria-hidden="true" />
            <CardTitle id="chat-heading" className="text-xl">
              自由聊
            </CardTitle>
            <Badge variant="secondary">含校园干饭推荐</Badge>
            <Badge variant="outline">TTS 扩展点已预留</Badge>
          </div>
          <CardDescription>
            聊校园生活，也可按预算、口味与忌口获得干饭推荐；最近对话保存在本浏览器。
          </CardDescription>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={reset}
          disabled={isStreaming}
        >
          <Trash2 aria-hidden="true" />
          新对话
        </Button>
      </CardHeader>

      <CardContent className="grid gap-0 px-0 lg:grid-cols-[240px_minmax(0,1fr)]">
        <div className="space-y-4 border-b bg-muted/25 p-5 lg:border-r lg:border-b-0">
          <div className="space-y-2">
            <label htmlFor="chat-topic" className="text-sm font-medium">
              话题
            </label>
            <Input
              id="chat-topic"
              value={state.topic}
              onChange={(event) => setTopic(event.target.value)}
              placeholder="例如：一食堂还是二食堂"
              maxLength={200}
              disabled={isStreaming}
            />
          </div>
          <div className="rounded-md border bg-background p-3 text-xs leading-5 text-muted-foreground">
            <p className="break-all">
              会话：{state.conversationId ?? "发送首条消息后生成"}
            </p>
            {state.updatedAt && (
              <p className="mt-1">
                已恢复：{new Date(state.updatedAt).toLocaleString()}
              </p>
            )}
          </div>
        </div>

        <section aria-labelledby="chat-heading" className="min-w-0">
          <div
            className="flex min-h-72 max-h-[520px] flex-col gap-4 overflow-y-auto p-5"
            aria-live="polite"
          >
            {state.messages.length === 0 && (
              <div className="m-auto max-w-lg text-center">
                <Bot className="mx-auto mb-3 size-9 text-primary" aria-hidden="true" />
                <p className="font-medium">擂台主持人已就位</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  可以问“预算 20 元、不能吃花生，午饭怎么选？”，也可以切换模式来打一场观点赛。
                </p>
              </div>
            )}

            {state.messages.map((message, index) => {
              const pending =
                isStreaming &&
                index === state.messages.length - 1 &&
                message.role === "assistant" &&
                !message.content
              return (
                <div
                  key={`${message.role}-${index}`}
                  className={`flex gap-3 ${
                    message.role === "user" ? "flex-row-reverse" : ""
                  }`}
                >
                  <div
                    className={`flex size-8 shrink-0 items-center justify-center rounded-full ${
                      message.role === "user"
                        ? "bg-foreground text-background"
                        : "bg-primary text-primary-foreground"
                    }`}
                  >
                    {message.role === "user" ? (
                      <UserRound className="size-4" aria-hidden="true" />
                    ) : (
                      <Bot className="size-4" aria-hidden="true" />
                    )}
                  </div>
                  <div
                    className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-4 py-3 text-sm leading-6 ${
                      message.role === "user"
                        ? "bg-foreground text-background"
                        : "border bg-[#fffdf8]"
                    }`}
                  >
                    {pending ? (
                      "正在组织观点…"
                    ) : message.role === "assistant" ? (
                      <MarkdownContent content={message.content} />
                    ) : (
                      message.content
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          <div className="border-t p-5">
            {state.error && (
              <Alert variant="destructive" className="mb-4">
                <AlertTitle>对话中断</AlertTitle>
                <AlertDescription>{state.error}</AlertDescription>
              </Alert>
            )}
            <form onSubmit={handleSubmit}>
              <Textarea
                aria-label="聊天消息"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入消息，Enter 发送，Shift + Enter 换行"
                rows={3}
                maxLength={8000}
                disabled={isStreaming}
              />
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">
                  AI 内容仅供参考，实时价格与菜单请以现场为准
                </span>
                {isStreaming ? (
                  <Button type="button" variant="outline" onClick={stop}>
                    <Square aria-hidden="true" />
                    停止生成
                  </Button>
                ) : (
                  <Button type="submit" disabled={!draft.trim()}>
                    <Send aria-hidden="true" />
                    发送消息
                  </Button>
                )}
              </div>
            </form>
          </div>
        </section>
      </CardContent>
    </Card>
  )
}

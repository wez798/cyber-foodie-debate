import { Crown } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import type { DebatePhase, DebateRound } from "@/types/debate"

interface AgentPanelProps {
  name: string
  subtitle: string
  avatar: string
  avatarAlt: string
  rounds: DebateRound[]
  phase: DebatePhase
  active: boolean
  winner: boolean
  tone: "spicy" | "fresh"
}

export function AgentPanel({
  name,
  subtitle,
  avatar,
  avatarAlt,
  rounds,
  phase,
  active,
  winner,
  tone,
}: AgentPanelProps) {
  const isWaiting = rounds.length === 0

  return (
    <Card
      className={cn(
        "min-w-0 gap-0 overflow-hidden py-0 shadow-none transition-colors",
        tone === "spicy"
          ? "border-[#dc8a70] bg-[#fffaf7]"
          : "border-[#73a99c] bg-[#f6fcfa]",
        active &&
          (tone === "spicy"
            ? "border-[#c54720] ring-2 ring-[#c54720]/15"
            : "border-[#277a68] ring-2 ring-[#277a68]/15"),
        winner && "ring-2 ring-[#b8891e]/35",
      )}
      aria-current={active ? "true" : undefined}
    >
      <CardHeader
        className={cn(
          "grid grid-cols-[64px_minmax(0,1fr)] items-center gap-3 border-b px-4 py-4 sm:grid-cols-[72px_minmax(0,1fr)] sm:px-5",
          tone === "spicy" ? "border-[#efc6b8]" : "border-[#b9d9d1]",
        )}
      >
        <img
          src={avatar}
          alt={avatarAlt}
          className={cn(
            "size-16 rounded-lg border object-cover sm:size-[72px]",
            tone === "spicy" ? "border-[#dc8a70]" : "border-[#73a99c]",
          )}
        />
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <CardTitle className="text-base sm:text-lg">{name}</CardTitle>
            {winner && (
              <Badge className="bg-[#b8891e] text-white hover:bg-[#b8891e]">
                <Crown aria-hidden="true" />
                胜方
              </Badge>
            )}
            {active && <Badge variant="outline">发言中</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
      </CardHeader>

      <CardContent className="min-h-72 px-4 py-4 sm:px-5" aria-live="polite">
        {isWaiting && (phase === "submitting" || phase === "streaming") ? (
          <div className="space-y-3" aria-label="等待大厨发言">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        ) : isWaiting ? (
          <div className="flex min-h-56 items-center justify-center text-center">
            <p className="max-w-48 text-sm leading-6 text-muted-foreground">
              等待开赛，提交偏好后这里会实时出现大厨观点。
            </p>
          </div>
        ) : (
          <ol className="space-y-5">
            {rounds.map((round) => (
              <li
                key={`${round.speaker}-${round.round_number}`}
                className={cn(
                  "border-l-2 pl-3",
                  tone === "spicy" ? "border-[#d66a47]" : "border-[#438f7e]",
                )}
              >
                <p className="mb-1 text-xs font-semibold text-muted-foreground">
                  第 {round.round_number} 轮
                </p>
                <p className="whitespace-pre-wrap break-words text-sm leading-7">
                  {round.content}
                </p>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}

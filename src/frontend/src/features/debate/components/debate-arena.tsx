import spicyAvatar from "@/assets/agents/lao-ma.webp"
import freshAvatar from "@/assets/agents/a-liang.webp"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { AgentPanel } from "@/features/debate/components/agent-panel"
import type { DebateViewState } from "@/types/debate"

interface DebateArenaProps {
  state: DebateViewState
}

const phaseCopy = {
  idle: "等待开赛",
  submitting: "连接赛场",
  streaming: "观点交锋中",
  completed: "辩论完成",
  error: "辩论中断",
}

export function DebateArena({ state }: DebateArenaProps) {
  const visibleRounds = state.pendingRound ? [...state.rounds, state.pendingRound] : state.rounds
  const spicyRounds = visibleRounds.filter(
    (round) => round.speaker === "sichuan_spicy",
  )
  const freshRounds = visibleRounds.filter(
    (round) => round.speaker === "cantonese_healthy",
  )
  const progress = Math.min(100, (state.rounds.length / 6) * 100)

  return (
    <section aria-labelledby="arena-heading" className="min-w-0">
      <div className="mb-4 flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 id="arena-heading" className="text-xl font-semibold sm:text-2xl">
              辩论实况
            </h2>
            <Badge variant="secondary">{phaseCopy[state.phase]}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            双方各发言三次，主持人将在最后给出裁决。
          </p>
        </div>
        <div className="w-full sm:w-48">
          <div className="mb-2 flex justify-between text-xs text-muted-foreground">
            <span>进度</span>
            <span>{state.rounds.length} / 6 条发言</span>
          </div>
          <Progress value={progress} aria-label={`辩论进度 ${Math.round(progress)}%`} />
        </div>
      </div>

      <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_64px_minmax(0,1fr)] lg:items-stretch">
        <AgentPanel
          name="川辣派 · 老麻"
          subtitle="直球出击，以香辣和满足感抢占味蕾"
          avatar={spicyAvatar}
          avatarAlt="川辣派老麻角色头像"
          rounds={spicyRounds}
          phase={state.phase}
          active={state.activePersona === "sichuan_spicy"}
          winner={state.result?.winner === "sichuan_spicy"}
          tone="spicy"
        />

        <div className="flex items-center justify-center py-1" aria-hidden="true">
          <div className="flex size-11 items-center justify-center rounded-full border-2 border-foreground bg-background text-sm font-black">
            VS
          </div>
        </div>

        <AgentPanel
          name="粤式养生派 · 阿靓"
          subtitle="温和拆招，从时令和身体负担寻找平衡"
          avatar={freshAvatar}
          avatarAlt="粤式养生派阿靓角色头像"
          rounds={freshRounds}
          phase={state.phase}
          active={state.activePersona === "cantonese_healthy"}
          winner={state.result?.winner === "cantonese_healthy"}
          tone="fresh"
        />
      </div>
    </section>
  )
}

import { LoaderCircle, MapPin, RotateCcw, Trophy, Volume2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import type { DebateResult } from "@/types/debate"

interface ResultPanelProps {
  result: DebateResult
  audioUrl: string | null
  isAudioLoading: boolean
  onPlay: () => Promise<void>
  onReset: () => void
}

export function ResultPanel({
  result,
  audioUrl,
  isAudioLoading,
  onPlay,
  onReset,
}: ResultPanelProps) {
  const confidence = Math.round(result.confidence * 100)
  const winner =
    result.winner === "sichuan_spicy" ? "川辣派 · 老麻" : "粤式养生派 · 阿靓"

  return (
    <section aria-labelledby="result-heading" className="mt-6">
      <Card className="gap-5 border-[#d5b464] bg-[#fffdf5] py-5 shadow-none">
        <CardHeader className="gap-3 px-5 sm:flex sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Badge className="mb-2 bg-[#b8891e] text-white hover:bg-[#b8891e]">
              <Trophy aria-hidden="true" />
              主持人裁决
            </Badge>
            <CardTitle id="result-heading" className="text-xl sm:text-2xl">
              今日推荐：{result.dish_name}
            </CardTitle>
          </div>
          <p className="text-sm font-semibold text-[#745b1a]">胜方：{winner}</p>
        </CardHeader>
        <CardContent className="grid gap-5 px-5 lg:grid-cols-[minmax(0,1fr)_220px]">
          <div className="min-w-0">
            <p className="break-words text-sm leading-7 sm:text-base">
              {result.recommendation}
            </p>
            {result.restaurant_suggestion && (
              <p className="mt-3 flex items-start gap-2 text-sm text-muted-foreground">
                <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>{result.restaurant_suggestion}</span>
              </p>
            )}
          </div>
          <div className="border-t pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-5">
            <div className="mb-2 flex items-end justify-between">
              <span className="text-sm text-muted-foreground">推荐置信度</span>
              <strong className="text-2xl">{confidence}%</strong>
            </div>
            <Progress value={confidence} aria-label={`推荐置信度 ${confidence}%`} />
            <div className="mt-4 grid gap-2">
              <Button onClick={onPlay} disabled={isAudioLoading}>
                {isAudioLoading ? (
                  <LoaderCircle className="animate-spin" aria-hidden="true" />
                ) : (
                  <Volume2 aria-hidden="true" />
                )}
                {isAudioLoading ? "正在合成" : "播放语音战报"}
              </Button>
              <Button variant="outline" onClick={onReset}>
                <RotateCcw aria-hidden="true" />
                再来一场
              </Button>
            </div>
          </div>
          {audioUrl && (
            <audio
              className="w-full lg:col-span-2"
              src={audioUrl}
              controls
              autoPlay
              aria-label="辩论结果语音"
            />
          )}
        </CardContent>
      </Card>
    </section>
  )
}

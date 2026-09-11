import { useState, type FormEvent } from "react"
import { Ban, Flame } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"
import type { DebatePhase, FoodPreference } from "@/types/debate"

interface PreferenceFormProps {
  phase: DebatePhase
  onSubmit: (preference: FoodPreference) => Promise<void>
  onCancel: () => void
}

interface FormValues {
  taste: string
  budget: string
  weather: string
  allergy: string
  other: string
}

const initialValues: FormValues = {
  taste: "",
  budget: "",
  weather: "晴天",
  allergy: "",
  other: "",
}

export function PreferenceForm({
  phase,
  onSubmit,
  onCancel,
}: PreferenceFormProps) {
  const [values, setValues] = useState(initialValues)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const isBusy = phase === "submitting" || phase === "streaming"

  const update = (field: keyof FormValues, value: string) => {
    setValues((current) => ({ ...current, [field]: value }))
    if (value) {
      setErrors((current) => {
        const next = { ...current }
        delete next[field]
        return next
      })
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const nextErrors: Record<string, string> = {}
    if (!values.taste) nextErrors.taste = "请选择口味偏好"
    if (!values.budget) nextErrors.budget = "请选择预算范围"
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    await onSubmit({
      口味: values.taste,
      预算: values.budget,
      天气: values.weather || null,
      忌口: values.allergy.trim() || null,
      其他要求: values.other.trim() || null,
    })
  }

  return (
    <Card className="gap-5 border-border/90 py-5 shadow-none">
      <CardHeader className="gap-1 px-5">
        <p className="text-xs font-semibold text-primary">开赛设置</p>
        <CardTitle className="text-xl">今天想吃点什么？</CardTitle>
      </CardHeader>
      <CardContent className="px-5">
        <form onSubmit={handleSubmit} noValidate>
          <FieldGroup className="gap-5">
            <Field data-invalid={Boolean(errors.taste)}>
              <FieldLabel htmlFor="taste">口味偏好</FieldLabel>
              <NativeSelect
                id="taste"
                value={values.taste}
                onChange={(event) => update("taste", event.target.value)}
                aria-invalid={Boolean(errors.taste)}
                disabled={isBusy}
              >
                <NativeSelectOption value="">请选择口味</NativeSelectOption>
                <NativeSelectOption value="辣">无辣不欢</NativeSelectOption>
                <NativeSelectOption value="清淡">清淡养生</NativeSelectOption>
                <NativeSelectOption value="酸甜">酸甜开胃</NativeSelectOption>
                <NativeSelectOption value="咸鲜">咸鲜适中</NativeSelectOption>
                <NativeSelectOption value="随便">交给大厨</NativeSelectOption>
              </NativeSelect>
              <FieldError>{errors.taste}</FieldError>
            </Field>

            <Field data-invalid={Boolean(errors.budget)}>
              <FieldLabel htmlFor="budget">预算范围</FieldLabel>
              <NativeSelect
                id="budget"
                value={values.budget}
                onChange={(event) => update("budget", event.target.value)}
                aria-invalid={Boolean(errors.budget)}
                disabled={isBusy}
              >
                <NativeSelectOption value="">请选择预算</NativeSelectOption>
                <NativeSelectOption value="10元以下">10 元以下</NativeSelectOption>
                <NativeSelectOption value="10-20元">10 - 20 元</NativeSelectOption>
                <NativeSelectOption value="20-30元">20 - 30 元</NativeSelectOption>
                <NativeSelectOption value="30元以上">30 元以上</NativeSelectOption>
              </NativeSelect>
              <FieldError>{errors.budget}</FieldError>
            </Field>

            <Field>
              <FieldLabel htmlFor="weather">今天天气</FieldLabel>
              <NativeSelect
                id="weather"
                value={values.weather}
                onChange={(event) => update("weather", event.target.value)}
                disabled={isBusy}
              >
                <NativeSelectOption value="晴天">晴天</NativeSelectOption>
                <NativeSelectOption value="雨天">雨天</NativeSelectOption>
                <NativeSelectOption value="阴天">阴天</NativeSelectOption>
                <NativeSelectOption value="很热">很热</NativeSelectOption>
                <NativeSelectOption value="很冷">很冷</NativeSelectOption>
              </NativeSelect>
            </Field>

            <Field>
              <FieldLabel htmlFor="allergy">忌口或过敏</FieldLabel>
              <Input
                id="allergy"
                value={values.allergy}
                onChange={(event) => update("allergy", event.target.value)}
                placeholder="例如：海鲜过敏、不吃香菜"
                maxLength={120}
                disabled={isBusy}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="other">其他要求</FieldLabel>
              <Textarea
                id="other"
                value={values.other}
                onChange={(event) => update("other", event.target.value)}
                placeholder="例如：想吃热的、离宿舍近"
                maxLength={200}
                rows={3}
                disabled={isBusy}
              />
              <FieldDescription>选填，最多 200 字</FieldDescription>
            </Field>

            <div className="flex flex-col gap-2 pt-1 sm:flex-row">
              <Button type="submit" className="min-w-0 flex-1" disabled={isBusy}>
                <Flame aria-hidden="true" />
                {phase === "submitting"
                  ? "正在连接赛场"
                  : phase === "streaming"
                    ? "辩论进行中"
                    : "开始三轮辩论"}
              </Button>
              {isBusy && (
                <Button type="button" variant="outline" onClick={onCancel}>
                  <Ban aria-hidden="true" />
                  取消
                </Button>
              )}
            </div>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}

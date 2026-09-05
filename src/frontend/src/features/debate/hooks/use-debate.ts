import { useCallback, useEffect, useReducer, useRef, useState } from "react"

import {
  streamDebate,
  synthesizeDebateResult,
} from "@/features/debate/api/debate-api"
import type {
  DebateRequest,
  DebateStreamEvent,
  DebateViewState,
  FoodPreference,
} from "@/types/debate"

const initialState: DebateViewState = {
  phase: "idle",
  sessionId: null,
  rounds: [],
  result: null,
  activePersona: null,
  error: null,
}

type Action =
  | { type: "submit" }
  | { type: "open" }
  | { type: "event"; event: DebateStreamEvent }
  | { type: "fail"; message: string }
  | { type: "reset" }

function reducer(state: DebateViewState, action: Action): DebateViewState {
  if (action.type === "submit") {
    return { ...initialState, phase: "submitting" }
  }
  if (action.type === "open") {
    return { ...state, phase: "streaming" }
  }
  if (action.type === "fail") {
    return { ...state, phase: "error", activePersona: null, error: action.message }
  }
  if (action.type === "reset") return initialState

  if (action.event.event === "error") {
    return {
      ...state,
      phase: "error",
      sessionId: action.event.data.session_id,
      activePersona: null,
      error: action.event.data.error.message,
    }
  }
  if (action.event.event === "session_start") {
    return { ...state, sessionId: action.event.data.session_id }
  }
  if (action.event.event === "round") {
    return {
      ...state,
      phase: "streaming",
      rounds: [...state.rounds, action.event.data.round],
      activePersona: action.event.data.round.speaker,
    }
  }
  return {
    ...state,
    phase: "completed",
    sessionId: action.event.data.session_id,
    rounds: action.event.data.rounds,
    result: action.event.data.result,
    activePersona: null,
    error: null,
  }
}

const createRequest = (preference: FoodPreference): DebateRequest => ({
  preference,
  agent_a_persona: "sichuan_spicy",
  agent_b_persona: "cantonese_healthy",
  max_rounds: 3,
})

export function useDebate() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [isAudioLoading, setIsAudioLoading] = useState(false)
  const debateController = useRef<AbortController | null>(null)
  const audioController = useRef<AbortController | null>(null)
  const lastPreference = useRef<FoodPreference | null>(null)
  const audioUrlRef = useRef<string | null>(null)

  const clearAudio = useCallback(() => {
    audioController.current?.abort()
    audioController.current = null
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
    audioUrlRef.current = null
    setAudioUrl(null)
    setIsAudioLoading(false)
  }, [])

  const start = useCallback(
    async (preference: FoodPreference) => {
      debateController.current?.abort()
      clearAudio()
      const controller = new AbortController()
      debateController.current = controller
      lastPreference.current = preference
      dispatch({ type: "submit" })

      try {
        await streamDebate(createRequest(preference), {
          signal: controller.signal,
          onOpen: () => dispatch({ type: "open" }),
          onEvent: (event) => dispatch({ type: "event", event }),
        })
        return true
      } catch (error) {
        if (controller.signal.aborted) return false
        dispatch({
          type: "fail",
          message: error instanceof Error ? error.message : "辩论请求失败",
        })
        return false
      } finally {
        if (debateController.current === controller) {
          debateController.current = null
        }
      }
    },
    [clearAudio],
  )

  const retry = useCallback(async () => {
    return lastPreference.current ? start(lastPreference.current) : false
  }, [start])

  const cancel = useCallback(() => {
    debateController.current?.abort()
    debateController.current = null
    dispatch({ type: "reset" })
  }, [])

  const reset = useCallback(() => {
    debateController.current?.abort()
    debateController.current = null
    clearAudio()
    dispatch({ type: "reset" })
  }, [clearAudio])

  const playResult = useCallback(async () => {
    if (!state.sessionId) throw new Error("当前辩论尚未生成会话 ID")
    clearAudio()
    const controller = new AbortController()
    audioController.current = controller
    setIsAudioLoading(true)

    try {
      const blob = await synthesizeDebateResult(state.sessionId, controller.signal)
      if (controller.signal.aborted || audioController.current !== controller) {
        throw new DOMException("请求已取消", "AbortError")
      }
      const nextUrl = URL.createObjectURL(blob)
      audioUrlRef.current = nextUrl
      setAudioUrl(nextUrl)
      return nextUrl
    } finally {
      if (audioController.current === controller) {
        audioController.current = null
        setIsAudioLoading(false)
      }
    }
  }, [clearAudio, state.sessionId])

  useEffect(() => {
    return () => {
      debateController.current?.abort()
      audioController.current?.abort()
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
    }
  }, [])

  return {
    state,
    audioUrl,
    isAudioLoading,
    start,
    retry,
    cancel,
    reset,
    playResult,
  }
}

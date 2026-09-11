export type AgentPersona = "sichuan_spicy" | "cantonese_healthy"

export type DebatePhase =
  | "idle"
  | "submitting"
  | "streaming"
  | "completed"
  | "error"

export interface FoodPreference {
  口味: string
  预算: string
  天气: string | null
  忌口: string | null
  其他要求: string | null
}

export interface DebateRequest {
  preference: FoodPreference
  agent_a_persona: "sichuan_spicy"
  agent_b_persona: "cantonese_healthy"
  max_rounds: 3
}

export interface DebateRound {
  round_number: number
  speaker: AgentPersona
  content: string
  reasoning?: string | null
}

export interface DebateResult {
  winner: AgentPersona
  recommendation: string
  dish_name: string
  restaurant_suggestion?: string | null
  confidence: number
}

export interface SessionStartData {
  session_id: string
  status: "running"
}

export interface RoundData {
  round: DebateRound
  side: "agent_a" | "agent_b"
}

export interface RoundDeltaData {
  round_number: number
  speaker: AgentPersona
  side: "agent_a" | "agent_b"
  delta: string
}

export interface ResultData {
  session_id: string
  status: "completed"
  rounds: DebateRound[]
  result: DebateResult
}

export interface DebateStreamErrorData {
  session_id: string
  status: "failed" | "timeout"
  error: {
    code: string
    message: string
    retryable: boolean
  }
}

export type DebateStreamEvent =
  | { event: "session_start"; data: SessionStartData }
  | { event: "round"; data: RoundData }
  | { event: "round_delta"; data: RoundDeltaData }
  | { event: "result"; data: ResultData }
  | { event: "error"; data: DebateStreamErrorData }

export interface DebateViewState {
  phase: DebatePhase
  sessionId: string | null
  rounds: DebateRound[]
  pendingRound?: DebateRound | null
  result: DebateResult | null
  activePersona: AgentPersona | null
  error: string | null
}

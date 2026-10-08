export type BoardTaskStatus = 'pending' | 'in_progress' | 'completed'

export type BoardTask = {
  id: string
  subject: string
  activeForm?: string
  status: BoardTaskStatus
}

export type BoardTokens = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export type BoardAgentStatus = 'running' | 'completed' | 'failed' | 'killed'

export type BoardAgent = {
  id: string
  type: string
  description: string
  model: string
  parentId?: string
  isBackground: boolean
  status: BoardAgentStatus
  startedAt: number
  endedAt?: number
  steps: number
  toolCalls: number
  lastTool?: string
  tokens: BoardTokens
  /** Prompt size of the agent's latest request: how full its context window is. */
  contextTokens: number
  /** Estimated list-price cost in USD; null when a model had no known price. */
  costUsd: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'agent-board': {
      /** Task lists keyed by loop: 'main' or a subagent's id. */
      tasks: Record<string, BoardTask[]>
      agents: BoardAgent[]
    }
  }
}

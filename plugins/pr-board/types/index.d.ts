export type PrActivity = {
  id: string
  kind: 'review' | 'comment' | 'inline'
  author: string
  /** Review state (`CHANGES_REQUESTED`, `APPROVED`...); reviews only. */
  state?: string
  text: string
  /** Set for an inline comment. */
  path?: string
  line?: number
  at: string
}

export type Pr = {
  id: string
  repo: string
  number: number
  title: string
  url: string
  isDraft: boolean
  reviewDecision: string | null
  updatedAt: string
  /** The 20 most recent reviews and comments, newest first. */
  activity: PrActivity[]
}

export type PrLoad = {
  /** `idle` until the first answer; later what the last refresh found. */
  status: 'idle' | 'ok' | 'error'
  /** A refresh is running; what `status` shows stays drawn meanwhile. */
  isLoading: boolean
  prs: Pr[]
  login?: string
  fetchedAt?: string
  error?: string
}

declare module 'claude-code' {
  interface PluginState {
    'pr-board': {
      load: PrLoad
      /** PR id to the ISO time it was last expanded in the pane; mirrors `$.store`. */
      seen: Record<string, string>
      /** Id of the expanded PR. */
      expanded: string | null
    }
  }
}

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
  /** Goes in À corriger: GitHub's reviewDecision is CHANGES_REQUESTED or, when it has none, a reviewer's latest decisive review is. */
  needsChanges: boolean
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
      /** `section:repo` to whether that repository row is expanded, when the person toggled it since the pane opened. Never stored. */
      repoRows: Record<string, boolean>
      /** Sections collapsed since the pane opened. Never stored. */
      closedSections: string[]
    }
  }
}

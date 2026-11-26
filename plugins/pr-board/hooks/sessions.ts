import type { McpToolResult } from 'claude-code'

// The desktop app's tools the mod reads, all read-only. A session id reaches
// `get_status` only once it matches SESSION_SHAPE; the current session is read
// as `self` by the app itself.
export const SESSION_SHAPE = /^local_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export const FAMILY_LIMIT = 200

export type Call = (server: string, tool: string, args: Record<string, unknown>) => Promise<McpToolResult>

const textOf = (result: McpToolResult) => {
  if (result.isError) throw new Error('outil de l’app en erreur')
  return result.content.map(block => (block.type === 'text' ? block.text : '')).join('')
}

const record = (value: unknown): Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('réponse de l’app inattendue')
  return value as Record<string, unknown>
}

/** `owner/name#number`, lower case: how a bound PR and a listed PR are matched. */
export const prKey = (repo: string, number: number) => `${repo.toLowerCase()}#${number}`

const boundOf = (value: unknown): string[] => {
  const status = record(value)
  const prs = [status.pr, ...(Array.isArray(status.otherBoundPrs) ? status.otherBoundPrs : [])]
  return prs.flatMap(pr => {
    if (pr === null || typeof pr !== 'object') return []
    const { repo, number } = pr as { repo?: unknown; number?: unknown }
    return typeof repo === 'string' && typeof number === 'number' && Number.isInteger(number) ? [prKey(repo, number)] : []
  })
}

/**
 * The PRs bound to the current session and to every session it started, at
 * any depth, as `prKey`s. Its parent and siblings, which the linked list also
 * holds, are never read. Any failed call rejects: the caller shows the
 * sessions as unavailable, never as having no PR.
 */
export const readFamilyPrs = async (call: Call): Promise<string[]> => {
  const self = record(JSON.parse(textOf(await call('ccd_session_mgmt', 'get_session', { session_id: 'self' }))))
  if (typeof self.sessionId !== 'string' || !SESSION_SHAPE.test(self.sessionId)) throw new Error('session inattendue')

  const listed = textOf(await call('ccd_session_mgmt', 'list_sessions', { linked: true, limit: FAMILY_LIMIT })).trim()
  // The app answers in prose when the session has no linked session.
  if (!listed.startsWith('[') && !/^No other sessions/.test(listed)) throw new Error('réponse de l’app inattendue')
  const rows: unknown[] = listed.startsWith('[') ? (JSON.parse(listed) as unknown[]) : []
  if (!Array.isArray(rows)) throw new Error('réponse de l’app inattendue')

  const children = new Map<string, string[]>()
  for (const row of rows) {
    const { sessionId, startedBy } = record(row)
    if (typeof sessionId !== 'string' || !SESSION_SHAPE.test(sessionId) || typeof startedBy !== 'string') continue
    children.set(startedBy, [...(children.get(startedBy) ?? []), sessionId])
  }
  const descendants: string[] = []
  const queue = [...(children.get(self.sessionId) ?? [])]
  while (queue.length > 0) {
    const id = queue.shift()!
    if (id === self.sessionId || descendants.includes(id)) continue
    descendants.push(id)
    queue.push(...(children.get(id) ?? []))
  }

  const statuses = await Promise.all([
    call('ccd_pr', 'get_status', {}),
    ...descendants.map(id => call('ccd_pr', 'get_status', { session_id: id })),
  ])
  return [...new Set(statuses.flatMap(result => boundOf(JSON.parse(textOf(result)))))]
}

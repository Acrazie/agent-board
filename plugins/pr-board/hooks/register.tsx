import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Pr, PrLoad } from '../types'
import { clean, fetchOpenPrs } from './github'

const PANE = 'pr-board'
const REFRESH_MS = 2 * 60 * 1000
const SEEN_KEY = 'seen'

const load = atom({ plugin: 'pr-board', key: 'load' } as const, { status: 'idle', isLoading: false, prs: [] } as PrLoad)
const seen = atom({ plugin: 'pr-board', key: 'seen' } as const, {} as Record<string, string>)
const expanded = atom({ plugin: 'pr-board', key: 'expanded' } as const, null as string | null)

const time = (iso: string) => iso.slice(0, 16).replace('T', ' ')
const shortRepo = (repo: string) => repo.replace(/^weeki-io\//, '')

const isNew = (pr: Pr, login: string | undefined, seenAt: string | undefined) =>
  pr.activity.some(item => item.author !== login && (seenAt === undefined || Date.parse(item.at) > Date.parse(seenAt)))

// The one door to the seen state: the atom is the truth, `$.store` its copy.
// Changes run one after another, so a refresh and a click never overwrite each
// other, and the store always ends up holding the last atom value.
let isSeenLoaded = false
let seenQueue: Promise<unknown> = Promise.resolve()

const changeSeen = ($: EngineInterface, change: (seen: Record<string, string>) => Record<string, string>) => {
  const run = async () => {
    if (!isSeenLoaded) {
      const stored = await $.store.get(SEEN_KEY)
      const earlier = stored !== null && typeof stored === 'object' && !Array.isArray(stored) ? (stored as Record<string, string>) : {}
      await update($, seen, current => ({ ...earlier, ...current }))
      isSeenLoaded = true
    }
    const next = await update($, seen, change)
    await $.store.set(SEEN_KEY, next)
  }
  const done = seenQueue.then(run, run)
  seenQueue = done.catch(() => undefined)
  return done
}

/** What the expansion shows of a PR: its newest item, or the moment the data was fetched when it has none. */
const shownUpTo = (pr: Pr, fetchedAt: string) => pr.activity.reduce((latest, item) => (item.at > latest ? item.at : latest), pr.activity[0]?.at ?? fetchedAt)

let isRefreshing = false

const refresh = async ($: EngineInterface) => {
  if (isRefreshing) return
  isRefreshing = true
  try {
    await update($, load, (state): PrLoad => ({ ...state, isLoading: true }))
    let next: PrLoad
    try {
      const { login, prs } = await fetchOpenPrs(argv => $.process.run([...argv], { timeoutMs: 30_000 }))
      next = { status: 'ok', isLoading: false, prs, login, fetchedAt: new Date(await $.clock.now()).toISOString() }
    } catch (error) {
      next = { status: 'error', isLoading: false, prs: [], error: clean(error instanceof Error ? error.message : String(error)) }
    }
    if (next.status === 'ok') {
      const { prs, fetchedAt = '' } = next
      const openId = await read($, expanded)
      // One change before the list is published: drop PRs that left, and
      // count what an expanded PR now shows as seen.
      await changeSeen($, current => {
        const kept = Object.fromEntries(Object.entries(current).filter(([id]) => prs.some(pr => pr.id === id)))
        const open = prs.find(pr => pr.id === openId)
        return open ? { ...kept, [open.id]: shownUpTo(open, fetchedAt) } : kept
      })
    }
    await update($, load, () => next)
  } finally {
    isRefreshing = false
  }
}

const toggle = async ($: EngineInterface, pr: Pr) => {
  if ((await read($, expanded)) === pr.id) {
    await update($, expanded, () => null)
    return
  }
  // The PR as the pane holds it now, which is what the expansion will show.
  const { prs, fetchedAt = '' } = await read($, load)
  const shown = prs.find(one => one.id === pr.id) ?? pr
  await changeSeen($, current => ({ ...current, [shown.id]: shownUpTo(shown, fetchedAt) }))
  await update($, expanded, () => pr.id)
}

export const register: Register = on => {
  let isTimerOn = false

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'prs', description: 'Ouvre le panneau de vos PR ouvertes dans weeki-io' })
    return next(e)
  })

  on('command.run', { command: 'prs' }, async $ => {
    const { isPlaced } = await $.ui.open({ id: PANE, title: 'Pull requests' })
    void refresh($)
    if (!isTimerOn) {
      isTimerOn = true
      $.clock.every(REFRESH_MS, () => void refresh($))
    }
    return { text: isPlaced ? 'Panneau des PR ouvert.' : 'Aucune surface ne peut afficher le panneau des PR.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const state = await read($, load)
    const seenAt = await read($, seen)
    const openId = await read($, expanded)

    const header = (
      <Box flexDirection="row" gap={1}>
        <Button key="refresh" hotkey="r" onPress={() => void refresh($)}>
          Actualiser
        </Button>
        <Text dimColor>
          {state.isLoading ? 'actualisation…' : state.fetchedAt ? `à jour ${time(state.fetchedAt)} UTC` : ''}
        </Text>
      </Box>
    )

    if (state.status === 'error') {
      return (
        <Box flexDirection="column" gap={1}>
          {header}
          <Text color="red" bold>
            Impossible de lire vos PR
          </Text>
          <Text>{state.error ?? 'erreur inconnue'}</Text>
          <Text dimColor>Vérifiez `gh auth status`, puis actualisez.</Text>
        </Box>
      )
    }
    if (state.status !== 'ok') {
      return (
        <Box flexDirection="column" gap={1}>
          {header}
          <Text dimColor>Chargement des PR…</Text>
        </Box>
      )
    }
    if (state.prs.length === 0) {
      return (
        <Box flexDirection="column" gap={1}>
          {header}
          <Text>Aucune PR ouverte dans weeki-io.</Text>
        </Box>
      )
    }

    const newest = (a: Pr, b: Pr) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
    const toFix = state.prs.filter(pr => pr.reviewDecision === 'CHANGES_REQUESTED').sort(newest)
    const rest = state.prs.filter(pr => pr.reviewDecision !== 'CHANGES_REQUESTED').sort(newest)

    const row = (pr: Pr) => (
      <Box key={`row:${pr.id}`} flexDirection="column">
        <Button key={`pr:${pr.id}`} onPress={() => void toggle($, pr)}>
          {openId === pr.id ? '▾' : '▸'} {shortRepo(pr.repo)}#{pr.number} {pr.title} <Text dimColor>{pr.isDraft ? 'draft' : 'prête'}</Text>
          {openId !== pr.id && isNew(pr, state.login, seenAt[pr.id]) ? <Text color="yellow"> nouveau</Text> : null}
        </Button>
        {openId === pr.id && (
          <Box flexDirection="column" paddingLeft={2}>
            <Link href={pr.url}>Ouvrir sur GitHub</Link>
            {pr.activity.length === 0 && <Text dimColor>Aucune revue ni commentaire.</Text>}
            {pr.activity.map(item => (
              <Box key={`a:${item.id}`} flexDirection="column" marginTop={1}>
                <Text dimColor>
                  {item.author}
                  {item.state ? ` · ${item.state}` : ''}
                  {item.path ? ` · ${item.path}${item.line !== undefined ? `:${item.line}` : ''}` : ''} · {time(item.at)}
                </Text>
                <Text>{item.text}</Text>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    )

    return (
      <Box flexDirection="column" gap={1}>
        {header}
        {toFix.length > 0 && (
          <Box flexDirection="column">
            <Text bold color="red">
              À corriger ({toFix.length})
            </Text>
            {toFix.map(row)}
          </Box>
        )}
        {rest.length > 0 && (
          <Box flexDirection="column">
            <Text bold>Ouvertes ({rest.length})</Text>
            {rest.map(row)}
          </Box>
        )}
      </Box>
    )
  })
}

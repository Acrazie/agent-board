import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { FamilyLoad, Pr, PrLoad } from '../types'
import { clean, fetchOpenPrs } from './github'
import { prKey, readFamilyPrs } from './sessions'

const PANE = 'pr-board'
const REFRESH_MS = 2 * 60 * 1000
const SEEN_KEY = 'seen'

const load = atom({ plugin: 'pr-board', key: 'load' } as const, { status: 'idle', isLoading: false, prs: [] } as PrLoad)
const seen = atom({ plugin: 'pr-board', key: 'seen' } as const, {} as Record<string, string>)
const expanded = atom({ plugin: 'pr-board', key: 'expanded' } as const, null as string | null)
// Repository rows the person opened or closed since the pane opened, by
// `section:repo`; absent, a row follows its section's default. Session memory only.
const repoRows = atom({ plugin: 'pr-board', key: 'repoRows' } as const, {} as Record<string, boolean>)
// Sections the person collapsed since the pane opened; every section starts expanded. Session memory only.
const closedSections = atom({ plugin: 'pr-board', key: 'closedSections' } as const, [] as string[])
// Keys of the band Clients that failed on a surface (`ui.fault`); those bands are drawn with their Button instead. Session memory only.
const faultedBands = atom({ plugin: 'pr-board', key: 'faultedBands' } as const, [] as string[])
// Toutes or Cette session, chosen again each time `/prs` opens the pane. Session memory only.
const mode = atom({ plugin: 'pr-board', key: 'mode' } as const, 'all' as 'all' | 'session')
const family = atom({ plugin: 'pr-board', key: 'family' } as const, { status: 'idle', prs: [] } as FamilyLoad)

const time = (iso: string) => iso.slice(0, 16).replace('T', ' ')
/**
 * `HH:MM` at the instant `ms`, shifted by `offsetMinutes` as `Date#getTimezoneOffset` gives it (minutes behind UTC,
 * so -60 for UTC+1). The offset is the one in force at that instant, so a daylight-saving change is followed.
 */
export const clockTime = (ms: number, offsetMinutes: number) => new Date(ms - offsetMinutes * 60_000).toISOString().slice(11, 16)
/** The person's local time of day, as their machine's time zone sets it. */
const localTime = (iso: string) => clockTime(Date.parse(iso), new Date(Date.parse(iso)).getTimezoneOffset())

const shortRepo = (repo: string) => repo.replace(/^weeki-io\//, '')

const ago = (ms: number) => {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  if (minutes < 1) return "à l'instant"
  if (minutes < 60) return `il y a ${minutes} min`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `il y a ${hours} h` : `il y a ${Math.floor(hours / 24)} j`
}

type SectionId = 'fix' | 'open' | 'draft'

// A thin chevron in a fixed mid-grey that reads on light and dark: right when collapsed, down when expanded.
const chevronSvg = (path: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="${path}" fill="none" stroke="#8E8E93" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
const CHEVRON_RIGHT = chevronSvg('M6 4l4 4-4 4')
const CHEVRON_DOWN = chevronSvg('M4 6l4 4 4-4')
// A circular arrow in the chevrons' grey: the refresh control.
const REFRESH_ICON = chevronSvg('M13 8a5 5 0 1 1-1.5-3.5M13 2.5V5h-2.5')
// A translucent mid-grey, close to the desktop's own cards on light and dark.
const BAND = '#8E8E9326'
// The band under the pointer, a little lighter.
const BAND_HOVER = '#8E8E9340'
// Rows of a band's Client region: more than the band's one line and padding, the excess clipped by its cover.
const BAND_ROWS = 3

/** À corriger's repositories start expanded, every other one collapsed. */
const isRepoOpen = (rows: Record<string, boolean>, section: SectionId, repo: string) => rows[`${section}:${repo}`] ?? section === 'fix'

const sectionOf = (pr: Pr): SectionId => (pr.needsChanges ? 'fix' : pr.isDraft ? 'draft' : 'open')

const isBound = (bound: FamilyLoad, pr: Pr) => bound.prs.includes(prKey(pr.repo, pr.number))

/** The PRs the list shows: all of them, or under Cette session only those bound to the session's family. */
const filterPrs = (prs: Pr[], current: 'all' | 'session', bound: FamilyLoad) =>
  current === 'session' && bound.status === 'ok' ? prs.filter(pr => isBound(bound, pr)) : prs

const shownPrs = async ($: EngineInterface, prs: Pr[]) => filterPrs(prs, await read($, mode), await read($, family))

/** PRs newest first, grouped by repository in the order of each one's newest PR. */
const byRepo = (prs: Pr[]) => {
  const groups = new Map<string, Pr[]>()
  for (const pr of [...prs].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))) {
    groups.set(pr.repo, [...(groups.get(pr.repo) ?? []), pr])
  }
  return [...groups]
}

const isNew = (pr: Pr, login: string | undefined, seenAt: string | undefined) =>
  pr.activity.some(item => item.author !== login && (seenAt === undefined || Date.parse(item.at) > Date.parse(seenAt)))

type Seen = Record<string, string>

const isTime = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value))

/** Later stamp per PR; anything that is not a time is dropped. */
const laterOf = (...lists: Seen[]): Seen => {
  const merged: Seen = {}
  for (const list of lists) {
    for (const [id, at] of Object.entries(list)) {
      if (isTime(at) && (merged[id] === undefined || Date.parse(at) > Date.parse(merged[id]))) merged[id] = at
    }
  }
  return merged
}

// The pane's changes (a click, a refresh's result) run one at a time, so each
// one reads `expanded` and `load` as they are and the stamp it writes matches
// what the pane then shows.
let queue: Promise<unknown> = Promise.resolve()
const inQueue = <T,>(task: () => Promise<T>): Promise<T> => {
  const done = queue.then(task, task)
  queue = done.then(
    () => undefined,
    () => undefined,
  )
  return done
}

// The one door to the seen state, called inside the queue. `$.store` is shared
// by every session and the atom is this session's, so each change re-reads the
// store, keeps the later stamp per PR, applies the change and writes the result.
// Losing the stored copy only brings badges back, so a store failure never
// stops the pane.
const changeSeen = async ($: EngineInterface, change: (current: Seen) => Seen) => {
  const stored = await $.store.get(SEEN_KEY).catch(() => undefined)
  const earlier = stored !== null && typeof stored === 'object' && !Array.isArray(stored) ? (stored as Seen) : {}
  const next = await update($, seen, current => change(laterOf(earlier, current)))
  await $.store.set(SEEN_KEY, next).catch(() => undefined)
}

/** The time of the newest item the expansion shows; none for a PR without activity, which stays new for anything that comes. */
const shownUpTo = (pr: Pr) => (pr.activity.length === 0 ? undefined : pr.activity.reduce((latest, item) => (item.at > latest ? item.at : latest), pr.activity[0]!.at))

const stamped = (current: Seen, pr: Pr | undefined): Seen => {
  const at = pr && shownUpTo(pr)
  return pr && at !== undefined ? laterOf(current, { [pr.id]: at }) : current
}

// The expanded PR counts as open only while its row is open in `prs`: a
// reopened pane, a PR that changed section or the Cette session filter can
// hide it, and a hidden PR must never be stamped as seen. Called inside the queue.
const closeHidden = async ($: EngineInterface, prs: Pr[]) => {
  const openId = await read($, expanded)
  const pr = (await shownPrs($, prs)).find(one => one.id === openId)
  const isShown = pr && !(await read($, closedSections)).includes(sectionOf(pr)) && isRepoOpen(await read($, repoRows), sectionOf(pr), pr.repo)
  if (openId !== null && !isShown) await update($, expanded, () => null)
}

let isRefreshing = false
// `/prs` opened the pane: the next refresh to finish picks the mode it opens on.
let isOpening = false

const readFamily = async ($: EngineInterface): Promise<FamilyLoad> => {
  try {
    return { status: 'ok', prs: await readFamilyPrs((server, tool, args) => $.mcp.call(server, tool, args)) }
  } catch {
    return { status: 'unavailable', prs: [] }
  }
}

const refresh = async ($: EngineInterface) => {
  if (isRefreshing) return
  isRefreshing = true
  try {
    await update($, load, (state): PrLoad => ({ ...state, isLoading: true }))
    const bound = readFamily($)
    let next: PrLoad
    try {
      const { login, prs } = await fetchOpenPrs(argv => $.process.run([...argv], { timeoutMs: 30_000 }))
      next = { status: 'ok', isLoading: false, prs, login, fetchedAt: new Date(await $.clock.now()).toISOString() }
    } catch (error) {
      next = { status: 'error', isLoading: false, prs: [], error: clean(error instanceof Error ? error.message : String(error)) }
    }
    const nextFamily = await bound
    await inQueue(async () => {
      await update($, family, () => nextFamily)
      if (isOpening) {
        isOpening = false
        // The pane opens on Cette session when one of the family's bound PRs is in the list.
        const isFamilyListed = next.status === 'ok' && nextFamily.status === 'ok' && next.prs.some(pr => isBound(nextFamily, pr))
        await update($, mode, () => (isFamilyListed ? 'session' : 'all'))
      }
      if (next.status === 'ok') {
        const { prs } = next
        await closeHidden($, prs)
        const openId = await read($, expanded)
        // Drop the PRs absent from this fresh result, and count what an
        // expanded PR now shows as seen, before the list is published.
        await changeSeen($, current =>
          stamped(
            Object.fromEntries(Object.entries(current).filter(([id]) => prs.some(pr => pr.id === id))),
            prs.find(pr => pr.id === openId),
          ),
        ).catch(() => undefined)
      }
      await update($, load, () => next)
    })
  } catch {
    // The pane must not stay on "actualisation…".
    await update($, load, (state): PrLoad => ({ ...state, isLoading: false })).catch(() => undefined)
  } finally {
    isRefreshing = false
  }
}

const toggle = ($: EngineInterface, pr: Pr) =>
  inQueue(async () => {
    if ((await read($, expanded)) === pr.id) {
      await update($, expanded, () => null)
      return
    }
    // The PR as the pane holds it now, which is what the expansion shows.
    const { prs } = await read($, load)
    const shown = prs.find(one => one.id === pr.id)
    await changeSeen($, current => stamped(current, shown)).catch(() => undefined)
    await update($, expanded, () => pr.id)
  }).catch(() => undefined)

// Collapsing a repository also closes the PR expanded in it, so a hidden PR is
// never stamped as seen by a refresh: only Détails clears a badge.
const toggleRepo = ($: EngineInterface, section: SectionId, repo: string, prIds: string[]) =>
  inQueue(async () => {
    const wasOpen = isRepoOpen(await read($, repoRows), section, repo)
    await update($, repoRows, rows => ({ ...rows, [`${section}:${repo}`]: !wasOpen }))
    const openId = await read($, expanded)
    if (wasOpen && openId !== null && prIds.includes(openId)) await update($, expanded, () => null)
  }).catch(() => undefined)

// Leaving Toutes hides the PR expanded outside the family, as collapsing does.
const setMode = ($: EngineInterface, next: 'all' | 'session') =>
  inQueue(async () => {
    await update($, mode, () => next)
    await closeHidden($, (await read($, load)).prs)
  }).catch(() => undefined)

// Collapsing a section hides the PR expanded in it, as a repository does.
const toggleSection = ($: EngineInterface, section: SectionId) =>
  inQueue(async () => {
    await update($, closedSections, closed => (closed.includes(section) ? closed.filter(id => id !== section) : [...closed, section]))
    await closeHidden($, (await read($, load)).prs)
  }).catch(() => undefined)

export const register: Register = on => {
  let isTimerOn = false

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'prs', description: 'Ouvre le panneau de vos PR ouvertes dans weeki-io' })
    return next(e)
  })

  on('command.run', { command: 'prs' }, async $ => {
    await inQueue(async () => {
      await update($, repoRows, () => ({}))
      await update($, closedSections, () => [])
      await update($, mode, () => 'all')
      await closeHidden($, (await read($, load)).prs)
    })
    isOpening = true
    const { isPlaced } = await $.ui.open({ id: PANE, title: 'Pull requests' })
    void refresh($)
    if (!isTimerOn) {
      isTimerOn = true
      $.clock.every(REFRESH_MS, () => void refresh($))
    }
    return { text: isPlaced ? 'Panneau des PR ouvert.' : 'Aucune surface ne peut afficher le panneau des PR.' }
  })

  // A press on a repository band's Client region (`band.tsx`): the same queued toggle as its Button,
  // for a row the pane draws now. The key names the row; the posted data is only checked for its shape.
  on('ui.message', async ($, e, next) => {
    const isToggle = e.data !== null && typeof e.data === 'object' && (e.data as { toggle?: unknown }).toggle === true
    const isRefresh = e.data !== null && typeof e.data === 'object' && (e.data as { refresh?: unknown }).refresh === true
    // R on a focused band refreshes, as the refresh Button's hotkey does where it is drawn.
    if (e.requestId === PANE && e.module.endsWith('band.tsx') && isRefresh) void refresh($)
    else if (e.requestId === PANE && e.module.endsWith('band.tsx') && isToggle) {
      const prs = await shownPrs($, (await read($, load)).prs)
      if (e.element === 'band:refresh') void refresh($)
      else if (e.element === 'band:mode:all' || e.element === 'band:mode:session') {
        // Cette session presses only while the app answered; otherwise its tab is not drawn.
        const id = e.element.slice('band:mode:'.length) as 'all' | 'session'
        if (id === 'all' || (await read($, family)).status !== 'unavailable') void setMode($, id)
      } else if (e.element.startsWith('band:repo:')) {
        const rest = e.element.slice('band:repo:'.length)
        const cut = rest.indexOf(':')
        const section = rest.slice(0, cut)
        const repo = rest.slice(cut + 1)
        const inRow = prs.filter(pr => sectionOf(pr) === section && pr.repo === repo)
        if (inRow.length > 0) void toggleRepo($, section as SectionId, repo, inRow.map(pr => pr.id))
      } else if (e.element.startsWith('band:pr:')) {
        // Only a PR the pane draws now: its section and its repository row are open. The toggle is not awaited: while
        // this hook is still running, a read through its `$` returned the state as it was when the message came, so a
        // toggle queued behind a refresh stamped the list the refresh had just replaced (seen in the tests).
        const pr = prs.find(one => one.id === e.element.slice('band:pr:'.length))
        if (pr && !(await read($, closedSections)).includes(sectionOf(pr)) && isRepoOpen(await read($, repoRows), sectionOf(pr), pr.repo)) void toggle($, pr)
      }
    }
    return next(e)
  })

  // A band's Client failed: the engine leaves it out and does not draw it again, so the band would no longer press.
  // Remember it; the next drawing gives that band its Button.
  on('ui.fault', async ($, e, next) => {
    if (e.requestId === PANE && e.element.startsWith('band:')) {
      await update($, faultedBands, keys => (keys.includes(e.element) ? keys : [...keys, e.element]))
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button, Link } = elements
    // Where the surface draws Svg, the chevron sits left of the Button; the terminal keeps a text glyph in the label.
    // `resolve` completes every table with every name (a missing one draws a fragment), so the surface decides.
    const Svg = e.surface !== 'terminal' && 'Svg' in elements ? elements.Svg : undefined
    // Desktop alone draws a Client among the graphical surfaces (vscode and mobile have none).
    const Client = e.surface === 'desktop' && 'Client' in elements ? elements.Client : undefined
    const glyph = (isOpen: boolean) => (Svg ? '' : isOpen ? '∨ ' : '› ')
    const chevron = (isOpen: boolean) =>
      Svg ? <Svg source={isOpen ? CHEVRON_DOWN : CHEVRON_RIGHT} alt={isOpen ? 'déplié' : 'replié'} width={14} height={14} /> : null
    // One control line, keyed `line:<button key>`: the chevron, the Button, then what is drawn apart from its label.
    const line = (key: string, isOpen: boolean, control: ReturnType<typeof Box>, ...after: (ReturnType<typeof Text> | null)[]) => (
      <Box key={`line:${key}`} flexDirection="row" alignItems="center" columnGap="xs" width="100%">
        {chevron(isOpen)}
        {control}
        {after}
      </Box>
    )
    // On desktop, a control drawn as a full-width rounded grey band keyed `line:<key>`: the chevron, what it shows,
    // then an empty Client `band:<key>` that takes the press (see `ui.message`). The Client lies in a cover pinned to
    // the band's four edges and clipped to it; its region has a fixed height in rows, taller than the band, since a
    // percentage height has nothing definite to resolve against there (one row, or a region that swells the band and
    // spills over its neighbours).
    const band = (key: string, isOpen: boolean, ...shown: (ReturnType<typeof Box> | null)[]) =>
      Client ? (
        <Box
          key={`line:${key}`}
          position="relative"
          flexDirection="row"
          alignItems="center"
          columnGap="xs"
          width="100%"
          backgroundColor={BAND}
          borderStyle="round"
          borderColor={BAND}
          paddingX="sm"
          paddingY="xs"
          hover={{ backgroundColor: BAND_HOVER, borderColor: BAND_HOVER }}
        >
          {chevron(isOpen)}
          {shown}
          {/* Last, so it lies over everything before it; it draws nothing, so all of them stay visible. */}
          <Box position="absolute" top={0} left={0} right={0} bottom={0} overflow="hidden">
            <Client key={`band:${key}`} module="./band.tsx" width="100%" height={BAND_ROWS} />
          </Box>
        </Box>
      ) : null
    const faulted = await read($, faultedBands)
    /** Whether the control `key` is drawn as a pressable band: desktop, and its Client never failed. */
    const isBand = (key: string) => Client !== undefined && !faulted.includes(`band:${key}`)
    const state = await read($, load)
    const seenAt = await read($, seen)
    const openId = await read($, expanded)
    const bound = await read($, family)
    // The terminal has none of the desktop app's tools: no toggle, and the list stays on Toutes.
    const hasToggle = e.surface !== 'terminal'
    const current = hasToggle ? await read($, mode) : 'all'
    const isFiltered = current === 'session' && bound.status === 'ok'

    // One full-width row at the top: the Toutes and Cette session tabs, then the time of the last answer and the refresh icon.
    const countAll = state.status === 'ok' ? state.prs.length : undefined
    const countSession = state.status === 'ok' && bound.status === 'ok' ? state.prs.filter(pr => isBound(bound, pr)).length : undefined
    // A tab on desktop: a rounded band that grows to share the row, pressed through a Client laid over it like the
    // repository bands; the active one carries the bands' grey fill, the other none and dim text, both lighten under the pointer.
    const tabBand = (key: string, isActive: boolean, isPressable: boolean, ...shown: (ReturnType<typeof Box> | null)[]) => (
      <Box
        key={`tab:${key}`}
        position="relative"
        flexDirection="row"
        alignItems="center"
        justifyContent="center"
        columnGap="xs"
        flexGrow={1}
        {...(isActive ? { backgroundColor: BAND } : {})}
        borderStyle="round"
        borderColor={BAND}
        paddingX="sm"
        paddingY="xs"
        {...(isPressable ? { hover: { backgroundColor: BAND_HOVER, borderColor: BAND_HOVER } } : {})}
      >
        {shown}
        {isPressable && Client ? (
          <Box position="absolute" top={0} left={0} right={0} bottom={0} overflow="hidden">
            <Client key={`band:${key}`} module="./band.tsx" width="100%" height={BAND_ROWS} />
          </Box>
        ) : null}
      </Box>
    )
    const tab = (id: 'all' | 'session', label: string, count: number | undefined) => {
      const isActive = current === id
      const text = count === undefined ? label : `${label} ${count}`
      return isBand(`mode:${id}`) ? (
        tabBand(`mode:${id}`, isActive, true, <Text dimColor={!isActive}>{text}</Text>)
      ) : (
        <Button key={`mode:${id}`} variant={isActive ? 'primary' : 'secondary'} dimColor={!isActive} onPress={() => void setMode($, id)}>
          {text}
        </Button>
      )
    }
    // While any app call fails, Cette session gives way to a dim tab that does nothing, and the list stays on Toutes.
    const unavailable = Svg ? tabBand('sessions', false, false, <Text dimColor>Sessions indisponibles</Text>) : <Text dimColor>Sessions indisponibles</Text>
    const refreshControl = isBand('refresh') ? (
      <Box
        key="tab:refresh"
        position="relative"
        flexDirection="row"
        alignItems="center"
        borderStyle="round"
        borderColor={BAND}
        paddingX="sm"
        paddingY="xs"
        hover={{ backgroundColor: BAND_HOVER, borderColor: BAND_HOVER }}
      >
        {Svg ? <Svg source={REFRESH_ICON} alt="Actualiser" width={14} height={14} /> : null}
        <Box position="absolute" top={0} left={0} right={0} bottom={0} overflow="hidden">
          {Client ? <Client key="band:refresh" module="./band.tsx" width="100%" height={BAND_ROWS} /> : null}
        </Box>
      </Box>
    ) : (
      <Button key="refresh" hotkey="r" {...(Svg ? { plain: true } : {})} onPress={() => void refresh($)}>
        ↻
      </Button>
    )
    const top = (
      <Box key="top" flexDirection="row" alignItems="center" columnGap="sm" width="100%">
        {hasToggle ? tab('all', 'Toutes', countAll) : null}
        {hasToggle ? (bound.status === 'unavailable' ? unavailable : tab('session', 'Cette session', countSession)) : null}
        {hasToggle ? null : <Box flexGrow={1} />}
        <Text dimColor>{state.isLoading ? 'actualisation…' : state.fetchedAt ? localTime(state.fetchedAt) : ''}</Text>
        {refreshControl}
      </Box>
    )

    if (state.status === 'error') {
      return (
        <Box flexDirection="column" gap="lg">
          {top}
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
        <Box flexDirection="column" gap="lg">
          {top}
          <Text dimColor>Chargement des PR…</Text>
        </Box>
      )
    }
    const listed = filterPrs(state.prs, current, bound)
    if (listed.length === 0) {
      return (
        <Box flexDirection="column" gap="lg">
          {top}
          <Text>{isFiltered ? 'Aucune PR ouverte liée à cette session.' : 'Aucune PR ouverte dans weeki-io.'}</Text>
        </Box>
      )
    }

    const now = await $.clock.now()
    const rows = await read($, repoRows)
    const closed = await read($, closedSections)
    const badged = (pr: Pr) => openId !== pr.id && isNew(pr, state.login, seenAt[pr.id])

    const sections: { id: SectionId; title: string; prs: Pr[] }[] = [
      { id: 'fix', title: 'À corriger', prs: listed.filter(pr => sectionOf(pr) === 'fix') },
      { id: 'open', title: 'Ouvertes', prs: listed.filter(pr => sectionOf(pr) === 'open') },
      { id: 'draft', title: 'Drafts', prs: listed.filter(pr => sectionOf(pr) === 'draft') },
    ]

    const prRow = (pr: Pr) => (
      <Box key={`row:${pr.id}`} flexDirection="column" alignItems="stretch" width="100%">
        {/* The full title, opening the PR on GitHub. */}
        <Link href={pr.url} label={pr.title} />
        <Text dimColor>
          #{pr.number}
          {pr.isDraft ? ' · draft' : ''} · mise à jour {ago(now - Date.parse(pr.updatedAt))}
          {badged(pr) ? ' · ' : ''}
          {badged(pr) ? <Text color="yellow">nouveau</Text> : null}
        </Text>
        {isBand(`pr:${pr.id}`)
          ? band(`pr:${pr.id}`, openId === pr.id, <Text dimColor>Détails</Text>)
          : line(
              `pr:${pr.id}`,
              openId === pr.id,
              <Box flexDirection="column" alignItems="stretch" flexGrow={1}>
                <Button key={`pr:${pr.id}`} dimColor onPress={() => void toggle($, pr)}>
                  {`${glyph(openId === pr.id)}Détails`}
                </Button>
              </Box>,
            )}
        {openId === pr.id && (
          <Box key={`details:${pr.id}`} flexDirection="column" paddingLeft={2}>
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

    const repoRow = (section: SectionId, repo: string, prs: Pr[]) => {
      const isOpen = isRepoOpen(rows, section, repo)
      return (
        <Box key={`group:${section}:${repo}`} flexDirection="column" alignItems="stretch" width="100%" gap="md">
          {isBand(`repo:${section}:${repo}`) ? (
            band(
              `repo:${section}:${repo}`,
              isOpen,
              <Text>{shortRepo(repo)}</Text>,
              <Box flexGrow={1} />,
              <Text dimColor>{prs.length}</Text>,
              !isOpen && prs.some(badged) ? <Text color="yellow">nouveau</Text> : null,
            )
          ) : (
            // A full-width rounded grey band where Svg is drawn, a plain line on the terminal; the name Button presses.
            <Box
              key={`line:repo:${section}:${repo}`}
              flexDirection="row"
              alignItems="center"
              columnGap="xs"
              width="100%"
              {...(Svg ? { backgroundColor: BAND, borderStyle: 'round', borderColor: BAND, paddingX: 'sm', paddingY: 'xs' } : {})}
            >
              {chevron(isOpen)}
              <Button key={`repo:${section}:${repo}`} {...(Svg ? { plain: true } : {})} onPress={() => void toggleRepo($, section, repo, prs.map(pr => pr.id))}>
                {`${glyph(isOpen)}${shortRepo(repo)}`}
              </Button>
              {Svg ? <Box flexGrow={1} /> : null}
              <Text dimColor>{prs.length}</Text>
              {!isOpen && prs.some(badged) ? <Text color="yellow">nouveau</Text> : null}
            </Box>
          )}
          {isOpen && (
            <Box flexDirection="column" alignItems="stretch" gap="md" paddingLeft={2}>
              {prs.map(prRow)}
            </Box>
          )}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" alignItems="stretch" width="100%" gap="lg">
        {top}
        {sections
          .filter(section => section.prs.length > 0)
          .map(section => (
            <Box key={`section:${section.id}`} flexDirection="column" alignItems="stretch" width="100%" gap="md">
              {line(
                `head:${section.id}`,
                !closed.includes(section.id),
                <Button key={`head:${section.id}`} plain dimColor onPress={() => void toggleSection($, section.id)}>
                  {`${glyph(!closed.includes(section.id))}${section.title}`}
                </Button>,
                <Text dimColor>{section.prs.length}</Text>,
                // A collapsed section carries the badge of the PRs it hides, as a collapsed repository does.
                closed.includes(section.id) && section.prs.some(badged) ? <Text color="yellow">nouveau</Text> : null,
              )}
              {!closed.includes(section.id) && byRepo(section.prs).map(([repo, prs]) => repoRow(section.id, repo, prs))}
            </Box>
          ))}
      </Box>
    )
  })
}

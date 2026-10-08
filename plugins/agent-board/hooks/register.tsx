import { atom, read, update } from 'claude-code'
import type { Color, EngineInterface, Register } from 'claude-code'

import type { BoardAgent, BoardAgentStatus, BoardTask, BoardTokens } from '../types'
import { costOf, windowOf } from './pricing'

const PANE = 'agent-board'
const MAIN = 'main'

const tasks = atom({ plugin: 'agent-board', key: 'tasks' } as const, {})
const agents = atom({ plugin: 'agent-board', key: 'agents' } as const, [])

// Claude Code's mascot, three rows high.
const AVATAR = [' ▐▛███▜▌ ', '▝▜█████▛▘', '  ▘▘ ▝▝  ']

const TYPE_COLORS: Record<string, Color> = {
  'general-purpose': 'claude',
  Explore: 'suggestion',
  Plan: 'planMode',
  fork: 'merged',
  teammate: 'ide',
}
const PALETTE: readonly Color[] = ['success', 'warning', 'merged', 'ide', 'autoAccept', 'permission']

const STATUS_LABEL: Record<BoardAgentStatus, string> = {
  running: '● en cours',
  completed: '✓ terminé',
  failed: '✗ échec',
  killed: '■ arrêté',
}
const STATUS_COLOR: Record<BoardAgentStatus, Color> = {
  running: 'warning',
  completed: 'success',
  failed: 'error',
  killed: 'inactive',
}

const colorOf = (type: string): Color => {
  const known = TYPE_COLORS[type]

  if (known !== undefined) {
    return known
  }

  let hash = 0
  for (const char of type) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  }

  return PALETTE[hash % PALETTE.length] ?? 'claude'
}

const bar = (ratio: number, width: number): string => {
  const filled = Math.round(Math.min(1, Math.max(0, ratio)) * width)

  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

const count = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : `${n}`

const usd = (n: number | null): string =>
  n === null ? '?' : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`

const seconds = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))

  return s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${s}s`
}

const shortModel = (model: string): string => model.replace(/^claude-/, '')

const totalTokens = (t: BoardTokens): number => t.input + t.output + t.cacheRead + t.cacheWrite

const progressOf = (list: readonly BoardTask[]) => {
  const done = list.filter(task => task.status === 'completed').length
  const active = list.find(task => task.status === 'in_progress')

  return { done, total: list.length, label: active?.activeForm ?? active?.subject }
}

const STATUS_BY_REASON: Record<string, BoardAgentStatus> = {
  answer: 'completed',
  aborted: 'killed',
  refusal: 'failed',
  error: 'failed',
}

function patchAgent($: EngineInterface, id: string, fn: (agent: BoardAgent) => BoardAgent) {
  return update($, agents, list => list.map(agent => (agent.id === id ? fn(agent) : agent)))
}

function setTasks($: EngineInterface, loop: string, fn: (list: BoardTask[]) => BoardTask[]) {
  return update($, tasks, map => ({ ...map, [loop]: fn(map[loop] ?? []) }))
}

export const register: Register = on => {
  let hasHinted = false

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'agent-board',
      description: 'Show the subagents pane (type, tokens, context, cost, progress)',
    })

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, tasks, () => ({}))
      await update($, agents, () => [])
    }

    return next(e)
  })

  on('command.run', { command: 'agent-board' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: 'Sub-agents' })

    return { text: opened.isPlaced ? 'Sub-agents pane opened.' : 'Sub-agents pane is waiting for room.' }
  })

  // A subagent starts: give it a card and show the pane.
  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)

    if (started.deny !== undefined || started.agentId === undefined) {
      return started
    }

    const card: BoardAgent = {
      id: started.agentId,
      type: e.subagentType,
      description: e.description,
      model: started.model,
      parentId: e.parentAgentId,
      isBackground: e.background,
      status: 'running',
      startedAt: await $.clock.now(),
      steps: 0,
      toolCalls: 0,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextTokens: 0,
      costUsd: 0,
    }
    await update($, agents, list => [...list.filter(one => one.id !== card.id), card].slice(-50))

    const opened = await $.ui.open({ id: PANE, title: 'Sub-agents' })
    if (!opened.isPlaced && !hasHinted) {
      hasHinted = true
      $.ui.toast('agent-board: /agent-board pour afficher le panneau des sub-agents')
    }

    return started
  })

  // Every model request of a subagent: add its tokens and cost.
  on('turn.step', async function* ($, e, next) {
    const response = yield* next(e)
    const usage = response.usage

    if (e.agentId !== undefined && usage !== null) {
      const tokens: BoardTokens = {
        input: usage.input_tokens,
        output: usage.output_tokens,
        cacheRead: usage.cache_read_input_tokens,
        cacheWrite: usage.cache_creation_input_tokens,
      }
      const cost = costOf(usage.model, tokens)

      await patchAgent($, e.agentId, agent => ({
        ...agent,
        model: usage.model,
        steps: agent.steps + 1,
        tokens: {
          input: agent.tokens.input + tokens.input,
          output: agent.tokens.output + tokens.output,
          cacheRead: agent.tokens.cacheRead + tokens.cacheRead,
          cacheWrite: agent.tokens.cacheWrite + tokens.cacheWrite,
        },
        contextTokens: tokens.input + tokens.cacheRead + tokens.cacheWrite,
        costUsd: agent.costUsd === null || cost === null ? null : agent.costUsd + cost,
      }))
    }

    return response
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) {
      const status = STATUS_BY_REASON[e.reason] ?? 'completed'
      const now = await $.clock.now()
      await patchAgent($, e.agentId, agent => ({ ...agent, status, endedAt: now }))
    }

    return next(e)
  })

  // Any tool a subagent runs counts as its activity.
  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) {
      const tool = String(e.tool)
      await patchAgent($, e.agentId, agent => ({ ...agent, toolCalls: agent.toolCalls + 1, lastTool: tool }))
    }

    return next(e)
  })

  // Task lists, per loop: TaskCreate / TaskUpdate and the older TodoWrite.
  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)

    if (ran.deny === undefined && ran.isError !== true) {
      const task: BoardTask = {
        id: ran.result.task.id,
        subject: e.subject,
        activeForm: e.activeForm,
        status: 'pending',
      }
      await setTasks($, e.agentId ?? MAIN, list => [...list.filter(one => one.id !== task.id), task])
    }

    return ran
  })

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)

    if (ran.deny === undefined && ran.isError !== true && ran.result.success) {
      const { status, subject, activeForm } = e
      await setTasks($, e.agentId ?? MAIN, list =>
        status === 'deleted'
          ? list.filter(task => task.id !== e.taskId)
          : list.map(task =>
              task.id === e.taskId
                ? {
                    ...task,
                    status: status ?? task.status,
                    subject: subject ?? task.subject,
                    activeForm: activeForm ?? task.activeForm,
                  }
                : task,
            ),
      )
    }

    return ran
  })

  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)

    if (ran.deny === undefined && ran.isError !== true) {
      const list: BoardTask[] = e.todos.map((todo, index) => ({
        id: `todo-${index}`,
        subject: todo.content,
        activeForm: todo.activeForm,
        status: todo.status,
      }))
      await setTasks($, e.agentId ?? MAIN, () => list)
    }

    return ran
  })

  // The band above the prompt: the main loop's task progress.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const map = await read($, tasks)
    const list = map[MAIN] ?? []
    const running = (await read($, agents)).filter(agent => agent.status === 'running').length
    const { done, total, label } = progressOf(list)
    const hasTasks = total > 0 && done < total

    if (!hasTasks && running === 0) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const width = Math.max(8, Math.min(30, e.props.bodyColumns - 40))

    return (
      <Box>
        {hasTasks && (
          <Text color="claude" key="tasks">
            Tâches {bar(done / total, width)} {done}/{total}
          </Text>
        )}
        {hasTasks && label !== undefined && <Text dimColor wrap="truncate-end"> · {label}</Text>}
        {running > 0 && (
          <Text color="warning">
            {hasTasks ? ' · ' : ''}
            {running} sub-agent{running > 1 ? 's' : ''} en cours
          </Text>
        )}
      </Box>
    )
  })

  // The side pane: one card per subagent.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, agents)
    const map = await read($, tasks)
    const now = await $.clock.now()
    // Used only for a model the price table does not know.
    const sessionWindow = await $.session.usage().then(
      usage => usage.context.window,
      () => 200_000,
    )
    const width = Math.max(8, Math.min(24, e.props.bodyColumns - 26))

    if (list.length === 0) {
      return <Text dimColor>Aucun sub-agent pour l'instant.</Text>
    }

    const running = list.filter(agent => agent.status === 'running').length
    const prices = list.map(agent => agent.costUsd)
    const total = prices.some(cost => cost === null) ? null : prices.reduce<number>((sum, cost) => sum + (cost ?? 0), 0)

    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>
          {list.length} sub-agent{list.length > 1 ? 's' : ''} · {running} en cours · {usd(total)} au total
        </Text>
        {[...list].reverse().map(agent => {
          const color = colorOf(agent.type)
          const window = windowOf(agent.model, sessionWindow)
          const fill = agent.contextTokens / window
          const own = progressOf(map[agent.id] ?? [])
          const elapsed = seconds((agent.endedAt ?? now) - agent.startedAt)
          const progress =
            agent.status !== 'running'
              ? `${bar(1, width)} ${elapsed}`
              : own.total > 0
                ? `${bar(own.done / own.total, width)} ${own.done}/${own.total}${own.label ? ` · ${own.label}` : ''}`
                : `étape ${agent.steps} · ${agent.toolCalls} outils${agent.lastTool ? ` · ${agent.lastTool}` : ''} · ${elapsed}`

          return (
            <Box key={agent.id} flexDirection="row" gap={1} borderStyle="round" borderColor={color} paddingX={1}>
              <Box flexDirection="column" flexShrink={0}>
                {AVATAR.map(row => (
                  <Text color={color}>{row}</Text>
                ))}
              </Box>
              <Box flexDirection="column" flexGrow={1} flexShrink={1}>
                <Text>
                  <Text bold color={color}>
                    {agent.type}
                  </Text>{' '}
                  <Text color={STATUS_COLOR[agent.status]}>{STATUS_LABEL[agent.status]}</Text>
                </Text>
                <Text dimColor wrap="truncate-end">
                  {agent.description}
                </Text>
                <Text dimColor wrap="truncate-end">
                  {shortModel(agent.model)} · {agent.isBackground ? 'arrière-plan' : 'premier plan'}
                  {agent.parentId ? ' · imbriqué' : ''}
                </Text>
                <Text wrap="truncate-end">
                  Tokens {count(totalTokens(agent.tokens))} (in {count(agent.tokens.input)} · out{' '}
                  {count(agent.tokens.output)} · cache {count(agent.tokens.cacheRead + agent.tokens.cacheWrite)})
                </Text>
                <Text wrap="truncate-end">
                  Contexte {bar(fill, width)} {Math.round(fill * 100)}% de {count(window)}
                </Text>
                <Text wrap="truncate-end">Coût ≈ {usd(agent.costUsd)}</Text>
                <Text color={STATUS_COLOR[agent.status]} wrap="truncate-end">
                  {progress}
                </Text>
              </Box>
            </Box>
          )
        })}
      </Box>
    )
  })
}

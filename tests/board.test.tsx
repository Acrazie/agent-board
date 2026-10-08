import { expect, mock, test } from 'claude-code/testing'

const SPAWN = {
  tool_use_id: 'toolu_1',
  prompt: 'Find the auth middleware',
  description: 'Locate auth code',
  subagentType: 'Explore',
  provider: { plugin: 'engine', tier: 'core' },
  parentModel: 'claude-opus-5-5',
  background: false,
  fork: false,
} as const

const PANE_PROPS = {
  title: 'Sub-agents',
  isFocused: false,
  bodyColumns: 80,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
} as const

test('a subagent card shows its type, tokens, context, cost and status', async ($, on) => {
  mock.clock(on)
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  on('turn.step', async function* (_$, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn',
      usage: {
        model: 'claude-haiku-5-5',
        input_tokens: 100_000,
        output_tokens: 2_000,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    }
  })
  on('turn.complete', (_$, e) => ({ text: e.answer }))

  await $.agent.spawn(SPAWN)
  for await (const _chunk of $.turn.step({
    turnId: 't1',
    index: 0,
    model: 'claude-haiku-5-5',
    messageCount: 1,
    agentId: 'a1',
  })) {
    // drain the stream
  }

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'agent-board',
      surface,
      component: 'Pane',
      props: PANE_PROPS,
      requestId: 'agent-board',
    })
    expect(await ui.find({ type: 'Text', text: /^Explore$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /en cours/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Tokens 102\.0k/ })).toBeDefined()
    // 100k of haiku-5-5's 1M window.
    expect(await ui.find({ type: 'Text', text: /10% de 1\.0M/ })).toBeDefined()
    // 100k * $0.10 + 2k * $0.50 per million = $0.011.
    expect(await ui.find({ type: 'Text', text: /\$0\.01/ })).toBeDefined()
    await ui.unmount()
  }

  await $.turn.complete({
    answer: 'done',
    durationMs: 1000,
    isAborted: false,
    turnId: 't1',
    agentId: 'a1',
    reason: 'answer',
  })
  const ui = await $.ui.mount({
    plugin: 'agent-board',
    surface: 'terminal',
    component: 'Pane',
    props: PANE_PROPS,
    requestId: 'agent-board',
  })
  expect(await ui.find({ type: 'Text', text: /terminé/ })).toBeDefined()
})

test('the band above the prompt shows the main task progress', async ($, on) => {
  on('tool.call', (_$, e) => ({ result: { oldTodos: [], newTodos: 'todos' in e ? e.todos : [] } }))

  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: 'Write tests', status: 'completed', activeForm: 'Writing tests' },
      { content: 'Run tests', status: 'in_progress', activeForm: 'Running tests' },
      { content: 'Ship', status: 'pending', activeForm: 'Shipping' },
    ],
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'agent-board',
      surface,
      component: 'AbovePrompt',
      props: {
        hasSurvey: false,
        isWorking: true,
        maxRows: 10,
        bodyColumns: 100,
        scroll: { offset: 0, bodyRows: 10 },
        view: {},
      },
    })
    expect(await ui.find({ type: 'Text', text: /Tâches .* 1\/3/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Running tests/ })).toBeDefined()
    await ui.unmount()
  }
})

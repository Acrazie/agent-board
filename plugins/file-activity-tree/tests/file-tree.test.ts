import { expect, test } from 'claude-code/testing'

const PANE = {
  component: 'Pane',
  requestId: 'file-activity-tree',
  props: {
    title: 'Claude files',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const ran = (stdout: string) => ({
  value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})
type Found = { text: string; props: Record<string, unknown> }
const row = (ui: { find: (q: { type: string; text: RegExp }) => Promise<Found | undefined> }, name: string) =>
  ui.find({ type: 'Text', text: new RegExp(`${name.replace('.', '\\.')}  `) })

test('edited file turns green after a git commit', async ($, on) => {
  let isClean = false
  on('session.root', () => ({ value: '/repo' }))
  on('tool.call', () => ({ result: {} as never }))
  on('process.run', (_$, e) => {
    if (e.argv.includes('rev-parse')) return ran('/repo\n')
    return ran(isClean ? '' : ' M src/app.ts\0')
  })

  await $.tool.call({ tool: 'Read', file_path: '/repo/README.md' })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/app.ts', old_string: 'a', new_string: 'b' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'file-activity-tree', surface, ...PANE })
    expect((await row(ui, 'app.ts'))?.text).toContain('app.ts  edited')
    expect((await row(ui, 'README.md'))?.text).toContain('README.md  read')
    await ui.unmount()
  }

  // A commit that leaves the file dirty keeps it uncommitted.
  await $.tool.call({ tool: 'Bash', command: 'git commit -m wip' })
  let ui = await $.ui.mount({ plugin: 'file-activity-tree', surface: 'terminal', ...PANE })
  expect((await row(ui, 'app.ts'))?.props.color).toBe('claude')
  await ui.unmount()

  isClean = true
  await $.tool.call({ tool: 'Bash', command: 'git add -A && git commit -m "feat: x"' })
  ui = await $.ui.mount({ plugin: 'file-activity-tree', surface: 'terminal', ...PANE })
  const app = await row(ui, 'app.ts')
  expect(app?.text).toContain('app.ts  committed')
  expect(app?.props.color).toBe('success')
  expect((await row(ui, 'README.md'))?.props.color).toBeUndefined()
  await ui.unmount()
})

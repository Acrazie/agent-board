import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { FileOp, TrackedFile } from '../types'

const PANE = 'file-activity-tree'
const TITLE = 'Claude files'
const files = atom({ plugin: 'file-activity-tree', key: 'files' } as const, [])

const GIT_COMMIT = /\bgit\b[^\n;&|]*\bcommit\b/

const OPS: Record<string, FileOp> = {
  Read: 'read',
  Edit: 'edit',
  Write: 'write',
  NotebookEdit: 'edit',
}

function pathOf(e: Record<string, unknown>): string | undefined {
  const path = e.file_path ?? e.notebook_path
  return typeof path === 'string' && path.length > 0 ? path : undefined
}

function upsert(list: TrackedFile[], path: string, change: (file: TrackedFile) => TrackedFile): TrackedFile[] {
  const found = list.find(file => file.path === path)
  const base: TrackedFile = found ?? { path, op: 'read', isActive: false, isChanged: false, isCommitted: false }
  return [...list.filter(file => file.path !== path), change(base)]
}

function dirname(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut <= 0 ? '/' : path.slice(0, cut)
}

/** Paths git reports as dirty, untracked or ignored, absolute. */
async function dirtyPaths($: EngineInterface, top: string, paths: string[]): Promise<Set<string>> {
  const rel = paths.map(path => path.slice(top.length + 1))
  const status = await $.process.run(
    ['git', '-C', top, 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored', '--', ...rel],
  )
  if (status.exitCode !== 0) return new Set(paths)
  const dirty = new Set<string>()
  const parts = status.stdout.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i] ?? ''
    if (entry.length < 4) continue
    dirty.add(`${top}/${entry.slice(3)}`)
    // A rename or copy carries its origin path as the next entry.
    if (entry[0] === 'R' || entry[0] === 'C') i++
  }
  return dirty
}

/** Marks each changed file green once its repository has it clean. */
async function refreshCommitted($: EngineInterface): Promise<void> {
  const pending = (await read($, files)).filter(file => file.isChanged && !file.isCommitted && !file.isActive)
  if (pending.length === 0) return

  const byTop = new Map<string, string[]>()
  for (const file of pending) {
    const top = await $.process.run(['git', '-C', dirname(file.path), 'rev-parse', '--show-toplevel'])
    if (top.exitCode !== 0) continue
    const root = top.stdout.trim()
    if (!file.path.startsWith(`${root}/`)) continue
    byTop.set(root, [...(byTop.get(root) ?? []), file.path])
  }

  const clean = new Set<string>()
  for (const [top, paths] of byTop) {
    const dirty = await dirtyPaths($, top, paths)
    for (const path of paths) if (!dirty.has(path)) clean.add(path)
  }
  if (clean.size === 0) return

  await update($, files, list =>
    list.map(file => (clean.has(file.path) && file.isChanged ? { ...file, isCommitted: true } : file)),
  )
}

type Node = { name: string; dirs: Map<string, Node>; file?: TrackedFile }

function buildTree(list: TrackedFile[], root: string): Node {
  const top: Node = { name: '', dirs: new Map() }
  for (const file of list) {
    const rel = file.path.startsWith(`${root}/`) ? file.path.slice(root.length + 1) : file.path
    const parts = rel.split('/').filter(part => part.length > 0)
    let node = top
    for (const part of parts.slice(0, -1)) {
      let next = node.dirs.get(part)
      if (!next) {
        next = { name: part, dirs: new Map() }
        node.dirs.set(part, next)
      }
      node = next
    }
    const name = parts[parts.length - 1] ?? rel
    node.dirs.set(`\0${name}`, { name, dirs: new Map(), file })
  }
  return top
}

type Line = { depth: number; text: string; file?: TrackedFile }

function flatten(node: Node, depth: number, out: Line[]): Line[] {
  const children = [...node.dirs.values()].sort((a, b) => {
    if (!a.file !== !b.file) return a.file ? 1 : -1
    return a.name.localeCompare(b.name)
  })
  for (const child of children) {
    if (child.file) {
      out.push({ depth, text: child.name, file: child.file })
      continue
    }
    // Fold chains of single-directory folders into one line: src/app/
    let dir = child
    let label = dir.name
    while (dir.dirs.size === 1) {
      const only = [...dir.dirs.values()][0]!
      if (only.file) break
      dir = only
      label = `${label}/${dir.name}`
    }
    out.push({ depth, text: `${label}/` })
    flatten(dir, depth + 1, out)
  }
  return out
}

type Look = { mark: string; label: string; color?: string; dim?: boolean }

function lookOf(file: TrackedFile): Look {
  if (file.isActive) {
    if (file.op === 'read') return { mark: '◐', label: 'reading', color: 'suggestion' }
    return { mark: '●', label: file.op === 'write' ? 'writing' : 'editing', color: 'warning' }
  }
  if (file.isCommitted) return { mark: '✓', label: 'committed', color: 'success' }
  if (file.isChanged) return { mark: 'M', label: file.op === 'write' ? 'written' : 'edited', color: 'claude' }
  return { mark: '·', label: 'read', dim: true }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'file-tree',
      description: 'Show the files Claude reads, edits and writes, committed ones in green',
    })
    void $.ui.open({ id: PANE, title: TITLE })

    return next(e)
  })

  on('command.run', { command: 'file-tree' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    await refreshCommitted($)

    return { text: 'File tree pane opened.' }
  })

  on('tool.call', async ($, e, next) => {
    const op = OPS[e.tool]
    const path = op ? pathOf(e as Record<string, unknown>) : undefined
    if (!op || !path) return next(e)

    await update($, files, list => upsert(list, path, file => ({ ...file, isActive: true, op: file.isChanged && op === 'read' ? file.op : op })))
    const ran = await next(e)
    const isDone = ran.deny === undefined && ran.isError !== true
    await update($, files, list =>
      upsert(list, path, file =>
        op !== 'read' && isDone
          ? { ...file, isActive: false, op, isChanged: true, isCommitted: false }
          : { ...file, isActive: false },
      ),
    )

    return ran
  }).catch(($, e, next) => next(e)) // tracking never blocks a tool; next replays

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (GIT_COMMIT.test(e.command) && ran.deny === undefined && ran.isError !== true) {
      await refreshCommitted($).catch(() => undefined)
    }

    return ran
  }).catch(($, e, next) => next(e)) // tracking never blocks a tool; next replays

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, files)
    if (list.length === 0) return <Text dimColor>No file touched yet.</Text>

    const root = await $.session.root()
    const lines = flatten(buildTree(list, root), 0, [])
    const room = Math.max(3, (e.viewport?.rows ?? 24) - 4)
    const shown = lines.slice(0, room)
    const committed = list.filter(file => file.isCommitted).length
    const changed = list.filter(file => file.isChanged).length

    return (
      <Box flexDirection="column">
        <Text dimColor>
          {list.length} files · {changed} changed · {committed} committed
        </Text>
        {shown.map(line => {
          const indent = '  '.repeat(line.depth)
          if (!line.file) return <Text dimColor>{`${indent}${line.text}`}</Text>
          const look = lookOf(line.file)
          return (
            <Text color={look.color} dimColor={look.dim} bold={line.file.isActive}>
              {`${indent}${look.mark} ${line.text}  ${look.label}`}
            </Text>
          )
        })}
        {lines.length > shown.length && <Text dimColor>{`… ${lines.length - shown.length} more`}</Text>}
      </Box>
    )
  })
}

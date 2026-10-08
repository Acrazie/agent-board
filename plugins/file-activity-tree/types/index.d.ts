export type FileOp = 'read' | 'edit' | 'write'

export type TrackedFile = {
  /** Absolute path, as the tool received it. */
  path: string
  /** The last operation Claude ran on the file. */
  op: FileOp
  /** A tool call on the file is running right now. */
  isActive: boolean
  /** Claude edited or wrote the file this session. */
  isChanged: boolean
  /** The last change is in a commit (HEAD of the file's repository). */
  isCommitted: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'file-activity-tree': { files: TrackedFile[] }
  }
}

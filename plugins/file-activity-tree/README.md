# file-activity-tree

A Claude Code mod that shows, in a side pane, a live file tree of every file Claude touches in the session:

| Mark | Color | When |
| --- | --- | --- |
| `◐ reading` | cyan | a `Read` is running |
| `● editing` / `● writing` | yellow | an `Edit`, `Write` or `NotebookEdit` is running |
| `M edited` / `M written` | orange | changed, not committed yet |
| `✓ committed` | green | the change is committed |
| `· read` | dim | only read |

- Paths are shown relative to the project root; single-child folders fold into one line (`src/app/`).
- After a successful Bash command running `git … commit`, the mod runs `git status` on the changed files; a file whose working copy is clean turns green. Changing it again turns it back to orange.
- **`/file-tree`** opens the pane and re-checks commits (use it after committing outside Claude).
- Tracking never blocks a tool: if a hook fails, the tool call goes through untouched.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install file-activity-tree --marketplace Acrazie/agent-board
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session).

## Notes

- An unrequested pane needs a terminal at least 144 columns wide; below that, open it with `/file-tree`.
- Commits made outside a Claude Bash call (by you, or by a tool) are picked up on the next `/file-tree`.

## Develop

```
claude --plugin-dir /path/to/agent-board/plugins/file-activity-tree
claude plugin validate plugins/file-activity-tree
claude plugin test plugins/file-activity-tree
```

The plugin API is early access and may change between Claude Code releases (built against 2.1.293).

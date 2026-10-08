# agent-board

Claude Code mods by Acrazie. Each mod lives in its own folder under [`plugins/`](plugins) and installs on its own.

| Mod | What it does |
| --- | --- |
| [agent-board](plugins/agent-board) | Task progress bar above the prompt and a live side pane of running subagents with tokens, context and cost. |
| [file-activity-tree](plugins/file-activity-tree) | Live file tree of what Claude reads, edits and writes; committed files turn green. |

## Install

At the prompt of a Claude Code terminal session, install the mods you want:

```
/plugin install agent-board --marketplace Acrazie/agent-board
/plugin install file-activity-tree --marketplace Acrazie/agent-board
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session).
Already added the marketplace before? Run `/plugin marketplace update agent-board` first.

## Develop

Each mod is a self-contained plugin folder:

```
claude --plugin-dir plugins/<mod>
claude plugin validate .               # marketplace and every listed mod
claude plugin validate plugins/<mod>
claude plugin test plugins/<mod>
```

The plugin API is early access and may change between Claude Code releases (built against 2.1.293).

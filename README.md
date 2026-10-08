# agent-board

A Claude Code mod that shows what is running right now:

- **Task progress bar above the prompt**, fed by the task tools (`TaskCreate`, `TaskUpdate`, `TodoWrite`):
  `Tâches ████████░░░░ 2/5 · Running tests`, plus how many subagents are still running.
- **Sub-agents side pane**, opened as soon as a subagent spawns. One card per subagent:
  Claude avatar colored by agent type, type and status, task description, model,
  background or foreground, tokens (input / output / cache), context window fill,
  estimated cost in USD, and progress (its own task list when it keeps one,
  otherwise steps, tool calls, last tool and elapsed time).
- **`/agent-board`** reopens the pane.

UI labels are in French.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install agent-board --marketplace Acrazie/agent-board
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session).

## Notes

- **Cost is an estimate.** Claude Code reports tokens per request but not cost per subagent,
  so the mod prices tokens with Anthropic first-party list prices (cache writes at 1.25x input),
  kept in [`hooks/pricing.ts`](hooks/pricing.ts). On a Pro/Max subscription it is an API-equivalent
  figure, not what you are billed. A model missing from the table shows `?`.
- Context fill is the prompt size of the subagent's latest request over its model's window.
- An unrequested pane needs a terminal at least 144 columns wide; below that a toast points to `/agent-board`.
- Elapsed time refreshes on each subagent request, not every second.

## Develop

```
claude --plugin-dir /path/to/agent-board
claude plugin validate .
claude plugin test .
```

The plugin API is early access and may change between Claude Code releases (built against 2.1.293).

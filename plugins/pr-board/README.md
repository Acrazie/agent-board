# pr-board

A Claude Code mod that shows your open pull requests in the `weeki-io` organization in a side pane, so you do not have to check GitHub or email for their status.

- **`/prs`** opens the pane. It never opens by itself.
- **À corriger**, first: PRs where GitHub reports `CHANGES_REQUESTED`. A PR stays there until the reviewer approves or dismisses the request, even after you push.
- **Ouvertes**: every other open PR, marked *draft* or *prête*. A PR is never in both sections. Within a section, the most recently updated comes first.
- **nouveau** badge: someone other than you reviewed or commented since you last expanded that PR in the pane.
- Click a PR to expand it: the 20 most recent reviews and comments (author, text, file and line when inline) and a link to GitHub. Expanding clears the badge.
- The pane refreshes when it opens, every 2 minutes, and with the **Actualiser** button (`r`).
- If `gh` fails or is logged out, the pane says so. An empty list always means there are no open PRs.

UI labels are in French.

## Requirements

[`gh`](https://cli.github.com) logged in (`gh auth status`) with access to `weeki-io`. The mod has no token of its own: it runs `gh` as you.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install pr-board --marketplace Acrazie/agent-board
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session).

## Notes

- **Read only.** The mod runs one fixed `gh api graphql` query (see [`hooks/github.ts`](hooks/github.ts)). No text from GitHub is ever used in a command, and nothing is written to GitHub.
- **Review text is display-only.** It is drawn as plain text and never sent to Claude.
- The only thing stored (`$.store`) is, per PR, when you last expanded it. It is local to this machine; losing it only brings the badges back.
- Only the first 50 open PRs of the search are listed.

## Develop

```
claude --plugin-dir /path/to/agent-board/plugins/pr-board
claude plugin validate plugins/pr-board
claude plugin test plugins/pr-board
```

The plugin API is early access and may change between Claude Code releases (built against 2.1.331).

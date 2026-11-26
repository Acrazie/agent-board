# pr-board

A Claude Code mod that shows your open pull requests in the `weeki-io` organization in a side pane, so you do not have to check GitHub or email for their status.

- **`/prs`** opens the pane. It never opens by itself.
- **The top row**: two tabs, **Toutes** and **Cette session**, each with its PR count, sharing the pane's width, then the time of the last refresh in your local time (`18:22`) and a refresh icon. On desktop the tabs and the icon are rounded bands like the repository rows: the active tab is filled grey, the other dim; the whole band is the control. Elsewhere, and for a band whose control failed to load, they are buttons. *Cette session* keeps only the listed PRs bound to the current Claude desktop session and to every session it started, at any depth (`ccd_pr` bindings, including each session's other bound PRs). In a sub-session it shows only that sub-session's own PRs, never its parent's or siblings'. Sections, grouping, *nouveau* and *Détails* work as in *Toutes*. Each `/prs` opens on *Cette session* when one of those PRs is listed, else on *Toutes*; the choice is not remembered. The family and its bindings are re-read on every refresh. If the desktop app's tools fail, *Sessions indisponibles* takes the place of the *Cette session* tab, dim and not pressable, and the pane goes back to *Toutes*; it stays there when the app answers again. A tab pressed while the pane is still loading is kept. A session drawn on no surface of the desktop app (a terminal-only session) has no tabs, and the app's tools are not called.
- **À corriger**, first: PRs where GitHub reports `CHANGES_REQUESTED`. A PR stays there until the reviewer approves or dismisses the request, even after you push. Where GitHub reports no decision at all (the base branch requires no review, as with stacked PRs), a PR is there when at least one reviewer's latest decisive review (approved, changes requested or dismissed; a plain comment does not count) asks for changes; that reviewer's later approval or dismissal takes it out. A decision from GitHub is always the only rule.
- **Ouvertes**: every other ready PR. **Drafts**: every other draft PR. A PR is listed exactly once: a draft that needs changes is in *À corriger*, marked *draft*. An empty section is hidden. Each section has a dim header, its name then its count (`Ouvertes 45`), that collapses or expands it; every section starts expanded.
- Section headers, repository rows and **Détails** carry a thin chevron on their left, pointing right when collapsed and down when expanded. The terminal, which draws no SVG, shows `›` and `∨` at the start of the label instead.
- Within a section, PRs are grouped by repository, one full-width grey row per repository with its name, and its PR count at the right edge (with *nouveau* when collapsed). A click on the name expands or collapses it; on desktop the whole row is the control and lightens under the pointer, but it cannot be reached with Tab. When the pane opens, the repositories of *À corriger* are expanded and every other one is collapsed; this is not remembered across openings. Repositories come by their most recently updated PR, and PRs newest first.
- Each PR shows its full title, a link that opens the PR on GitHub, then a dim line with its number, the time since its last update and its badge (`#53 · mise à jour il y a 2 h · nouveau`), then a **Détails** button.
- **nouveau** badge: someone other than you reviewed or commented since you last opened that PR's details in the pane. A collapsed repository shows it when one of its PRs has it.
- **Détails** (on desktop a full-width grey band like a repository row, pressable anywhere) expands the 20 most recent reviews and comments (author, text, file and line when inline). It is the only thing that clears the badge; expanding a repository does not.
- The pane refreshes when it opens, every 2 minutes, and with the refresh icon (`r`; on desktop, `r` works while one of the pane's bands has the focus). While it runs, the time reads *actualisation…*.
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

- **Read only.** The mod runs fixed `gh api graphql` queries (see [`hooks/github.ts`](hooks/github.ts)). The only values that enter a command are opaque GitHub ids and pagination cursors, checked against a strict pattern first; human-written text (titles, bodies, names, paths) never does. Nothing is written to GitHub.
- **Desktop app, read only.** The mod calls three of the app's tools and nothing else: `ccd_session_mgmt.get_session` (for `self`), `ccd_session_mgmt.list_sessions` (`linked`) and `ccd_pr.get_status` (see [`hooks/sessions.ts`](hooks/sessions.ts)). A session id reaches `get_status` only in the `local_<uuid>` shape. Only open `weeki-io` PRs already in the `gh` list are shown, matched on repository and number.
- **Review text is display-only.** It is drawn as plain text and never sent to Claude.
- The only thing stored (`$.store`) is, per PR, when you last opened its details. It is local to this machine; losing it only brings the badges back. Which sections and repositories are expanded, and the Toutes / Cette session choice, are kept in session memory only.
- Every open PR is listed: the search is read 50 at a time, following GitHub's cursor. If a page fails, the pane shows the error rather than a shorter list.

## Develop

```
claude --plugin-dir /path/to/agent-board/plugins/pr-board
claude plugin validate plugins/pr-board
claude plugin test plugins/pr-board
```

The plugin API is early access and may change between Claude Code releases (built against 2.1.331).

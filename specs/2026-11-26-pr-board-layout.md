# Spec: pr-board layout

Rework the pr-board pane so the user's open PRs are grouped by section, then by repository, with full titles and room between rows. The data, rules and state of the first spec (`specs/2026-11-26-pr-board.md`) stay as they are.

## 1. Starting point

**Why.** The pane is hard to read for three reasons:
- **One flat list.** Every PR sits in one list sorted by update date, so PRs from the same repository are scattered.
- **Cut titles.** Each row is a `Button`, and a desktop `Button` draws on one line and cuts the end (`plugins/pr-board/hooks/register.tsx:189`). Rows read "weeki_map_api#53 ci: ignore in…".
- **No spacing.** Rows sit flush against each other.

**Current state** (all checked 2026-11-26):

| Fact | Source |
|---|---|
| pr-board shipped in Acrazie/agent-board#1, merged 2026-11-26T11:33:45Z | `gh pr view 1 -R Acrazie/agent-board --json state,mergedAt` |
| The user has 44 open PRs in weeki-io, across 42 repositories: weeki_atlas_api and weeki_notebook_api have 2 each, every other repository has 1. 0 are drafts. The longest title is 49 characters. | `gh search prs --owner weeki-io --author @me --state open --limit 100 --json repository,isDraft,title` |
| A `Text` wraps by default. A desktop `Button` always cuts the end. | `types/claude-code.d.ts` 2.1.331, `TextProps.wrap` ("Desktop and VS Code always cut the end") and `ButtonProps` |
| Spacing is set with `gap` on the parent `Box` | `types/claude-code.d.ts`, `BoxProps.gap` |
| The pane today has two sections, *À corriger* and *Ouvertes*, each a flat list | `register.tsx:213-229` |

**First task, before any code.** Branch from `origin/main`, not the old `feat/pr-board` branch, which was deleted on the fork. Then re-probe the facts above.

## 2. Goals and non-goals

**Goals**
1. **Three sections, in this order:** *À corriger*, *Ouvertes*, *Drafts*.
   - *À corriger* keeps today's rule: GitHub's `reviewDecision`, and the reviews fallback when it is null.
   - A draft PR that needs changes appears only in *À corriger*, still marked draft.
   - *Ouvertes* holds ready PRs that need no changes. *Drafts* holds draft PRs that need no changes.
2. **Collapsible repositories.** Inside each section, PRs are grouped by repository. Each repository is one row, "weeki_map_api (2)", that expands and collapses on click.
   - When the pane opens, every repository row in *À corriger* is expanded and every other one is collapsed.
   - Which rows are expanded is not kept across pane openings.
3. **The badge carries to the repository.** A collapsed repository row shows *nouveau* when any of its PRs carries the badge.
4. **Each PR is shown as:**
   - its full title, wrapping, without the repository name;
   - under it, one dim line with the number, the time since the last update and the badge, for example "#53 · mise à jour il y a 2 h · nouveau";
   - a *Détails* button that expands the reviews and comments as today, which clears the badge.
5. **Visible spacing** between sections, between repositories, and between PRs.

**Non-goals**
- Any change to data fetching, the *À corriger* rule, the seen state, the 2-minute refresh, or `/prs`: they work and are out of scope.
- Merged PRs, filters or search: not asked for.
- Remembering expanded repositories across openings: the user chose not to.

## 3. Constraints

**Invariants.** Every invariant in `specs/2026-11-26-pr-board.md` §3 still holds. They are checked as that spec says:
- fixed `gh` commands with only validated ids;
- review text is display-only;
- no secret is stored;
- the other mods are unchanged.

| Invariant | Where it is enforced or detected | Machine or human |
|---|---|---|
| `$.store` still holds only the seen state. Expanded repositories live in session memory. | Test: after expanding repositories, `$.store` keys are unchanged | machine |
| A PR is listed exactly once | Test over a fixture with a draft PR that needs changes | machine |

**Worked examples**
- **Today's data:** *À corriger* and *Drafts* are hidden because they are empty. *Ouvertes* lists 42 collapsed repository rows, and weeki_atlas_api and weeki_notebook_api show "(2)".
- **A repository with one ready PR and one draft PR:** it appears under both *Ouvertes* and *Drafts*, each time with only that section's PR.
- **A new comment on a PR in a collapsed repository:** the repository row shows *nouveau*. Expanding the repository does not clear it. Only *Détails* on that PR clears it.

**Defaults (confirmed)**
1. An empty section is hidden. "No open PRs" and the error view stay as today.
2. Repositories are sorted by their most recently updated PR. Within a repository, PRs are sorted newest first.
3. The repository name is shown in full (`weeki_map_api`).
4. A repository with PRs in two sections appears in each of them.

**Stop and ask** when:
- a surface cannot draw a wrapping title next to a pressable control;
- the layout seems to need any change to fetching or to the seen state.

**Left to the agent:** spacing values, the exact wording of the relative time, the expand glyphs, and internal naming.

## 4. Proof

**Verifies on:** the user's Mac, with `gh` logged in against weeki-io. No environment needs to be set up.

| # | Proves | Surface | Check | Where it runs | Pass signal |
|---|---|---|---|---|---|
| 1 | Goals 1 to 5 and the two new invariants | the pane's rendered tree | `claude plugin test plugins/pr-board` with fixtures covering: section order, a draft PR that needs changes, grouping and counts, expand and collapse, initial state, badge on a collapsed repository, cleared by *Détails* only, title in a `Text` and not in a `Button`, hidden empty section, `$.store` keys | local | every test passes |
| 2 | Goals 1, 2 and 4 on real data | the rendered tree built from real `gh` output | A fresh agent, given only the goals, runs the mod's fixed `gh` command and records its output as a fixture. It renders the pane with that fixture through the test harness and compares the result with `gh search prs --owner weeki-io --author @me --state open`. | the user's Mac | The same PRs, in the right sections and repositories. Every title is complete, and none is inside a `Button`. |
| 3 | The existing invariants | manifests, tests, the mod's source | `claude plugin validate .`, the existing tests of every mod, and a fresh-agent review of every `$.process.run` call | local | zero errors, and only the fixed read-only `gh` commands |

The user's own screenshot of the desktop pane is a human check. It does not count as proof.

Every check must pass to merge.

# Spec: pr-board session filter

Add a "Cette session" filter to the pr-board pane. It shows only the open PRs bound to the current Claude desktop session and to all of its sub-sessions. The data, rules and state of `specs/2026-11-26-pr-board.md` and `specs/2026-11-26-pr-board-layout.md` stay as they are.

## 1. Starting point

**Why.** The pane lists every open weeki-io PR by the user (48 on 2026-11-26), and nothing links a PR to the session that produced it. Work split across a parent session and its sub-sessions ends up as PRs scattered across repositories. Finding them takes a manual search.

**Current state** (all checked 2026-11-26):

| Fact | Source |
|---|---|
| A mod can call the desktop app's servers: `$.mcp.call('ccd_session_mgmt','get_session',{session_id:'self'})`, `list_sessions({linked:true})` and `$.mcp.call('ccd_pr','get_status',{})` all answered `isError=false` | throwaway probe mod `/probe-ccd` run by the user in this session |
| The mod API has no session-family or PR-binding concept: `$.agent.list` covers in-process subagents only, and `$.session` has no parent id | `types/claude-code.d.ts` 2.1.331, l.190-238, l.3448-3715, l.15272 |
| `list_sessions` rows carry `startedBy`, the id of the session that started them. In `linked` mode the list also holds the session's parent and siblings, not only its children. | `ccd_session_mgmt.list_sessions` description, and its output |
| `list_sessions` shows one `prNumber` per session with no repository. `get_status({session_id})` returns `pr {number, repo, url, state, draft}` plus `otherBoundPrs[] {number, repo, state}`. Example: "Plancher Light" shows `prNumber: 55` but `get_status` gives `weeki_agents_api#45` with `weeki_map_api#55` in `otherBoundPrs`. | `list_sessions` and `get_status(local_474a48bc…)` |
| The family "Stratégie de testing microservices Symfony" (`local_82a155ba…`, no PR of its own) has 3 sub-sessions bound to `weeki_agents_api#45`, `weeki_map_api#55`, `weeki_user_api#66` and `weeki_dataset_api_symfony#17`, all open | `list_sessions`, `get_status` |
| The PR list comes from one fixed read-only `gh` GraphQL search (`hooks/github.ts`), now paginated | branch `feat/pr-board-desktop-style`, commit cdf1fa3 |

**I could not verify these:**
- Whether `get_status` accepts another session's id when a mod calls it. The probe only asked for the current session. If it does not, sub-sessions cannot be read.
- Whether the test harness can fake `$.mcp.call`. If it cannot, proof check 1 needs another way to feed the app's answers.

**First task, before any code.**
1. Branch from `feat/pr-board-desktop-style`.
2. Re-probe the facts above, including both unverified ones.
3. If either unverified fact turns out false, stop and report.

## 2. Goals and non-goals

**Goals**
1. **A toggle at the top of the pane** switches between *Toutes* and *Cette session*.
2. **What *Cette session* shows:**
   - In a session with sub-sessions: the PRs bound to it, plus the PRs bound to every sub-session at any depth.
   - In a session without sub-sessions: only its own bound PRs.
   - In a sub-session: only its own bound PRs, never those of its parent or siblings.
3. ***Cette session* filters the existing list.** It keeps only the bound PRs that the current `gh` list already holds, matched on repository and number. Sections, repository grouping, the *nouveau* badge and *Détails* work as in *Toutes*.
4. **When `/prs` opens the pane:** it starts on *Cette session* if the session family has at least one bound PR that is in the list. Otherwise it starts on *Toutes*.

**Non-goals**
- Merged, closed, or non-weeki-io PRs bound to a session: the user chose to show open weeki-io PRs only.
- Reading the desktop app's session files on disk: the user chose the app's tools only.
- Remembering the chosen mode across pane openings.
- Any new `gh` command, or any change to the existing query, with one exception: the query gains a stable order, `sort:created-asc`, so paginated reads do not duplicate or skip PRs opened during a read. User's decision of 2026-11-26, after review round 1.

## 3. Constraints

**Invariants.** Every invariant of both earlier specs still holds: the fixed read-only `gh` commands with validated ids, display-only review text, no stored secret, the other mods unchanged, and `$.store` holding only the seen state.

| Invariant | Where it is enforced or detected | Machine or human |
|---|---|---|
| The mod calls only `ccd_session_mgmt.get_session`, `ccd_session_mgmt.list_sessions` and `ccd_pr.get_status`, all read-only | Test asserting every `$.mcp.call` server, tool and args; a fresh-agent review of every `$.mcp.call` | machine + fresh agent |
| A session id reaches `get_status` only if it has the shape `local_<uuid>` | Test with a malformed id from `list_sessions`: no call is made | machine |
| `$.store` holds only the seen state. The mode lives in session memory. | Test: after toggling, the `$.store` keys are unchanged | machine |
| A failed app call never shows as "no PRs" | Test that fails each call in turn | machine |

**Worked examples**
- **Parent "Stratégie de testing…":** *Cette session* shows `agents_api#45`, `map_api#55`, `user_api#66` and `dataset_api_symfony#17`. The pane opens on *Cette session*.
- **Sub-session "Plancher Light":** *Cette session* shows `agents_api#45` and `map_api#55` only.
- **A session whose bound PRs are all merged or outside weeki-io** (this one: `Acrazie/agent-board#1`, `#2`): the pane opens on *Toutes*. *Cette session* says "Aucune PR ouverte liée à cette session".

**Defaults (confirmed)**
1. Sub-sessions are included at every depth.
2. In the terminal, where the app's tools are absent, the toggle is hidden and the pane stays on *Toutes*.
3. If any app call fails, the toggle reads "Sessions indisponibles" and the pane stays on *Toutes*.
4. An empty *Cette session* says "Aucune PR ouverte liée à cette session", worded apart from the error.
5. The family and its bindings are re-read on every refresh: `/prs`, the 2-minute timer, and the refresh button.
6. Empty sections stay hidden in the filtered view.
7. The work branches from `feat/pr-board-desktop-style`.

**Stop and ask** when:
- a first-task probe fails;
- the filter seems to need a new `gh` command or access to session files.

**Left to the agent:** the toggle's wording and exact position, internal naming, and caching of app calls within one refresh.

## 4. Proof

**Verifies on:** the user's Mac, in the Claude desktop app, with `gh` logged in against weeki-io. No environment needs to be set up.

| # | Proves | Surface | Check | Where it runs | Pass signal |
|---|---|---|---|---|---|
| 1 | Goals 1 to 4 and the new invariants | the pane's rendered tree | `claude plugin test plugins/pr-board` with fixtures covering: a parent with children and grandchildren, a lone session, a sub-session with parent and siblings in the linked list, a session with no open bound PR, each app call failing, a malformed session id, the mode on open, the terminal surface, the `$.store` keys, and the allowed `$.mcp.call` list | local | every test passes |
| 2 | Goals 2 to 4 on real data | the rendered tree built from real app and `gh` output | A fresh agent, given only the goals, records the app's real answers for the "Stratégie de testing…" family (`get_session` as that session, `list_sessions`, `get_status` per session) and the real `gh` output as fixtures. It renders the pane as that parent session and as one sub-session, then compares with `get_status`. | the user's Mac | The parent shows exactly the open weeki-io PRs bound to the family, today `agents_api#45`, `map_api#55`, `user_api#66` and `dataset_api_symfony#17`, and opens on *Cette session*. The sub-session shows only its own. |
| 3 | The existing invariants | manifests, tests, the mod's source | `claude plugin validate .`, every mod's tests, and a fresh-agent review of every `$.process.run` and `$.mcp.call` | local | zero errors; only the fixed read-only `gh` commands and the three read-only app tools |

The user's own screenshot of the desktop pane is a human check. It does not count as proof.

Every check must pass to merge.

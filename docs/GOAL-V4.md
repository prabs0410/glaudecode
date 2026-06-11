# GlaudeCode — V4 Goal: Dogfood Quality Pass ("make every surface honest")

> A standalone autonomous-build target, run the same way as `docs/GOAL.md` (`/goal @docs/GOAL-V4.md`).
> Inherits the north-star, guardrails, and definition-of-done from `docs/GOAL.md` — restated below so
> the loop can't miss the load-bearing ones. **No new features.** Every item here removes a disconnect:
> a surface that renders but isn't truly functional in context ("namesake"), or a V3 claim that isn't
> actually wired end-to-end.

---

## Why this exists

A feature-by-feature dogfood audit (2026-06-11, five parallel read-only auditors over the dock,
sidebar/search, terminal/panes, advanced surfaces, and the engine-RPC surface) found that the app is
~85% genuinely wired (52/61 RPC methods reachable from real UI — *not* a thin-UI problem), but several
surfaces still fail the felt-improvement / honesty bar:

1. The dock-binding fix (bind everything to the active pane) **over-corrected**: genuinely
   *project*-scoped tools (Graph, Memory, Compare) now go dead — `"No project."` — whenever a Shell
   pane is focused, even though a project is open. This is the original "namesake" critique, inverted.
2. Global search queries one **cross-project** index and resumes hits in the wrong directory.
3. The ~99-session sidebar has **no recency sort** — the literal "cluttered" complaint.
4. Two V3 claims aren't real: split panes are **not resizable and not remembered** (the `Splitter` is
   never placed between the panes), and **OSC-7 cwd** is parsed but never shown.
5. Shell integration silently applies **only to zsh**; bash/fish users get nothing and aren't told.

**The filter every item passes (Principle II):** does fixing this make a Claude Code user's work
*actually* better / more honest than today? If an item is cosmetic busy-work, drop it.

---

## Build order: A → B → C → D → E → F (A first — it's the regression + the core complaint)

### V4-A — Project tools stop dying on a Shell pane (the namesake regression) ⚡
Decision (founder, 2026-06-11): **honest empty state** — keep these panels session-bound; don't
silently repurpose them to project scope. Just stop lying about why they're blank.
- **A1 Honest empty states.** When no Claude session is active (Shell pane focused, `dir`/`selectedId`
  null), Graph/Memory/Compare/Replay must show a clear message — e.g. *"Open or focus a Claude session
  to inspect it."* — not `"No project."` (which is false; a project IS open).
  *Acceptance:* with a Shell pane active, each panel shows the new copy; with a Claude pane active,
  behavior is unchanged.
- **A2 Fix ComparePanel wrong-scope (correctness bug, not just wording).** `ComparePanel` lists B-candidates
  with `listSessions(dir)` and reads B with `compareSessions(...,{dir})` where `dir` is session A's cwd
  — which, for a worktree session, is the **worktree path**, a different project scope. List candidates
  against the project root and carry each session's *own* cwd as B's `dir`.
  *Acceptance:* comparing two sessions across a worktree boundary lists the right candidates and reads B
  from B's own directory. Add an engine unit test for the dir-resolution if logic moves into the engine.
- **A3 ResumeBanner timing.** Today it's driven off the *active live pane*, so the "pick it back up"
  recap shows over a session already open/current and **never** for the stale session you're about to
  resume. Drive it off the sidebar-selected (pre-resume) session; hide it when that session is already
  the foreground live pane.
  *Acceptance:* clicking a stale session in the sidebar shows the recap before resuming; an active
  session shows no resume banner.

### V4-B — Search scope + session-list honesty ⚡/🔨
- **B1 Scope global search to the current project.** `search(q)` passes no `dir` → hits leak across every
  project ever indexed, and clicking one resumes in the wrong directory (no cwd). Scope the query (or
  filter hits) to the current project, and carry `cwd` + `title` on each `SearchHit` so resume lands in
  the right dir with a real title.
  *Acceptance:* a search in project X never returns project Y's sessions; opening a hit resumes in that
  session's own cwd. Engine test for the scoping.
- **B2 Sort the sidebar by recency.** `listSessions` renders the SDK's raw order. Sort by `lastModified`
  desc, live sessions first; de-clutter the ~99-session list (recency cap or a Recent / collapsible-older
  grouping — keep it simple). This is the founder's "cluttered" complaint.
  *Acceptance:* most-recently-active sessions are at the top; live sessions are visually first.
- **B3 Stop swallowing search/reindex errors.** Both currently `catch { /* ignore */ }`, so a failed
  reindex shows "No matches (try Index first)" forever. Surface a one-line error state.
- **B4 (stretch) Switch-to-live for external sessions.** "Switch vs resume" only attaches to panes *this
  app* spawned; an externally-started `claude` always spawns a fresh `--resume`. If the engine/adapter
  can report a session as currently running, attach/switch instead. If not feasible through the adapter
  (Principle XI — no raw process scanning), **say so honestly in the UI** rather than implying a switch.

### V4-C — V3 terminal honesty: deliver the claim or retract it 🏗 (short `docs/design/` note first)
- **C1 Split panes actually resizable.** The `<Splitter>` is wired to sidebar/dock only, never between
  the two split panes (fixed 50/50). Render a `<Splitter>` between the two `.pane-mount` elements and
  drive a `flex-basis` on each from a width state.
  *Acceptance:* dragging the divider resizes the split; both panes refit.
- **C2 Remember the split.** `splitPaneId` (and the split width) are never persisted. Persist to
  localStorage like `sidebarW`/`dockW`/`fontSize`/`theme`.
  *Acceptance:* a split layout + ratio survives an app restart.
- **C3 OSC-7 cwd: show it or drop the claim.** `liveCwd` is parsed but only used internally for path
  resolution. Surface it (pane header / status bar) — preferred, it's cheap differentiation — or remove
  "cwd tracking" from the V3 claim.
- **C4 Shell integration beyond zsh (or honest disclosure).** Autosuggestions / smart-Tab / syntax
  highlighting / OSC 133+7 inject only when `$SHELL` basename is `zsh`. Either add a bash
  `PROMPT_COMMAND` path that emits OSC 133/7, or clearly surface *"shell integration: zsh only"* so
  non-zsh users aren't silently degraded.

### V4-D — Empty states & wording ⚡
- **D1 ReplayPanel** shows full chrome + a scary redaction warning with no session selected. Show a
  *"Select a session to export"* empty state when `!selectedId` (keep the import/open-a-bundle path).
- **D2 ComparePanel** red/green Δ (B−A) has no legend. Add a one-line legend (e.g. *"green = B cheaper"*).
- **D3** Sweep the remaining panels for honest empty/zero states while here (cheap, do opportunistically).

### V4-E — Robustness nits ⚡
- **E1 Don't fire app keybindings while typing.** Global keydown dispatch runs app commands even when
  focus is in an editable input (rename box, search). Bail when `document.activeElement` is an
  `input`/`textarea`/`contenteditable`.
- **E2 First-output race.** `TerminalPane` registers the Tauri `listen()` handlers *after* `pty_spawn`,
  so the first PTY output burst (shell banner / fast command) can be dropped. Await both `listen()`
  promises before `pty_spawn`.
- **E3 "Use → pane" mis-target.** `PromptsModal` types a Claude prompt into the active pane regardless
  of kind — it can paste into a Shell pane. Disable/redirect when the active pane isn't a Claude session.
- **E4 Copy-on-select clobber.** Fires on every `onSelectionChange`, including programmatic
  search-decoration selection, so search navigation can overwrite the clipboard. Gate on a real user
  pointer selection.

### V4-F — Dead-code cleanup (decide per item: wire it or delete it) 🔨
- **F1 Orphaned engine.ts wrappers.** Five wrappers are exported but never called: `sessionChanges`
  (superseded by `sessionChangesGit`), `getBudget` (superseded by `budgetStatus`), `listWorktrees`,
  `removeWorktree`, `listSlashCommands`. For each: either build the missing UI (worktree read/remove
  management; slash-command listing in `PromptsModal`) or delete the dead wrapper. Default to **delete
  the superseded two**; **decide** worktree-management and slash-listing (they may be worth a small UI).
- **F2 `fuzzy.ts` unused.** The fuzzy matcher mirror is never imported (sidebar uses substring
  `filterSessions`). Either wire `fuzzyRank` into the sidebar filter (better matching for the long list —
  pairs with B2) or delete the mirror. Default: **wire it** if B2 lands, else delete.

---

## Definition of done (per item)
Acceptance met · pure logic (search scoping, dir resolution, sort, OSC parsing) unit-tested in
`@glaudecode/engine` where applicable · desktop `tsc` + `vite build` clean · Rust `cargo check` green ·
`docs/state.md` + `docs/BUILD-LOG.md` updated · the 🏗 items (V4-C) get a short `docs/design/` note first.

## Guardrails (inherited from `docs/GOAL.md` — the load-bearing ones, restated)
1. **Branch + PR only.** Never commit to `main`. Each item → a `feat/v4-*` branch.
2. **Tests gate.** No item is "done" unless build + its tests pass.
3. **Never destructive.** No force-push, no `main` rewrite, no deleting user data/sessions, no touching
   git identity / `.git/config` / remote. Commits MUST stay **`prabs0410`**; no AI co-author lines.
4. **Adapter rule (Principle XI).** All Claude Code access via `ClaudeCodeAdapter` + SDK; no raw JSONL
   parsing; no tight polling. (Directly constrains B4.)
5. **One item at a time, in order (A→F).** Don't start the next until the current is committed + green.
6. **Stop on repeated failure.** After 2 consecutive failed attempts on an item, STOP and leave a note.
7. **Keep docs honest (Principle IX).** Update `docs/INDEX.md` / `docs/state.md` in the same change.
8. **Felt-improvement filter (Principle II).** If an item turns out cosmetic, drop it — don't pad.

### The one human knob
- **Auto-merge to `main`:** OFF (PRs stay open for human approval). PRs remain blocked on `prabs0410`
  GitHub auth; the loop commits per-item on the branch until then.

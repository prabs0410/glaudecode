# V4-C — Terminal honesty (split panes + OSC-7 cwd + shell-integration scope)

Short design note for the 🏗 items in `docs/GOAL-V4.md` §V4-C. These three either deliver a V3
claim that was never actually wired, or retract it honestly.

## Problem (from the dogfood audit)

- **Split panes are not resizable and not remembered.** `.panes` is a flex row; both visible
  `.pane-mount`s are `flex: 1` (fixed 50/50). The `Splitter` component exists but is only placed
  around the sidebar and dock — never *between* the two panes. `splitPaneId`/width are never
  persisted. V3 claimed "resizable + remembered split panes."
- **OSC-7 cwd is parsed but invisible.** `TerminalPane` tracks `liveCwdRef` from OSC 7 but only uses
  it to resolve relative file-path clicks; nothing shows the cwd. V3 claimed "live cwd."
- **Shell integration is silently zsh-only.** The Rust `setup_zsh_autosuggestions` ZDOTDIR injection
  (autosuggestions, smart-Tab, syntax highlighting, OSC 133/7) only applies when `$SHELL` is zsh.
  bash/fish users get none of it and aren't told.

## Decisions

### C1 — Split panes actually resizable
- All panes stay mounted (display-toggled) to preserve terminal/PTY state; we cannot reorder the DOM
  to physically place a divider between "the two visible ones." Use CSS `order` instead: the active
  pane gets `order:1`, a `<Splitter>` `order:2`, the split pane `order:3`. Non-visible panes are
  `display:none` and drop out of layout, so order 1/2/3 render as `[active][divider][split]`
  regardless of array position.
- Width model: the **active (left) pane** is `flex: 0 0 <splitW>px`; the split (right) pane is
  `flex: 1` (takes the rest). One pixel value drives the divider; the right pane reflows on window
  resize. Drag via the existing `Splitter` (`sign:+1`, the left pane grows as you drag right).
- State `splitW` is lifted to `App` (the Splitter and persistence live there, like `sidebarW`/`dockW`).

### C2 — Remember the split (width, not the pane id)
- Persist **`splitW`** to `localStorage` (`glaude.splitW`), like the other view widths — so your
  preferred split ratio survives a restart and is reused next time you open a split.
- We deliberately do **not** persist `splitPaneId`. Panes are ephemeral: sessions are not
  auto-restored on launch, so a saved pane id would dangle. "Remembered split" therefore means the
  remembered *width*, applied whenever a split is next opened. (Honest scope — documented here and in
  the commit so the V3 claim isn't overstated.)

### C3 — Show the OSC-7 cwd
- Lift the parsed cwd into `TerminalPane` state (`liveCwd`) and render it as a small, dim footer chip
  next to the existing command-duration badge. Keep `liveCwdRef` for the (synchronous) link resolver.
- Only shows once a shell that emits OSC 7 reports a cwd (our zsh integration does); otherwise it
  falls back to the spawn cwd. No claim is made when there's nothing to show.

### C4 — Shell-integration scope: honest disclosure now, bash path later
- The real fix (a bash `PROMPT_COMMAND` that emits OSC 133/7 + a bash autosuggestion story) is a
  larger, separate effort. For V4 we **disclose** rather than fake it: the cwd chip (C3) naturally
  only appears for shells with integration, and this note + the user guide record that
  autosuggestions / smart-Tab / syntax-highlighting / command badges are **zsh-only** today.
- No false affordance is added for non-zsh shells. Adding bash integration is tracked as a
  post-V4 follow-up (felt-improvement filter: build the real thing or say nothing — not a fake chip).

## Test plan
- C1/C2: manual — drag the divider resizes the split; the width persists across an app relaunch.
  (Pure-logic-free; it's layout + a localStorage number, covered by tsc + build.)
- C3: manual — run `cd` in a zsh pane; the cwd chip updates. OSC-7 parsing (`parseOsc7`) is already
  unit-tested in the engine/osc mirror.

## Acceptance
Divider drags and resizes; split width survives relaunch; the cwd chip reflects `cd` in an
integrated shell; the zsh-only scope is documented, with no fake non-zsh affordances.

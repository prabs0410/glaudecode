# V3-E1 — Split Panes (design note)

**Status:** Draft → implementing
**Depends on:** Epic A multi-PTY registry (already ships N live PTYs)

## Problem & value
Today the workspace is tab-only: one pane visible at a time. The common need is to see **two
terminals at once** — e.g. a shell beside a running Claude session, or two sessions side by side —
without tab-switching. The PTY layer already supports many live panes; this is purely a workspace
layout change.

## Scope (V3)
A **2-pane horizontal split**: the workspace shows either a single active pane (tabs, as now) or the
active pane + one secondary pane side-by-side. Both are live panes from the existing registry.
- Toggle via a command/keybinding (`pane.split`, default `mod+d` — iTerm-style).
- Splitting with only one pane open creates a new shell as the secondary.
- The secondary is the *next* tab when there's more than one.
- Closing either visible pane clears the split.
- Switching tabs updates the active (primary) side; the split side is independent.

Equal (50/50) split for V3. A **draggable ratio** and **arbitrary tiling trees** (>2 panes, nesting)
are deferred — bounded scope to avoid a Warp-sized layout engine.

## Architecture
- App gains `splitPaneId: string | null` alongside `activePaneId`.
- `pane.split` toggles it: `null → (next pane | new shell)`, or back to `null`.
- Workspace renders the pane-mounts with `visible = paneId === activePaneId || paneId === splitPaneId`;
  visible mounts are flex children (50/50) in the `.panes` row, hidden ones `display:none` (so their
  PTYs keep streaming, unchanged from today).
- Closing a pane that is the split (or the active when split) clears `splitPaneId`.

## Edge cases
- Only one pane + split → spawn a shell for the secondary.
- Close the split pane → unsplit, keep the primary.
- A backgrounded (non-visible) pane keeps buffering (existing behaviour).

## Test plan
UI/manual (no pure logic): split shows two live terminals; both accept input; unsplit/close behave;
typecheck + build clean. Acceptance: two terminals visible + usable side by side, toggleable.

# V3-E2 — OSC 133/7 Shell Integration (design note)

**Status:** Draft → implementing
**Depends on:** the ZDOTDIR wrapper (V3 autosuggestions), C4 file-path links

## Problem & value
A dumb terminal has no idea where a prompt ends, when a command starts/finishes, what it exited
with, or the live cwd. That blocks two real wins:
- **Command duration + exit-code badges** (how long did that build take? did it pass?).
- **Exact relative file-path resolution** for C4 links (needs the *live* cwd, which changes on `cd`).

The standard, terminal-native mechanism is shell integration via OSC escape sequences (FinalTerm /
iTerm2 / VSCode / WezTerm all use it).

## Approach
Ship a small zsh hook in the ZDOTDIR wrapper that emits, with no visible output:
- `OSC 133 ; A` — prompt start (precmd)
- `OSC 133 ; C` — command about to run (preexec)
- `OSC 133 ; D ; <exit>` — previous command finished, with its exit code (precmd)
- `OSC 7 ; file://<host><cwd>` — current directory (precmd)

The WebView parses these via `term.parser.registerOscHandler(133|7, …)`:
- `C` → record start time; `D` → duration = now − start, exit = code → show a per-pane badge.
- `7` → update the pane's live cwd, which the C4 link resolver then uses for relative paths.

## Pure / tested
`parseOsc133(payload)` → `{ kind, exitCode? }` and `parseOsc7(payload)` → cwd path live in the engine
and are unit-tested; the WebView mirrors them (bundle-safe, like the other mirrors).

## Scope
zsh only for V3 (bash hook later). No full Warp-style "command blocks" — just the badge + cwd. The
badge shows the **last** command's result per pane, subtly. Integration is manual-tested; the parsers
are unit-tested.

## Edge cases
- First `D` before any command → benign (shows a 0 from the shell's initial `$?`).
- A pane running `claude`/a TUI never emits these (no prompt) → no badge, fine.
- Non-zsh shells → no markers → feature simply absent.

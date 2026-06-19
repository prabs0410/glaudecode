# GlaudeCode Diagnostics & Observability — design

**Status:** proposed (2026-06-18) · **Why:** for AI-coded work, silent failure is the enemy — we
must *see* what's happening across engine + desktop + phone and identify root causes fast. Founder
asked to "track everything, monitor everything" after a blank phone screen whose cause (a shell pane
vs. a failed RPC) was indistinguishable. The on-device chat HUD (`e8734d2`) is step one; this is the
broader surface. See memory `feedback-observability-first-debug-everything`.

## The shape: one event stream · three producers · two viewers

```
  ┌── PHONE (PWA) ──┐     ┌── DESKTOP (Rust + WebView) ──┐
  │ rpc fail, ws,   │     │ pty spawn/kill, arm, engine  │
  │ js error        │     │ handshake/respawn, bridge    │
  └──────┬──────────┘     └──────────────┬───────────────┘
         │ POST /diag-log (gated)         │ bridge / local RPC
         ▼                                ▼
       ┌──────────────── ENGINE = the hub ────────────────┐
       │  EventLog  (bounded ring buffer, privacy-safe)    │
       │  + RPC timings, WS lifecycle, pairing, audit      │
       │  + health snapshot (engine/bridge/panes/devices)  │
       └───────────────────────┬──────────────────────────┘
                  diagnostics() RPC (scoped)
            ┌───────────────────┴───────────────────┐
            ▼                                         ▼
   MAC: Diagnostics panel                   PHONE: "Debug" drawer tab
   (live stream + health row)               (same stream + health, gated)
```

### Privacy-safe by construction (the audit principle, extended)
Events carry **metadata only** — method names, scopes, status codes, durations, counts, paneIds,
device ids — **never payloads, keystrokes, file contents, tokens, or command text.** This is the same
rule the existing `AuditLog` already follows ("a byte COUNT, never the bytes"); `EventLog` generalises
it. Held in memory, bounded (~500–1000 events), nothing at rest.

## What's captured (taxonomy)

| Producer | Events |
|---|---|
| **Engine** | `rpc` {method, scope, ms, ok\|errCode} · `ws` {socket, event: open/auth/close, code} · `pair`/`revoke` · `bridge` {connect/disconnect/respawn} · `engine-error` (console.error mirrored) · folds in the existing audit (input/upload/arm/disconnect) |
| **Desktop** | `pty` {spawn/kill, paneId, cmd, cwd-basename} · `arm`/`disarm` · `engine-handshake`/`respawn` |
| **Phone** | `phone-error` (uncaught) · `rpc-fail` {method, code} · `ws` {state, code} — forwarded so they land in the same stream |

### Health snapshot (computed on demand)
engine up · bridge connected (Rust↔engine) · # live panes · # armed panes · # connected phone
devices · remote bind on/off · last error · uptime.

## Surfaces

- **Engine:** `EventLog` class (pure, tested) + `diagnostics({limit, sinceId, filter})` RPC returning
  `{events[], health}`. A `POST /diag-log` endpoint (paired-token gated, rate-limited, privacy-safe)
  lets the phone forward its events. New RPC classified explicitly (`diagnostics` = steer+ read;
  `/diag-log` = steer+ write-own-events).
- **Mac (desktop):** a Diagnostics panel (command-palette + a ⓘ affordance) — a live, filterable event
  stream + the health row. Reuses the engine RPC.
- **Phone:** a 5th drawer tab **Debug** — same stream + health, gated (steer+), plus the existing
  tap-the-chip HUD for the current page. Privacy-safe subset.

## Default verbosity
Capture is **complete** (every RPC, including the 2s polls), but the **view defaults to "errors + key
lifecycle"** (signal), with a one-tap **"everything"** toggle (incl. every RPC/poll). So nothing is
lost, but the stream isn't drowned by routine polling.

## Build phases (incremental, each tested + verified)
1. **Engine `EventLog`** — pure ring buffer + taxonomy + `diagnostics()` RPC + fold in the audit. (unit-tested)
2. **Engine instrumentation** — wrap RPC dispatch + WS lifecycle + pairing to emit events; health snapshot.
3. **Phone Debug tab** — drawer "Debug" section: stream + health; `POST /diag-log` so the phone's own errors join the stream.
4. **Desktop instrumentation** — forward pty/arm/handshake events; **Mac Diagnostics panel**.
5. (later) optional: persist a session to disk on demand ("export diagnostics"), severity filters.

## Open decisions (confirm before building)
- **Phone access to the full stream:** gated steer+ (the founder's own device) vs Mac-only-rich. Lean: phone gets the gated, privacy-safe stream (founder wants it on both).
- **Capture verbosity default:** filtered-by-default with an "everything" toggle (recommended) vs always-everything.
- **Build order:** phone-first (Debug tab — you're testing on the phone) vs engine-core-then-Mac-first.

## Non-goals (for now)
Cross-process distributed tracing, metrics/graphs/perf dashboards, third-party telemetry/export,
anything that persists payloads or secrets.

# Plan — "GlaudeCode sees all my Claude sessions, everywhere"

Status: **PLAN (not built)**. Requested 2026-06-13 after the cockpit only showed the launch
directory's sessions and approvals didn't reach the phone. The user's real workflow: **Claude runs in
a separate terminal app (iTerm/Terminal), in arbitrary directories** — and they want GlaudeCode (desktop
sidebar + phone cockpit) to see and ideally control it.

This plan exists to be honest about **what is feasible vs not** before any building, because the goal
runs into a hard architectural wall that no amount of patching removes.

---

## 1. The hard constraint (read this first)

**GlaudeCode can only *control* a PTY it owns.** When you run `claude` in iTerm, that process and its
terminal belong to iTerm. GlaudeCode has no handle on it. Three consequences:

- **It cannot send keystrokes / a "full terminal" to your phone** for that session — there is no PTY to
  mirror or type into. (Mirroring iTerm would require screen-scraping another app — out of scope and
  fragile.)
- **It cannot inject a steering message** into that live session. The Agent SDK reads sessions; it does
  not push input into a session another process is actively driving.
- **It cannot reliably gate that session's approvals** without a *global* hook (see §4) — a known,
  machine-wide footgun.

What GlaudeCode *can* do for an external session is **observe** it: read its transcript, files changed,
cost, and current state via the SDK. So the honest split is:

| Capability | Claude **inside** a GlaudeCode pane | Claude in a **separate terminal** |
|---|---|---|
| View (timeline / changes / cost / state) | ✅ today (in launch dir) → ✅ everywhere (this plan) | ✅ achievable (this plan) |
| Answer approvals | ✅ (per-project hook + managed) | ⚠️ only via a **global** hook — dangerous (§4) |
| Steer (send a follow-up) | ✅ achievable (own the PTY) | ❌ not feasible (don't own the PTY) |
| Full terminal control on phone | ⚠️ possible later (PTY mirror) | ❌ not feasible (no PTY) |

**Therefore:** "control the entire terminal from my phone" for a Claude you ran in iTerm is **not
achievable**. What *is* achievable is **global VIEW/monitoring** of every session, plus full
control **only** for sessions you run *inside* GlaudeCode. The product choice is which of those to invest in.

---

## 2. Recommended scope

Two independent tracks; pick either or both:

- **Track A — Global VIEW (recommended, achievable, safe-ish).** The desktop sidebar and the phone
  cockpit show **all** your Claude sessions across every project, with read-only inspection
  (timeline/changes/cost/state) and live-running indicators. Fixes "my other-dir session isn't in the
  list" for both desktop and phone. Does **not** give approvals/steering for external sessions.

- **Track B — "Run it in GlaudeCode" for full control.** Lean into making GlaudeCode the terminal you
  run Claude in. The session-detection work already started this (follow-cwd + detect-claude-in-shell).
  Extend it so in-GlaudeCode sessions get approvals + steering + (later) phone control. External
  sessions stay view-only via Track A.

These compose: Track A gives universal visibility; Track B gives full control for the sessions you
choose to run inside GlaudeCode.

---

## 3. Design — Track A (Global VIEW)

### 3.1 Discovery (which projects exist)
- The SDK lists sessions **per dir** only; there is no global list. Discover projects by enumerating
  `~/.claude/projects/*` (each subdir is an encoded cwd). This reads the **directory layout**, not JSONL
  content — content still goes through the SDK (`listSessions`/`getSessionMessages`), so Principle XI's
  "no raw JSONL parsing" holds. **Decision point:** the encoded→cwd mapping is lossy (`/`→`-`); resolve
  the real cwd from `getSessionInfo` rather than decoding the dir name. (Verify the SDK exposes cwd; if
  not, this is a Principle-XI gap to escalate — we must not parse JSONL to recover it.)
- New engine RPC `listAllSessions()` → enumerate projects → `listSessions(dir)` per project → merge,
  tagging each with its project dir. Cache + cap (e.g. N most-recent projects) to bound cost.

### 3.2 Live detection across projects
- Reuse the session-detection heuristic (most-recently-modified = likely live) but globally: a periodic,
  **debounced** scan (not tight-poll — Principle XI) marks sessions whose `lastModified` advanced in the
  last window as "running now". This is what lights up the green dots for an external iTerm session.

### 3.3 Desktop
- Sidebar gains an "All projects" view (current project still default). Group by project; live-first.
- The dock inspects any selected session read-only (already works — it's session-id + dir).

### 3.4 Cockpit
- Replace the hard-coded `defaultDir` with a **project picker** (or an all-sessions list). The cockpit
  calls `listAllSessions()`; tapping a session shows its read-only detail. Approvals panel unchanged
  (only shows what's actually routed — see §4).

### 3.5 Principle XI posture
- Content via SDK only; discovery via dir enumeration (layout, not content). Debounced scans, capped
  breadth. No tight polling. Document the dir-enumeration as an explicit, reviewed exception.

---

## 4. Approvals across projects — the dangerous part

To route approvals from a session in **any** directory, the PreToolUse hook must be in
**`~/.claude/settings.json`** (user-global) instead of per-project. Risks:

1. **Machine-wide stranding (critical).** A global fail-closed hook denies *every* `claude` on the
   machine when the engine/app is down — including agents with nothing to do with GlaudeCode. We already
   hit the scoped version of this ([[project-approval-hook-can-strand-agent]]). Global makes it worse.
   - **Mitigation:** for sessions NOT launched by GlaudeCode, the hook must **fail-OPEN** (allow) when
     the engine is unreachable, and arguably default to allow unless the user explicitly opts a project
     in. The current `GLAUDECODE_MANAGED` gate already no-ops unmanaged sessions — but then external
     sessions get *no* approval routing, which defeats the goal. Squaring this (route approvals for
     external sessions *without* a fail-closed global gate) is the core unsolved design problem.
2. **Every keystroke-tool of every project goes through one queue** — noisy + a bigger steer surface on
   the phone (a paired phone could approve a tool in a project you didn't mean to expose).
3. **Remote exposure broadens** — the cockpit would expose *all* projects' sessions + approvals over the
   tailnet, not one.

**Recommendation:** do **not** ship a global approval hook in Track A. Keep approvals to **projects the
user explicitly enables Smart Approval in** (and, ideally, only GlaudeCode-run sessions). Tell the user
plainly: to answer a session's approvals on the phone, run/enable that session through GlaudeCode.

---

## 5. Security review (delta over the Tailscale cockpit threat-model)

- **Wider data exposure:** global view means the cockpit (over the tailnet) can read *every* project's
  transcripts/changes. A paired phone (or any tailnet peer with the code) now reaches everything, not
  one repo. Mitigations: keep pairing scoped/expiring/revocable; consider a per-project allowlist for
  what remote can see; default remote to current-project-only with an explicit "share all".
- **Filesystem breadth:** enumerating `~/.claude/projects` reveals the names/paths of all projects
  you've ever used to a remote viewer. Consider redacting paths in the remote view.
- **Global hook:** see §4 — recommended against.
- Builds on [[project-epic-g-remote-threat-model]]; that doc's tailnet-only posture still applies.

---

## 6. Effort & phasing

1. **Phase 1 — engine discovery** (`listAllSessions` + global live-detection), tested. ~moderate.
2. **Phase 2 — desktop all-projects sidebar.** ~small–moderate.
3. **Phase 3 — cockpit project picker + read-only session detail on tap.** ~moderate.
4. **Phase 4 (optional, risky) — approvals story.** Only if §4 is solved safely; otherwise document the
   limitation. ~large + security gate.

Track B (full control for in-GlaudeCode sessions) is largely the existing session-detection +
steering/handoff machinery extended — separate effort, separable from A.

---

## 7. Decisions needed from the founder

1. **Track A, Track B, or both?** (A = see everything read-only; B = full control for in-GlaudeCode runs.)
2. **Approvals:** accept "approvals only for GlaudeCode-run / explicitly-enabled projects" (safe), or do
   you want me to attempt the global-hook approach despite the stranding risk (needs a careful fail-open
   design + your sign-off)?
3. **Remote breadth:** should the phone see *all* projects by default, or current-project-only with an
   explicit "share all"? (Security tradeoff.)

Until these are answered, nothing is built. This file is the artifact to react to.

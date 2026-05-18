# GlaudeCode — Handoff to Fresh Session

You are picking up work on **GlaudeCode** in a fresh Claude Code session opened at `/Users/prabhakaranr/Hub/glaudecode/`. The prior session (in `/Users/prabhakaranr/Hub/`) is ending. This document gets you to full context in 5 minutes.

---

## What GlaudeCode is

A **Claude Code Companion CLI** — a meta-layer that sits *above* Claude Code (not competing with it) to add:

1. **Capture + recall** of session work (integrating graphify, not rebuilding it)
2. **Multi-session orchestration** (sessions talk to each other, fork from same context, lifecycle hooks)
3. **Remote cockpit** (mobile + web control of the orchestrator, not just one CC session)
4. **Session UX** (semantic resume, naming, worktree-aware — the pain we hit when sessions-index.json was empty)

Positioning: *"If someone thinks of using Claude Code, they should think of this CLI."*

Read the full README and AGENTS.md in this directory before doing anything else — they're already in place.

---

## Locked decisions (DO NOT re-debate)

| Decision | Value |
|---|---|
| Product name (display) | **GlaudeCode** (PascalCase) |
| Repo slug (URL/dir) | `glaudecode` (lowercase) |
| License | Apache 2.0 |
| Business model | OSS core + paid hosted tier (Continue/OpenHands pattern, decided from day 1 — NOT "figure out monetization later") |
| Repo location | `Hub/glaudecode/`, git repo of its own, branch `main`, remote `github-personal:prabs0410/glaudecode.git` |
| GitHub | `github.com/prabs0410/glaudecode` (live, 5 commits pushed) |
| Memory file | `AGENTS.md` (cross-tool); `CLAUDE.md` symlinked to it |
| V1 scope | All 9 features as thin MVPs (user's explicit call against pushback to ship fewer) |

---

## The 4 primitives × 9 features

| Primitive | V1 features | Strategy |
|---|---|---|
| **Capture + recall** | #1 Memory tab · #7 Knowledge graph | **Integrate graphify** (don't reinvent) |
| **Multi-session orchestration** | #2 Inter-session comm + git worktrees · #5 Fork from same context · #8 Meta-agent across sessions · #9 CLI-level lifecycle hooks | **Build** — none exist well; the strongest defensible wedge |
| **Remote cockpit** | #3 Mobile · #4 Web | **Build at our layer** (Anthropic's Remote Control is for ONE Claude Code session; we orchestrate many) |
| **Session UX** | #6 Continue left-out session | **Build** — fixes the exact pain we hit when `sessions-index.json` was empty and the picker showed only UUIDs |

**Critical reframe (don't lose this):** Our features don't compete with Anthropic's because they operate at a DIFFERENT LAYER. Anthropic features = inside one Claude Code session. Our features = across multiple sessions/worktrees/machines.

---

## The framework stack (hybrid)

Compose these — no single framework fits a solo Claude Code OSS founder cleanly.

### Layer 1: Spec discipline — Spec-Kit (`.claude/commands/speckit.*`)
Already bootstrapped. The 9 slash commands are present in this repo.

Workflow: `/speckit.constitution` → `/speckit.specify` → `/speckit.clarify` → `/speckit.plan` → `/speckit.tasks` → `/speckit.taskstoissues` → `/speckit.implement`

### Layer 2: Engineering discipline — Superpowers (already active globally)
Use these skills (all under `superpowers:*` namespace):
- `brainstorming` — before any creative work / spec
- `writing-plans` / `executing-plans` — for non-trivial tasks
- `test-driven-development` — where rework cost > planning cost
- `verification-before-completion` — evidence before claims
- `systematic-debugging` — when bugs surface
- `using-git-worktrees` — feature isolation
- `dispatching-parallel-agents` — for parallel research/build

### Layer 3: Production discipline — Anthropic-official plugins (already active)
- `feature-dev` — 7-phase feature workflow
- `code-review` — 5 parallel agents reviewing CLAUDE.md compliance, bugs, history
- `pr-review-toolkit` — Silent Failure Hunter, PR Test Analyzer, Comment Analyzer, Type Design Analyzer
- `commit-commands` — `/commit`, `/commit-push-pr`
- `security-guidance` — passive hook watching for risky patterns (it WILL fire on words like the Python serialization library starting with "p", `eval`, etc. — including in documentation. Use generic phrasing in docs)

### Borrowed patterns (no install)
- **BMad's document sharding** — split PRD into per-feature files
- **BMad's adversarial review** — separate session for QA pass before merge
- **Aider's architect/editor split** — design inspiration for V2+ multi-model routing

### What we explicitly SKIPPED (don't propose these)
- BMad full install (12-agent role theater, ~$847/mo token cost for solo)
- Ruflo / claude-flow (multi-agent swarm, wrong abstraction)
- Task Master (redundant with Spec-Kit's `/taskstoissues`)
- Kiro (proprietary, AWS-locked)
- `ralph-loop` (autonomous iteration, dangerous for production OSS)

---

## Per-feature workflow loop

For each of the 9 features, run this loop:

```
1. Skill brainstorming           (Superpowers — explore intent + edge cases)
2. /speckit.specify              (WHAT + WHY, no stack)
3. /speckit.clarify              (surface gaps)
4. /speckit.plan                 (HOW + stack decisions)
5. /speckit.tasks                (epics → stories → tasks)
6. /speckit.taskstoissues        (push to GitHub Issues)
7. Skill writing-plans           (per non-trivial task)
8. Skill test-driven-development (where it pays)
9. Skill verification-before-completion (before claiming done)
10. /code-review + pr-review-toolkit
11. /commit-push-pr
```

---

## Immediate next action: `/speckit.constitution`

**This is what you do first.** Lock the project's non-negotiables before any feature spec.

The constitution should cover:

1. **Mission** — what GlaudeCode is and explicitly is not
2. **Scope boundary** — meta-layer above Claude Code; not a competitor, not a replacement
3. **Code quality bar** — TDD where rework cost > planning cost; verification-before-completion mandatory; PRs must pass pr-review-toolkit before merge
4. **License** — Apache 2.0 (already locked; restate as non-negotiable)
5. **OSS-core vs paid-tier split** — define what's free forever and what's paid. Suggested cut: free = single-machine multi-session local; paid = team sync, cross-machine state, audit logs, hosted dashboard
6. **Versioning** — semver from day 1; v0.x = pre-stable, breaking changes allowed; v1.0+ = stable
7. **Release cadence** — undefined yet; propose weekly during pre-1.0
8. **Contributor governance** — solo founder owns until first external contributor; no formal CLA for v0.x
9. **AGENTS.md as memory standard** — every feature spec MUST update AGENTS.md
10. **Anthropic relationship** — work WITH not against; if Anthropic ships a feature natively, our version may deprecate

Suggest using `Skill brainstorming` first to stress-test these principles before committing.

---

## Critical context to NOT forget

### Founder reality
- Solo, no capital, no team
- 3 months of research-loop without shipping anything
- Stated goal: $1K/month in 90 days; bigger dream: vibe coding terminal platform
- The user explicitly chose to ship V1 with ALL 9 features (against my push to ship 3-4); they accepted the over-engineering risk
- The user wants discipline (PRD → epics → stories → tasks → PR review) and code quality

### Strategic risks the constitution should acknowledge
- **Anthropic ships our features natively within 3-6 months** — defense is community gravity + cross-tool support + OSS speed
- **Graphify owns the memory wedge** — we integrate, don't compete
- **OSS without monetization plan dies** — paid tier MUST be designed alongside OSS, not after

### Don't lose these reframes that took the prior session a while to land
- "Meta-layer above Claude Code" ≠ "Better Claude Code"
- Anthropic's mobile/web = control of ONE CC session. Ours = control of the multi-session orchestrator
- Anthropic's hooks = fire on tool use inside a session. Ours = fire on session lifecycle (created, forked, merged, mobile-approved, worktree-switched)

---

## Reference paths (read these for full detail)

| Path | Purpose |
|---|---|
| `Hub/glaudecode/README.md` | Public-facing pitch |
| `Hub/glaudecode/AGENTS.md` | Cross-tool agent memory (you should expand this as work progresses) |
| `Hub/glaudecode/.specify/templates/constitution-template.md` | Template for `/speckit.constitution` to fill |
| `Hub/glaudecode/.claude/commands/speckit.*.md` | The 9 Spec-Kit slash commands |
| `Hub/docs/research/cli-landscape/MASTER-SYNTHESIS.md` | Why we picked the meta-layer angle (CLI competitive landscape, 5 options ranked) |
| `Hub/docs/research/cli-landscape/01-terminal-emulators.md` | Why Warp owns AI-terminal category |
| `Hub/docs/research/cli-landscape/04-pain-points.md` | Top 10 pains in this category with cited evidence |
| `Hub/docs/research/cli-landscape/05-wishlist-emerging.md` | AGENTS.md = #1 unmet demand (3,890 reactions) |
| `Hub/docs/research/dev-frameworks/MASTER-SYNTHESIS.md` | Why this exact framework stack (Spec-Kit + Superpowers + Anthropic plugins) |
| `~/.claude/projects/-Users-prabhakaranr-hub/memory/MEMORY.md` | Auto-memory: founder context, server details, prior decisions |

---

## Skills the fresh session should use

In order of likely invocation:

1. **`Skill brainstorming`** (Superpowers) — before writing the constitution
2. **`/speckit.constitution`** (Spec-Kit) — writes the constitution doc
3. **`Skill writing-plans`** (Superpowers) — when planning any non-trivial work
4. **`Skill verification-before-completion`** (Superpowers) — before claiming any artifact is done
5. **`Skill using-git-worktrees`** (Superpowers) — when feature work begins, for isolation

---

## What NOT to do in the fresh session

- Don't re-debate the locked decisions (name, license, V1 scope, framework stack)
- Don't propose ripping out Apache 2.0 for MIT or AGPL — debated and locked
- Don't suggest fewer than 9 features in V1 — user already overrode this
- Don't pivot to building Masterpack or another product first — user explicitly chose this direction over Masterpack
- Don't propose BMad / Ruflo / Task Master as primary frameworks — debated and explicitly skipped
- Don't fabricate evidence for any claim. If unsure, say so.

---

## The very first message to the user in the fresh session

Something like:

> "Read this handoff. I've internalized GlaudeCode's positioning, the locked decisions, the framework stack, and the 4-primitive / 9-feature scope. The immediate next action is `/speckit.constitution` — want me to brainstorm the principles first (Skill brainstorming) or jump straight into the constitution?"

That's it. Welcome to GlaudeCode. Ship something real this time.

---

*Handoff written 2026-05-18 by prior session. All paths absolute. All claims traceable to docs/research/ artifacts.*

# AGENTS.md — glaudcode

> **Cross-tool agent memory.** Read by Codex CLI, Cursor, Windsurf, GitHub Copilot natively.
> Claude Code reads `CLAUDE.md` (symlinked to this file).

## Project

**glaudcode** — the Claude Code Companion CLI. A meta-layer above Claude Code that handles multi-session orchestration, cross-session memory, mobile/web control, and CLI-level lifecycle hooks.

## Status

🚧 Pre-PRD. Project bootstrapped 2026-05-14 using Spec-Kit (`.specify/`) + Anthropic-official plugins + Superpowers (already active in workspace).

## Current focus

Drafting the constitution via `/speckit.constitution`. See `.specify/memory/constitution.md` once created.

## How to work in this repo

- Specs live in `.specify/specs/`. One folder per feature.
- Run `/speckit.constitution` first (locks non-negotiables)
- Then `/speckit.specify` → `/speckit.clarify` → `/speckit.plan` → `/speckit.tasks` → `/speckit.implement`
- Use `Skill writing-plans` (Superpowers) for non-trivial features before implementing
- Run `pr-review-toolkit` before opening PRs
- Use `/commit-push-pr` to finalize

## Stack

- Spec-Kit for spec → tasks → issues pipeline
- Superpowers for engineering discipline (TDD, planning, debugging)
- Anthropic-official plugins: feature-dev, pr-review-toolkit, code-review, commit-commands, security-guidance

## Out of scope (deferred)

- Web/mobile control surfaces (V2 — needs hosted tier built first)
- Knowledge graph (integrate graphify instead of building)
- BMad-style multi-agent role play
- Auto-iteration loops (ralph-loop and similar)

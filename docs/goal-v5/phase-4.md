# Phase 4 — Mobile input UX  ·  me-first #1  ·  `feat/v5-mobile-ux`

> Reading outline. **`README.md` is authoritative + what the loop runs** — see its Phase 4 section for full Files / Sub-tasks / Verify / Review per task.

Make `/app/term` genuinely thumb-drivable. Backend (terminal scope, arming, INPUT path, flow control, ring replay, `listPanes`) is already done — this is mostly phone-side `termPage.ts`/`cockpit.ts` + one new engine RPC. Design: `docs/design/mobile-terminal-control.md` §5.

- **Story 4.1 — Mode A "Message" textarea (robust 80% default)**
  - 4.1.1 Multi-line textarea + Send vs Insert, bracketed paste [🔨]
  - 4.1.2 Mode A/B/C tabbed input surface [⚡]
- **Story 4.2 — Mode B "Keys" bar pinned above the keyboard (MANDATORY)**
  - 4.2.1 VisualViewport pinning [🏗] · [HUMAN-GATE: real iOS/Android QA]
  - 4.2.2 Sticky/chainable Ctrl + Shift-Tab + full key set [🔨]
- **Story 4.3 — Mode C semantic layer (the differentiation)**
  - 4.3.1 Engine `promptState` RPC [🏗] · [FOUNDER-DECISION: omit pill when not derivable]
  - 4.3.2 AskUserQuestion tappable buttons [🔨] · [HUMAN-GATE: arrow-count nav vs live TUI]
  - 4.3.3 Mode pills + chips + one-tap snippets [🔨]
- **Story 4.4 — Multi-session steering (session list = home)**
  - 4.4.1 State dots + approval/question badges on terminal rows [🔨]
  - 4.4.2 Explicit attach/detach [🔨]
- **Story 4.5 — Resize authority + real-device hardening**
  - 4.5.1 Resize authority: desktop-authoritative + phone "take control" [🏗] · creates `pty_resize_internal` + bridge RESIZE op · security-review · [FOUNDER-DECISION: desktop-authoritative + take-control]
  - 4.5.2 Real-device QA pass + emulation-fragility iteration [🔨] · [HUMAN-GATE: physical iOS+Android QA]

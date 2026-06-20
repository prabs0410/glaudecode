# Handoff — conversation-page UX: live-tested fixes + the test rig (2026-06-20)

**Branch:** `feat/v6-conversation` · **HEAD:** `b5d3c77` (pushed to origin, in sync) · gate green (engine 500 · desktop 9).

## Why this exists

The founder tried to actually *use* the V8 mobile conversation page and it was "all there but not usable —
developed for namesake." The V8 work had shipped "green" on unit tests but its **lived UX was never
validated**. This records the fixes made after driving the real page, the **reusable rig** for doing that,
and the founder's **still-pending UX feedback** (more is coming — this is NOT the finished UX).

See memory `feedback-test-the-lived-ux` for the durable lesson: unit-green ≠ usable; drive the rendered UI.

## What was fixed (commit `b5d3c77`, all verified in a real browser at a phone viewport)

1. **Layout overlap (root cause of "input not visible").** `#chat` was `position:absolute; top:39px;
   bottom:0` (the bar is 56px → chat top hid behind it) while `#composer` was `position:fixed; bottom:0`
   floating *on top of* the chat — covering the last messages and, with the keyboard up, the input. →
   Rebuilt as a **flex column** (`body` flex column, `#bar` flex:0, `#chat` flex:1 min-height:0, `#composer`
   flex:0; the `#dbg`/`#engineban` banners moved in-flow) + **`100dvh`** so the mobile keyboard shrinks the
   viewport and the composer rides above it. Verified: no overlap, composer fully visible.
2. **Puck not draggable.** Repositioning only engaged after a 260ms *pause*, and continuous motion re-armed
   that timer — so a normal drag never moved it. → A **deliberate drag** (still moving 240ms+ after
   touch-down) now picks it up; a **quick flick** (<240ms) still fires an arrow. Verified `dragMoved:true`,
   `quickFlickMoved:false`. Idle puck is now semi-transparent (opacity .72).
3. **No collapse.** Added a persisted **"⌄ shortcuts"** chevron that folds the key-bar row away.

All in `packages/engine/src/conversationPage.ts` (the served template literal).

## The reusable test rig (USE THIS for any conversation/term page change)

The served phone pages are engine-served strings, so to drive them in a browser:

1. **Throwaway engine** (isolated, mints a real token without the app):
   ```ts
   // /tmp/ux-engine.ts
   import { startEngineServer } from "/Users/prabhakaranr/Hub/glaudecode/packages/engine/src/server";
   const s = startEngineServer({ token: "uxtest", port: 52940, configHome: "/tmp/gc-uxtest-home" });
   const tok = s.pairing.redeem(s.pairing.createPairCode("terminal").code, "ux-browser").token;
   console.log("UXENGINE " + JSON.stringify({ port: s.port, token: tok }));
   ```
   `bun /tmp/ux-engine.ts &` → grab the printed token. Restart it to pick up `conversationPage.ts` edits.
2. **chrome-devtools MCP:** `new_page http://localhost:52940/app` → `evaluate_script` to set
   `sessionStorage` `ck.token`+`ck.scope="terminal"` → `resize_page` to ~390×844 → `navigate_page` to
   `/app/chat?pane=main` → `take_screenshot` + `evaluate_script` to measure `getBoundingClientRect`
   overlaps and simulate `PointerEvent` drags. (Running it from the repo root makes it find real sessions.)

## Running state at handoff

- The GlaudeCode **app** is running; its engine sidecar respawned (pid changed) — to be CERTAIN the app
  serves the latest `conversationPage.ts`, **bounce the engine / relaunch the app** (C1 means paired phones
  survive the respawn — no re-pair). The throwaway engine (52940) has exited.
- To device-test push, the founder still needs to enable **Tailscale Serve / HTTPS** (founder-gated).

## STILL PENDING — the founder has MORE UX feedback (this is the next work)

These three fixes are a **start, not the finished UX.** Known rough edges to revisit + whatever the founder
raises next:
- The puck has **four overloaded gestures** (tap=Enter / flick=arrows / hold=radial / drag=move) — hard to
  discover/predict; likely needs a simpler model.
- **Steer scope has no composer** (the input path is terminal-only), so a steer device can't send follow-ups
  from the chat — reconcile with the product intent (BL-6 typed-send was deferred).
- General spacing / discoverability / "feels unfinished" polish.
- **Next step:** do a proper usability pass — drive the page (rig above), let the founder point at the worst
  parts, fix → re-verify live. Do NOT claim a UI fix works without rendering it.

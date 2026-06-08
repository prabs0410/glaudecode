# Epic G — Web + Mobile Cockpit

**Status:** Draft for review (largest epic; build last)
**Depends on:** V1 engine RPC; Epic A (multi-session); Epic C (approvals — the killer mobile feature)
**Features:** web access, mobile live control

## 1. Problem & user value
"Use it anywhere." You start agents at your desk, walk away, and from a browser or phone you can see
what they're doing, **answer their approval prompts**, and send follow-ups. The differentiated angle
(vs Anthropic's single-session remote control) is **controlling many sessions** from one place.

**Felt-improvement test:** approve-from-your-phone while agents run is genuinely differentiated and
high-value. Full terminal pixel-mirroring to mobile is *not* the wedge — it's heavy and lower value.

## 2. Research / constraints & honest scoping
- The engine **already** serves HTTP/WS on `127.0.0.1` with a per-launch bearer token (V1). The
  cockpit serves the React UI from the engine and exposes the RPC + an event stream over WS.
- **Transport for "anywhere" is user-provided in the OSS tier** (constitution Principle V): LAN,
  Tailscale, SSH tunnel, cloudflared. GlaudeCode does **not** build hosted tunneling in OSS V2 — that's
  the paid tier later.
- **The PTY lives in the desktop Rust core, not the engine** — so full terminal mirroring to a remote
  client means relaying raw PTY bytes over WS. That's heavy and fragile on mobile. **V2 scope =
  "view + steer," not pixel-mirroring:**
  - **View:** session list + live agentState/timeline/cost/changes (all already computed by the engine).
  - **Steer:** answer approval requests (Epic C approvals already round-trip through the engine — a
    remote client can answer them — *this is the killer feature*), send a follow-up prompt (via
    resume/inject), and fork/handoff.
  - Full terminal mirroring = tracked stretch, not V2-blocking.

## 3. Architecture
### 3.1 Engine RemoteServer (extend V1)
- Serve the built web client at `/app` (PWA manifest → installable, works on mobile browsers).
- WS endpoint for live event push (state/timeline/cost/changes/approval-needed) so the cockpit
  updates without polling.
- **Bind policy:** default `127.0.0.1` (unchanged). Remote requires explicit opt-in to bind a chosen
  interface, and is meant to sit behind the user's transport (Tailscale/tunnel).

### 3.2 Pairing & auth (security-critical)
- The per-launch bearer token is not shareable to a phone safely. Add a **pairing flow**: desktop
  shows a QR/code; the client exchanges it for a **scoped, expiring session token**. Tokens are
  revocable; list/revoke paired devices in the desktop UI.
- All remote traffic assumes TLS when off-localhost (the user's tunnel typically provides it; document
  the requirement).

### 3.3 Web client (reuse V1/V2 React)
- A `packages/web` (or a build target of the existing UI) that reuses the sidebar, right dock, status
  bar — but talks to the engine over WS instead of Tauri `invoke`. The engine client abstraction from
  V1 (`engine.ts`) gets a transport seam (Tauri-invoke vs WS) so components don't change.
- **Mobile = the same web client**, responsive layout; the primary mobile surfaces are the session
  list, live state, and the **approval card**.

## 4. Data model
```ts
interface PairCode { code: string; expiresAt: string }
interface PairedDevice { id: string; name: string; pairedAt: string; lastSeen?: string }
interface RemoteToken { token: string; scope: "view"|"steer"; expiresAt: string }
// Reuses V1/V2 view types (SessionSummary, AgentState, TimelineEntry, SessionCost, ChangeEntry, ApprovalRequest)
```

## 5. Edge cases & failure modes
- **Engine not reachable** (desktop asleep / tunnel down) → cockpit shows a clear disconnected state;
  read-only cache of last-known.
- **Token leak / lost device** → revoke from desktop; short token TTL limits exposure.
- **Two clients answering one approval** → first write wins; the rest get "already decided."
- **Binding to a public interface by mistake** → loud warning; default stays localhost; require explicit
  confirm to expose.
- **Mobile network flakiness** → WS auto-reconnect with backoff; idempotent steer actions.

## 6. Security (the heart of this epic)
- **Default localhost-only**, unchanged. Remote is explicit opt-in.
- **Pairing, scoped + expiring tokens, revocable devices** — never reuse the raw engine token remotely.
- **TLS required off-localhost** (documented; the user's transport provides it).
- **Scope tokens:** "view" vs "steer" so a shared link can be read-only.
- This epic must pass `security-guidance` review and a deliberate threat-model pass before merge
  (Principle XI mindset — we're exposing the engine).

## 7. Test plan
- **Unit (pure):** pairing token issue/verify/expire/revoke; scope enforcement; WS message framing.
- **Integration:** pair a mock client, stream events, answer an approval end-to-end against the engine.
- **Manual:** real phone over Tailscale — view sessions, receive + answer an approval, send a follow-up.

## 8. Acceptance criteria
- From a browser (and a phone browser) on a user-provided transport: see all sessions + their live
  state; **answer an approval request**; send a follow-up prompt; fork/handoff.
- Pairing issues a scoped, expiring, revocable token; default remains localhost-only; exposing requires
  explicit confirm.
- Disconnect/reconnect handled gracefully.

## 9. Open questions (for review)
1. **Confirm V2 scope = "view + steer," terminal pixel-mirroring deferred?** (Strongly recommended —
   it's heavy and not the wedge.)
2. **`packages/web` separate target vs a build mode of `packages/desktop`'s UI** — recommend a shared
   `packages/ui` the desktop and web both consume (small refactor, pays off here).
3. **Paid hosted tier** (managed transport/tunnel) is explicitly out of OSS V2 — confirm it stays a
   later, separate effort.

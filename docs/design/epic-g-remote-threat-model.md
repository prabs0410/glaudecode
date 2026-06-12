# Epic G — Remote cockpit threat-model & security review

Owed before remote bind is used (recorded as a project obligation). Written for the **Tailscale-only**
remote path shipped on `feat/remote-cockpit-tailscale`. Scope: exposing the engine so a phone on the
user's tailnet can reach the cockpit (view sessions + answer approvals).

## Assets at risk

1. **Claude Code sessions** — transcripts, file changes, cost. Reading them leaks source + prompts.
2. **Steering capability** — answering approvals lets a holder *approve tool calls* the agent is
   about to run (Bash/Edit/Write). This is the highest-value asset: it can cause code execution.
3. **The engine bearer token** — full local authority over the engine. Must never leave the Mac.
4. **`.claude/settings.json` / hooks** — local-only; rewriting them runs shell on the host.

## Trust boundaries

- **Localhost listener (127.0.0.1)** — the desktop WebView. Authed by the engine bearer token.
  Unchanged by this work.
- **Remote listener** — a *second* Bun.serve bound **only to the Mac's Tailscale IPv4** (`100.x.y.z`),
  started on demand. Reachable solely by devices on the user's tailnet. WireGuard provides transport
  encryption (so the token/pairing-code never travel in cleartext). **Never** binds `0.0.0.0`, the
  LAN IP, or a public interface.
- **Paired device** — holds a *scoped, expiring, revocable* pairing token, NOT the bearer token.

## Attack surface & mitigations

| Vector | Mitigation |
|---|---|
| Arbitrary internet host hits the engine | Remote listener binds the Tailscale IP only; not routable off the tailnet. |
| Eavesdropping the token/code on the wire | Tailscale (WireGuard) encrypts all tailnet traffic end-to-end. |
| A view-only device tries to steer | FAIL-SAFE scope policy: read methods are `view`; **everything else defaults to `steer`**, so a new mutating RPC is never silently exposed to a view token. Enforced per-request before dispatch. |
| A paired phone tries to widen exposure / read bind config | `enableRemote`/`disableRemote`/`remoteStatus` are **LOCAL_ONLY** — only the desktop bearer can call them; a pairing token gets 403. |
| A phone tries to rewrite host hooks | `installApprovalHook`/`uninstall`/`approvalHookStatus` are LOCAL_ONLY. |
| Stolen/again-used pairing code | Codes are single-use, expiring, and exchanged for a token over the tailnet only. |
| Lost device | Revoke from the desktop (Pairing modal) — tokens are in-memory + revocable; nothing at rest. |
| Code execution via approvals | The steer scope is opt-in per pairing (checkbox); pair view-only to deny it. |

## Residual risks (accepted / to revisit)

1. **Anyone on the user's tailnet can reach the listener.** The tailnet may include other people's
   nodes if the user has shared machines / uses a shared tailnet. The pairing token is the gate, but
   the *listening port is visible* to tailnet peers (they can hit `/pair`, `/app`). Acceptable for a
   personal tailnet; revisit with Tailscale ACLs guidance for shared tailnets.
2. **No app-level rate-limiting on `/pair`.** Codes are short (8 hex). They're single-use + expiring,
   but a tailnet peer could brute-force within the validity window. Pre-1.0: add attempt throttling.
3. **Bearer-token-scoped WS subscribe is `view` for any valid token.** Fine (view only), but the WS
   currently broadcasts the approvals snapshot to all sockets; a paired view device sees pending
   approvals. Intended, noted.
4. **Tailscale IP resolution shells out to the `tailscale` CLI.** If a malicious binary named
   `tailscale` is earlier on PATH it could return a bogus IP; we also try the App-bundle path. The
   bind still only succeeds on an interface the OS owns. Low risk on a single-user Mac.

## Explicitly out of scope (not built)

- Public tunnels (cloudflared/ngrok) — higher exposure; not wired.
- LAN/`0.0.0.0` bind — rejected: no TLS, broad surface.
- Persisting remote-enabled across launches — remote starts **off** every launch; the user re-enables
  deliberately (a safe default). The engine also `disable()`s the remote listener on shutdown.

## Posture summary

Default-off, localhost-only. Remote is an explicit, per-session toggle that binds **tailnet-only**
behind WireGuard, with fail-safe scope enforcement and local-only control of the exposure itself. The
highest residual risk is a shared tailnet; single-user personal tailnets are well covered.

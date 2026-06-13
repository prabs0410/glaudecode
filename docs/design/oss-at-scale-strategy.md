# Strategy Brief: Open-Sourcing GlaudeCode's Phone-Driven Terminal at Scale

**Status:** Strategy brief for founder decision (not a verdict). Author: lead author, on behalf of the build.
**Scope:** The single-user analysis is settled. Everything here is the *multi-user / OSS delta*.
**Verification:** Every load-bearing code claim was checked against the repo and independently verified. Where a verification verdict added a caveat or refuted part of a draft claim, it is corrected inline and flagged. Verified-but-narrowed claims are marked **[verified, narrowed]**; partly-refuted claims are marked **[corrected]**.

---

## 1. TL;DR

Open-sourcing at scale does not change what GlaudeCode must *build* so much as what its *defaults* must guarantee: the median operator stops being an expert, the install becomes a Shodan/Censys-searchable fingerprint, and the **shipped defaults — not the shipped capabilities — define fleet-wide risk**. A weak default that one expert would harden becomes a fleet-wide remote-code-execution (RCE) footgun across thousands of machines, and the category that was white space a year ago is now occupied by Anthropic's Remote Control and the OSS leader Happy — so the bar moves from "ship a phone-driven terminal" to "ship the secure-by-default, real-terminal, no-third-party-plaintext one." The architecture is genuinely ahead of comparable OSS web-terminals (auth-on, localhost-default, in-memory revocable scoped tokens, a fail-safe RPC scope policy), so this is a *defaults-and-governance* problem, not a rebuild.

**The 3–5 biggest decisions:**

1. **Build app-layer end-to-end encryption (E2E) before opening the repo.** Today confidentiality is 100% transport-delegated; the app ships no cipher. This is the single change that turns "configure Tailscale correctly or get owned" into "pick any transport; the worst case is leaked ciphertext" — and it is the precondition for *ever* safely running a relay.
2. **Add a dedicated `terminal` scope, enforced at the WebSocket message handler**, before the keystroke mirror ships. The PTY mirror is RCE and must not ride on `steer`.
3. **Ship a self-host relay recipe, not a managed relay you run.** No revenue engine + a remote-shell payload = an unfunded, abuse-magnet cost center.
4. **Position on depth + trust, not category.** "Real terminal, on your machine, no cloud we run — not even Anthropic's." Out-depth the conversation-only leaders rather than re-enter an occupied category.
5. **Tier the OS support honestly: macOS + Linux Tier 1, Windows experimental (WSL recommended).** Two founder calls remain open (below): keep-awake scope, and the Windows tier label.

---

## 2. Secure-by-default requirements (mandatory pre-launch)

Guiding principle (CISA secure-by-default): at scale the secure path must be the **default the user gets**, not the hardening they are trusted to perform. Each requirement is mapped to current code; verification status is noted.

- **R1 — Auth on by default, no kill switch for auth.** Keep bearer + pairing; never add a `--no-auth` / `--insecure` convenience flag. This is the ttyd/GoTTY original sin and the FastGPT `--auth none` → unauthenticated-RCE pattern. *Status: already true; protect it with a release-blocking test.*

- **R2 — No loopback→wildcard footgun. [verified, narrowed]** `127.0.0.1` stays the hard default. The gap is real in code: `remote.enable(host)` (server.ts:72–81) trims the host, throws only if empty, then binds it verbatim via `Bun.serve({ hostname: h, ... })` with **no check that it is loopback or a Tailscale (100.64.0.0/10) address** — `0.0.0.0` / `::` / a LAN IP would all bind. **Narrowing (do not overstate):** `enableRemote` is classified `LOCAL_ONLY`, so a paired phone can never call it — this is a *self-inflicted, locally-triggered* gap, not remotely reachable. The only shipped caller (`PairingModal`) sources the host from the Rust `tailscale ip -4` command and never accepts free-form input, so a wildcard string cannot arise through today's UI. It is therefore a **latent defense-in-depth gap** (any future programmatic local caller, or an unexpected `tailscale` output, hits it unchecked), not a live exposure in normal use. **Fix:** reject wildcards outright, require a specific interface, gate behind a logged in-app security confirmation, and **refuse non-loopback bind unless app-layer E2E (R5) is active.**

- **R3 — No token in URL. [verified, and worse than drafted]** Confirmed live: `cockpit.ts` builds `/ws?token=` and `server.ts:130–131` reads the token from the query string. This leaks via browser history and `Referer` **today** (the phone browser). **Two corrections from verification:** (a) the "proxy/CDN logs" vector is *not live under today's localhost + Tailscale-only defaults* — a tailnet has no third-party plaintext intermediary; it becomes live only when a reverse-proxy/CDN transport is added, which is exactly the OSS-at-scale path, so the concern is correctly *forward-looking* but not live on that sub-vector yet. (b) Severity is **higher** than drafted: server.ts:131 accepts the **per-launch local bearer token** (the engine's master RPC credential) on `/ws`, not only a scoped paired token — a leak here can expose the primary credential. **Fix:** authenticate via the first WS message (or a short-lived single-use WS ticket minted over the authed channel) **and stop accepting the local bearer on `/ws`.** Do **not** pair this with a CSWSH claim — `/ws` uses a secret token and no cookies, so blind cross-origin connects get 401; the issue is the leak vector, not cross-site hijacking. (sessionStorage for the token is already correct.)

- **R4 — Rate-limit + lockout on `/pair`. [verified, narrowed]** Confirmed unauthenticated and unthrottled (server.ts:120; a repo-wide grep for rate-limit/throttle/lockout/429/backoff across engine + Rust returned zero hits). **Entropy correction:** the code is *not* "8-char uppercase" (36⁸); it is uppercased UUID hex — alphabet `[0-9A-F]`, i.e. **16⁸ ≈ 4.3 billion** (~650× less than the draft implied). Combined with a 2-minute single-use TTL and usually one live code, practical brute-force success per window is low against today's localhost default — so "online-brute-forceable" holds in the OWASP *no-temporal-barrier* sense, not as a turnkey exploit today. It becomes a real risk the moment the cockpit binds to a remote/multi-user interface, where the keyspace is the *sole* defense. **Fix:** per-IP + global throttling (code-server's **2/min + 12/hr** is a verified-exact baseline from `src/node/routes/login.ts`), exponential backoff, temporary lockout, log every failed redemption — and ideally widen the code's entropy.

- **R5 — App-layer E2E (the headline delta). [verified]** The repo has the pairing half (`PairingService` is genuinely good — scoped/expiring/revocable, in-memory, `crypto.randomUUID`) but **zero confidentiality**: `remote.ts` is a ~24-line JSON event framer (`frameEvent`/`parseFrame`), and a full grep of `packages/` for encrypt/decrypt/nonce/AEAD/AES/ChaCha/x25519/Noise/libsodium found **no application-code matches**. Confidentiality is 100% transport-delegated. **Important framing correction:** this does **not** contradict the "~80% to an app-layer E2E mirror" number — that figure (transport-options doc §5) explicitly defined the 80% as completed *scaffolding* (PTY + engine WS + xterm.js + `PairingService` tokens) and named the *unbuilt* remainder as "key exchange, session keys, mobile crypto, predictive echo." The 80% and "no encryption yet" are consistent; the missing crypto is the hardest, most security-critical 20%. Also note: transport-delegated confidentiality is genuinely Tier-A-safe over Tailscale/WireGuard/direct-peer — "no app-layer E2E" is **not** "insecure today"; it only blocks blessing convenient Tier-B vendor tunnels (Cloudflare/ngrok-HTTP), which is exactly what non-expert OSS users will reach for. **Fix:** a PAKE/SPAKE2 handshake **seeded by the existing pair code** (the code becomes the PAKE password, not a cleartext bearer), wrapping RPC + the planned PTY frames in an AEAD session (Noise / X25519 + ChaCha20-Poly1305; WASM-available, Bun has WebCrypto).

- **R6 — Dedicated `terminal` scope + per-pane opt-in, enforced at the WS message handler. [verified]** Confirmed: scopes are `view` | `steer` only (`pairing.ts:8`, mirrored verbatim at `desktop/src/engine.ts`), and no `terminal` scope exists anywhere. The PTY lives in the Rust core; a phone keystroke mirror routes arbitrary bytes into `pty_write` → a live shell = RCE by definition. The risk of riding on `steer` is concrete, not hypothetical: `methodScope()` defaults every *unlisted* method to `steer`, so a new PTY-input RPC would silently inherit it and widen every steer-paired phone into full RCE. **The WS failure class is present in this codebase right now:** the `/ws` upgrade authenticates by token *validity only* — it does **not** check scope (any valid token, even view-only, can upgrade) — and the `message()` handler is an unguarded no-op (server.ts:103–105). Scope enforcement exists only on the HTTP `/rpc` path, not the WS channel. This is exactly the ttyd `callback_tty` (CVSS up to 9.8) and Gitpod WS-RCE (CVE-2023-0957) class: handshake auth ≠ message auth. **Fix:** add a strictly-higher `terminal` scope, never implied by `steer`; per-pane arming, **default off** (GoTTY read-only-by-default generalized); **enforce on every inbound keystroke frame at the WS message handler** *and* require the `terminal` scope at the `/ws` upgrade (defense in depth — the upgrade currently lets any valid token through); add the arm / `pty:write` methods to `LOCAL_ONLY_METHODS` so a paired phone can never widen its own access. **Caveat:** there is no live RCE today (WS is push-only, PTY reached via Tauri localhost IPC) — this is a *design requirement for the planned mirror*, not a present vulnerability. But note the remote listener shares the same handler/sockets as localhost, so the moment remote bind is enabled the unguarded message path is network-exposed — get the scope check in *before* any mirror ships.

- **R7 — Audit, echo, kill-switch.** Log every remote action with device id + timestamp; show a live "remote is driving pane X" indicator (echo lets the local operator see a hijack); one-keystroke kill-switch tears down all tokens + the remote listener.

- **R8 — Short-lived rotating terminal tokens.** 24h (the pairing default) is long for an RCE-capable token; cap the `terminal`-scope TTL (≤1h) with silent refresh. View can stay longer.

- **R9 — Safe cockpit transport headers.** Strict CSP, `Referrer-Policy: no-referrer`, CORS pinned to origin on the remote listener too.

- **R10 — Updater signature verification as a P0 gate** (see §7). For an auto-updating shell, a tricked updater is one-shot mass-RCE.

---

## 3. Onboarding / transport posture

**Bless exactly one posture, not one transport: secure-by-default E2E, transports pluggable underneath as dumb pipes.** The user sees "pair my phone" (QR + typed-code fallback), never "configure Tailscale" or an IP/port/ACL.

Why E2E is load-bearing: the transport landscape splits on *who sees plaintext*. With app-layer E2E keyed out-of-band by the pair code, the engine↔phone stream is ciphertext regardless of pipe — Cloudflare Tunnel, ngrok, a relay, even a misconfigured Tailscale ACL all collapse to reachability-only. This is the VS Code Dev Tunnels model (broker for NAT traversal, E2E inside) and the Magic Wormhole model for the handshake. It converts the single-user instruction "configure the ACL correctly" — an expert task that **will not happen** at scale — from a footgun into defense in depth.

**Recommended default onboarding (highest completion):** in-app "Connect my phone" → QR → phone opens the cockpit PWA → PAKE handshake → done. A reachability ladder the user never picks: same-LAN (mDNS) → the user's existing mesh if present → a brokered relay (ciphertext-only). "Install Tailscale + SSO on two devices" stays the *advanced / bring-your-own-mesh* tier, not the front door. Anthropic's killer move was zero network config (outbound HTTPS, no ports); to compete you need a zero-config default that is *still* zero-trust — which is precisely what app-layer E2E buys.

---

## 4. The hosted-infra decision + recommendation

**Recommendation: land on (b) — ship a self-host relay recipe; architect the protocol so a managed relay is droppable-in later; do not run a managed relay at launch.**

| Option | Cost to project | Liability | Verdict |
|---|---|---|---|
| **(a) Pure BYO** (user brings Tailscale/VPS) | $0 | Nil | Right *technical* posture, but a credibility/conversion wall — friction is the first impression at scale. |
| **(b) Self-host relay recipe** (Syncthing model — ship code + docs; user/community runs it) | ~$0 | Disclaimed to the operator | **Recommended.** Most consistent with "no hosted infra we run"; sands the sharp edges off BYO; structural rug-pull insurance. |
| **(c) Managed relay tier you run** (Tailscale/ngrok model) | Bandwidth bill that grows with adoption | You sit in the path of strangers' RCE channels at volume | Keep on the roadmap, gate hard. **Not at launch.** |

Why not (c) now — **[verified, with two corrections]**: The operational core is well-supported and if anything *understates* GlaudeCode's risk. Volunteer/managed relays are sunk by **operational burden, not legal exposure**: Tor exit nodes die on abuse-complaint thresholds (Hetzner, Future Hosting); ngrok saw a documented ~700% malware-report surge and had to require payment verification because criminals used it as disposable C2 (it is in MITRE ATT&CK, S0508); TryCloudflare tunnels deliver RATs; shared IP reputation drags relay IPs onto blocklists. **A phone-to-terminal relay is a higher-value C2 target than these generic tunnels — its payload is literally interactive remote-shell access.** Tailscale's free relay survives on three conditions its own blog confirms: ciphertext-only (DERP is E2E, "we can't read it"), P2P-first (relay is the exception), and enterprise-funded ($160M Series C; free tier subsidized by corporate conversion). 

Two corrections to the draft framing: (1) **The legal claim must be narrowed.** "512(a) mere conduit maps on" is a reasonable *textual* reading but is **not backed by on-point case law for non-ISP app-layer relays**; post-*Cox* (SCOTUS, Apr 2026: mere knowledge of infringing use is insufficient; needs inducement) the stronger copyright shield works *outside* any safe harbor, so 512(a) is not the main mechanism. And "not legal exposure" must be narrowed to "**not copyright legal exposure**" — CSAM-reporting duties (18 U.S.C. 2258A, STOP CSAM proposals), CFAA/wiretap, and export rules can attach to a remote-shell relay even on ciphertext (far less likely than operational attrition, but non-zero). A 512(a) repeat-infringer-termination policy remains a formal eligibility condition if you ever claim the harbor. (2) **"None of which GlaudeCode has" is overstated.** GlaudeCode *can* be ciphertext-only (R5) and *can* be P2P-first (hole-punching with relay-as-fallback); it genuinely lacks only the **enterprise funding** — which is the decisive missing leg, and which makes the "don't run a volunteer relay" conclusion *safer*, because P2P-first shrinks relay traffic while the funding gap means no money to absorb residual abuse-ops. **If a managed tier ever ships, gate it behind three non-negotiables:** ciphertext-only by construction (E2E shipped first), fair-queue/rate-limit/overload protection from day one, and a funding model that exists before launch.

---

## 5. Positioning / white space / message

**The category is now occupied, and Anthropic is in it. [verified, with two corrections]**

- Anthropic shipped **Remote Control** (Feb 25, 2026) — the exact "code runs local, phone is a window" model. **Correction:** it is **not "all plans"** — it launched as a **research preview, Max-tier first, Pro rolling out**; not Team/Enterprise, not free. It mirrors the Claude Code conversation/approvals (view history, type prompts, review diffs, approve/reject tool calls), **not a live PTY** — you cannot run arbitrary shell (vim/htop) from the phone. Routing is outbound-only through the Anthropic API.
- **Happy** (slopus/happy) is the OSS leader: **~21.9k stars** ("~22k"), MIT, E2E ("code never leaves your devices unencrypted"), self-hostable. It also mirrors the **agent session/conversation**, not an arbitrary-shell PTY. (Note: Happy's marketing says "streams terminal state" — don't quote that as a concession to "conversation-only"; the *substance*, SDK/agent-session sync with no arbitrary mobile shell, is what supports the point.)

**White-space correction (important):** "full real-terminal mirror is the genuine product gap" holds **only versus the two leaders**, not as an empty market. A fringe already ships real PTY-to-mobile: MobileCLI (open-source, PTY-over-WebSocket), Opus (SwiftTerm byte-for-byte), Tactic Remote ("Full Terminal," proprietary/early), Webmux, 9remote, and DIY ttyd+tmux+Tailscale. So this is a **quality / integration-depth / trust / OSS-scale play, not virgin territory.**

**Two-part defensible differentiation:**
1. **Depth at the layer** — GlaudeCode already owns the PTY in Rust and renders xterm.js, so it can mirror the *real terminal*, which the conversation-only leaders structurally cannot.
2. **Trust posture as the headline** — "we run no servers; even Anthropic doesn't see your session."

Candidate lines: *"Your machine. Your keys. Drive Claude Code from your phone — no cloud we run, not even Anthropic's."* / *"Remote Control without the relay, the plan gate, or the chat-only window."* / for the DIY crowd: *"All the comfort of Tailscale + tmux, none of the setup."* This hits the three reflexes of r/selfhosted + HN (self-hosted, private, real). **Honest framing: matching Happy is losing; out-depthing it (full real-terminal mirror + secure-by-default) is winning.** Reframe the wedge as out-*executing* the existing PTY-mirror fringe on integration depth, E2E trust, UX, and OSS scale.

---

## 6. Multi-OS tiering for v1

The engine + SDK are genuinely host-agnostic, and **[verified]** there is **no OS-specific credential store** in `packages/` (grep for keychain/keytar/libsecret/security-framework/SecItem/stronghold returned zero; Cargo.toml has no keyring crate; Claude Code's own auth is delegated to `@anthropic-ai/claude-agent-sdk`). **Precision correction:** state this as "**no credential at rest / no OS credential store**," *not* "no credential code" — `PairingService` mints in-memory remote tokens and there is a sidecar Bearer handshake; both are transient (no persistence) and OS-agnostic (`crypto.randomUUID`), which is *why* they don't block porting. Also note the surrounding premise that shipped code uses "macOS Keychain auth" is itself inaccurate — that is an unimplemented ADR-0004 design note, not shipped code. The real OS surface is concentrated in `lib.rs` plus a few command-string assumptions (all line refs verified exact).

| OS | Tier | Runs? | Degraded without work | Lift |
|---|---|---|---|---|
| **macOS** | **1 (reference)** | Full feature set today | Nothing | Keep-awake (new) |
| **Linux** | **1** | Engine/PTY/SDK/cockpit all work | Shell integration (OSC 133/7 cwd/timing/exit chips) fires only on **zsh** (`is_zsh`, lib.rs:177–184) — most Linux users run bash and get a visibly worse terminal than the demos | bash + fish OSC integration (ble.sh / native fish); WebKitGTK QA pass; `systemd-inhibit` keep-awake |
| **Windows** | **2 ("experimental / WSL recommended")** | Engine + ConPTY run (`portable-pty` auto-selects ConPTY); native Claude Code works | No shell integration; **the `$SHELL`→`/bin/bash` fallback (lib.rs:176) is not a valid Windows shell** (would need cmd/PowerShell); Tailscale auto-discovery never finds the binary (Mac-only `/Applications/...` path, lib.rs:410); approval-hook `#`-comment sentinel format unverified on Windows; ConPTY flag quirks; PATH fragility | PowerShell OSC + PSReadLine; fix shell fallback; add `.exe`/Program Files Tailscale paths; Windows hook-format + sentinel test; explicit binary resolution; signing/MSI |

**Rationale:** macOS + Linux Tier 1 is achievable with the bash/fish shell-integration work as the only real lift. Windows carries enough POSIX assumptions (notably the broken `/bin/bash` default) that shipping it Tier 1 means shipping a visibly worse product than the demos — label it experimental, recommend WSL (where it behaves like Tier-1 Linux). **Credential storage being a non-blocker does NOT make multi-OS "done"** — the zsh-only integration and the Windows shell default still need per-OS work.

**Two founder decisions — do not proceed silently:** (1) keep-awake is a *new cross-platform feature* (exists on no OS today; arguably required for the "leave it running, check from your phone" pitch); (2) the Windows tier label materially changes the shell-integration + release-engineering budget.

---

## 7. Pre-launch governance / security checklist

**Blocking gates (release cannot pass without these):**

- **`SECURITY.md`** at repo root (Syncthing brevity): private reporting channel (GitHub private vulnerability reporting / GHSA — never the public tracker), PGP key, coordinated-disclosure terms (~72h ack, 90-day fix window), **safe-harbor language** for good-faith researchers, supported-versions table.
- **Published threat model** — promote the internal `epic-g-remote-threat-model.md` to a public, versioned `docs/security/threat-model.md`, expanded to the multi-user/OSS reality (non-expert operators; shared/untrusted networks as the *default* case; Win/Linux where Keychain/ZDOTDIR controls don't apply; the bidirectional keystroke mirror named as RCE explicitly). Adopt Tailscale's **shared-responsibility split** (we secure the engine/pairing/scopes + ship signed updates; you own your mesh/devices/pairings/staying-current). Keep the honest residual-risk section — candor *is* the trust signal.
- **Secure-defaults as an enforced CI release gate:** default bind `127.0.0.1` (tested); a new `RpcMethod` that is unclassified **fails the build** (so no future RPC silently leaks to a view token); `terminal` scope is separate / per-pane / cannot be granted by pairing and is enforced at the WS message handler (R6); `/pair` rate-limit + pairing audit/echo/kill-switch shipped; `remote.enable` wildcard rejection (R2); WS no longer authenticates via query-string and no longer accepts the local bearer (R3).
- **Signed releases + verified updater (P0 — auto-updating shell):** sign every release (Sigstore/cosign + Rekor, or a published PGP key); the Tauri updater verifies the signature against a **pinned key on every update**; signing key in CI secrets only; publish an SBOM; state an SLSA level. A tricked updater = one-shot mass-RCE.
- **User-facing "remote shell is RCE" explainer** shown the first time a user enables remote (code-server bluntness: *"Enabling remote access lets a paired device run commands on this machine… pair only devices you control"*), plus an in-app consent step before the first remote bind.

**Trust-builders (post-launch, not blocking):** OpenSSF Best Practices badge (~20 min); a third-party audit published *with retesting* once there's real adoption (the Teleport/Doyensec bar for an SSH-class tool); a Security Bulletins / advisory page.

**License / governance:** permissive (the repo is already Apache-2.0) maximizes spread and trust for a security tool. The disclaimer (Apache §7/§8) is a shield, not a force field — *not* reliably enforceable against gross negligence/willful misconduct — so the real legal hygiene is **demonstrable diligence** (published threat model + secure defaults + explicit warnings), which moves an incident from "arguably negligent" to "documented, accepted, opt-in risk." Keeping "no hosted infra we run" is itself a liability-*minimizing* posture, not just a cost one.

*(Process note per repo rules: this brief and any A–F deliverables are NEW standalone files; the founder-curated top-level docs — INDEX/state/GOAL/AGENTS — are flagged, not edited. Per Constitution Principle IX, this file must be added to `docs/INDEX.md` in the same commit that lands it — flag that to the founder rather than editing INDEX directly.)*

---

## 8. Honest risks

- **Fingerprintability.** Popularity makes "GlaudeCode" a scan term; any self-exposed install is found fast. Defaults must assume an adversary hunting the signature.
- **Reputation is the dominant near-certain risk.** One "GlaudeCode's default got my shell owned" HN/Reddit thread can end a young project regardless of legal merit (cf. the FastGPT/code-server `--auth none` story). Mitigation is almost entirely upstream design: make the insecure path hard and loud.
- **Happy is a strong free incumbent** (~22k, MIT, E2E, self-host). Win on full real-terminal mirror + secure-by-default, or don't bother.
- **Fork fragmentation** (Happy already has forks). Permissive licensing invites adoption *and* drift — resist with a single canonical relay/protocol implementation + clear CONTRIBUTING + published threat model.
- **The free-relay sunset trap** (if (c) ever ships): easy to launch, brutal to kill; sunsetting it once users depend on it is the same trust rupture as a license rug-pull. The relay is also a *higher-value C2 target than generic tunnels* because its payload is interactive shell.
- **Support burden of BYO at scale** — "bring your own Tailscale" filters out most users; the zero-config E2E default is what prevents that becoming the project's defining friction.
- **Cross-platform parity is a security issue, not just a feature issue** — a hasty Win/Linux re-port of shell-integration/transport is where weak-default bugs are born; each platform's shell wrapper + transport-discovery path needs the *same* review.
- **Evidence gap to flag honestly:** the competitive-sentiment read on Anthropic Remote Control and Happy leans on vendor docs, tech-press secondary sources, and GitHub repo metadata; primary HN/Reddit community threads could not be accessed during verification. The product facts (model, defaults, architecture) are well-corroborated; raw community sentiment is thinner.

---

## 9. Recommendation (founder's call)

**This is a recommendation, not a decision. The call is the founder's.**

Build **app-layer E2E (R5) before opening the repo** — it is the one change that converts "configure Tailscale correctly or get owned" into "pick any transport; worst case is leaked ciphertext," and it is the precondition for *ever* safely running a relay. Add the **`terminal` scope enforced at the WS message handler *and* the `/ws` upgrade (R6)** before the keystroke mirror ships. Close the live footguns now: **token-in-URL + stop accepting the local bearer on `/ws` (R3)**, **`/pair` rate-limit + lockout + wider-entropy code (R4)**, and **wildcard-bind rejection (R2)**. Make the **signed-updater gate (R10/§7)** and the **`/pair` rate-limit + audit/echo/kill-switch** the two non-negotiable P0s. Ship the **self-host relay recipe, not a managed relay.** Position on **depth (real terminal) + trust (no cloud we run, not even Anthropic's)** as a *quality/integration* play against occupied territory, not a land-grab on empty space. Tier as **macOS + Linux Tier 1 / Windows experimental (WSL recommended)**, and ship the **public governance surface** (`SECURITY.md`, threat model, secure-defaults CI gate, signed updater) that turns a one-person posture into one that survives a fleet.

**Two open calls left explicitly to the founder:** (1) the scope of keep-awake (a net-new cross-platform feature), and (2) the Windows tier label (Tier 1 vs. experimental), which materially changes the shell-integration and release-engineering budget.

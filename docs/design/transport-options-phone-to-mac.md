# GlaudeCode Transport Options — Reaching the Mac's Localhost Engine from a Phone

> Status: decision-ready options document for `docs/design/`. Produced by a multi-angle research
> workflow (CGNAT/NAT-traversal, mesh VPNs, vendor tunnels, self-hosted tunnels, raw DIY,
> terminal-specific protocols, mobile/iOS reality, security) with **adversarial verification of every
> load-bearing claim against primary sources.** Where a verification verdict corrected or caveated a
> draft claim, the correction is folded in and **flagged inline** (look for `[Verified]`,
> `[Corrected]`, `[Refuted]`). This is an **options document, not a verdict** — §8 carries a
> clearly-labeled recommendation, but the founder chooses.
>
> Companion to [`mobile-terminal-control.md`](mobile-terminal-control.md) (feasibility of the mirror
> itself) and [`epic-g-remote-threat-model.md`](epic-g-remote-threat-model.md) (the shipped
> Tailscale-only remote path). This doc answers the narrower question: **which network transport(s)
> should GlaudeCode recommend/support** so a phone can reach the Mac's engine through home/cellular
> NAT, privately, with no third party holding plaintext keystrokes, using infrastructure the **user**
> owns.

---

## 1. TL;DR + shortlist

**The decision collapses to two facts (both verified, both decision-changing):**

**Fact 1 — Behind CGNAT, you almost always need an outbound-dialed public rendezvous.** The Mac has no
public IP and cannot accept inbound connections or port-forward, so *every working IPv4 option* is one
where **the Mac dials outbound** to an always-on public box (relay / coordinator / VPS), keeps it warm,
and the phone reaches the Mac through it. The only real choice is *what you put at that rendezvous*. "Pure
P2P with no server" is a fantasy under mobile/home CGNAT — WebRTC included, which falls back to a TURN
relay you must host. **[Corrected — one genuine exception:** native dual-stack **IPv6** on *both* ends
needs no relay and no coordinator at all (CGNAT is an IPv4-only mechanism). It is real but fragile — see
§4d — so "every transport needs a rendezvous" is true for IPv4 and false the moment both legs have working
IPv6.] **[Corrected — magnitude:** the "~15–25% of connections need a relay" figure is a *typical-mix*
estimate; Tailscale reports >90% direct (<10% relay) in typical conditions, but GlaudeCode's actual worst
case — **phone on cellular CGNAT ↔ Mac on home CGNAT** — sits in the bucket where sources agree a relay is
*"almost always"* needed, i.e. far above 25%. Plan for the relay path being the common case, not the
exception.]

**Fact 2 — For an interactive shell (= remote code execution), the load-bearing security question is:
*does any third party ever hold plaintext?*** This splits the field into three tiers:

| Tier | Meaning for keystrokes | Examples |
|---|---|---|
| **A — No third party ever sees plaintext** (end-to-end at the data plane, or you own the relay) | Acceptable | Tailscale/Headscale/NetBird/Nebula/raw WireGuard *point-to-point*, Tailscale Serve & Funnel (packet relay), zrok/OpenZiti, sshx, TermPair |
| **B — A third party terminates TLS/SSH and *can* read plaintext** (by design) | Strong downside; only acceptable if GlaudeCode runs its **own** E2E *inside* (§6) | Cloudflare Tunnel (HTTP mode), ngrok (default HTTPS), Pinggy (HTTP mode), tmate (relay terminates SSH), playit.gg |
| **C — Abandoned / known-vulnerable** | Unacceptable | localtunnel (CVEs), telebit (dead 2021), boringproxy (stale 2023) |

**[Corrected — the most important nuance the verifications surfaced.** "Tier A because it's WireGuard / a
self-hosted tunnel" is *not automatic*. Two things were over-claimed in the draft and must be stated
precisely:
- **A relay being unable to decrypt is a property of the relay *type* and the *key-distribution trust
  model*, not of the word "WireGuard."** Tailscale **DERP**, WebRTC **TURN**, and dedicated WireGuard
  *packet* relays (wpex) forward already-encrypted payloads and cannot read them. But the most common DIY
  "WireGuard relay" is a **hub-and-spoke** box that is itself a WireGuard peer — it **decrypts and
  re-encrypts** spoke-to-spoke traffic (Cryptokey Routing) and **sees plaintext.** A "self-hosted
  WireGuard hub" is Tier A *only* because you own the box, **not** because the hub can't see plaintext —
  it can. True end-to-end through a hub needs a nested tunnel-in-tunnel.
- **rathole's Noise and frp's STCP secret-key do NOT make the tunnel end-to-end** (see §3a/§3b). They
  secure the **Mac↔VPS hop**; the tunnel server on the VPS **decrypts and forwards plaintext** to the
  local service. They are Tier A only in the "you own the VPS, so the plaintext chokepoint is *yourself*"
  sense — a *trust* assumption, not cryptographic E2E. For real keystroke confidentiality against the
  relay you must run an **end-to-end-encrypted payload protocol inside** the tunnel (SSH, or the engine's
  own TLS/§6 layer).]

**The escape hatch that reframes everything (§6):** if GlaudeCode wraps its *own* engine↔phone WebSocket
in its *own* end-to-end crypto (mTLS, or a TermPair-style per-session AES-GCM with the bootstrap key in
the URL fragment, never sent to the relay), then a vendor edge that "terminates TLS" only ever sees inner
ciphertext — and the transport's TLS-termination behavior stops mattering for *confidentiality*. This is
the highest-leverage item in the analysis and it lets us *relax* the transport ranking.

**GlaudeCode-specific implementation notes (verified against our codebase + Epic G):** the engine already
binds `127.0.0.1`, pins CORS to the WebView origin, has a `{port, token}` handshake, and Epic G shipped a
`PairingService` (scoped/expiring/revocable tokens) plus an opt-in tailnet-only remote bind. So "our
integration cost" below is mostly: (a) bind a non-loopback interface cleanly, (b) enforce app-level token
auth regardless of transport (mostly built), (c) ship docs + a CGNAT-detection helper. Two concrete
gotchas, both verified: **Tailscale Funnel strips WebSocket query parameters**
([#18651](https://github.com/tailscale/tailscale/issues/18651), open) — move the WS token to a
header/subprotocol/path/first-message; and any public-URL transport changes the origin, so CORS needs a
remote-access mode.

### The 2–3 shortlisted options

1. **Tailscale tailnet node + `tailscale serve` — the recommended default.** Best-in-class CGNAT
   traversal, mature mobile apps, **TLS terminates on your Mac**, an E2E data plane the DERP relay
   *cannot* decrypt, near-zero setup/integration cost, and it's already what the user runs and what Epic
   G shipped. Tradeoffs are real but fixable config (deny-by-default ACL + Tailnet Lock — both off by
   default) plus a proprietary control plane.

2. **The "I own everything" self-hosted tier** — **NetBird self-host** (ergonomic) *or* **raw WireGuard
   + a $5 VPS, point-to-point routed** (purist, $0 on Oracle Always-Free) *or* **Nebula** (maximalist).
   Same WireGuard-grade data-plane E2E, zero SaaS dependency. This is the honest answer to "show me the
   fully self-hosted/DIY path." **Caveat:** if you route spoke-to-spoke *through* a WireGuard hub, the
   hub decrypts — prefer direct peering, or accept that the (user-owned) hub is the plaintext point.

3. **(Strategic, orthogonal) App-layer E2E mirror (§6).** Not a transport — a decision that makes the
   transport choice *stop being a security gate*. If built, *any* pipe (even a convenient Tier-B
   Cloudflare/ngrok tunnel) becomes safe because it carries only inner ciphertext. Highest leverage; real
   build cost; GlaudeCode is ~80% there.

---

## 2. Comparison matrix

Ratings: **ownership** (vendor / partial / **you**); **NAT/CGNAT** (excellent / good / needs-VPS /
dies-on-CGNAT); **security-for-shell** (Tier A/B/C + the load-bearing condition); **user setup** & **our
integration cost** (trivial / easy / medium / hard); **cost$/mo**; **mobile**; **community verdict**.

| Option | Ownership | NAT/CGNAT | Security for shell | User setup | Our integ. | Cost$ | Mobile | Verdict |
|---|---|---|---|---|---|---|---|---|
| **Tailscale (tailnet node)** | Partial (vendor coord; mitigate w/ Tailnet Lock) | **Excellent** | **Tier A** — DERP can't decrypt; **harden ACL + Tailnet Lock (both off by default)** | Trivial | **Trivial** | Free (6 users/unltd user-owned dev) | **Excellent** | **Default "just works"** |
| Tailscale Serve | Partial | Excellent | **Tier A** (TLS on your Mac) | Trivial | Trivial | incl. | Excellent | Safe in-tailnet expose |
| Tailscale Funnel | Partial (vendor pkt-relay) | Excellent | **Tier A** (relay can't decrypt) **but public URL, CT-enumerable, no built-in auth → our token is the only gate** | Trivial | Trivial (+ #18651 fix) | incl. | Excellent | Only if phone can't be a tailnet node |
| **Headscale** | **You** (control plane) | Excellent (TS clients) | **Tier A** | Medium | Medium (**loses Serve/Funnel**) | Free + VPS | Good (fiddly login) | Own control plane, real ops |
| **NetBird (self-host)** | **You** (whole stack) | Very good | **Tier A** (TURN forwards ciphertext) | Cloud trivial / self-host medium | Medium | Cloud free* / VPS | Good | "Self-hosted but not painful" |
| Nebula | **You** (CA+lighthouse) | Good (needs lighthouse) | **Tier A** | **Hard** | High | Free + box | Good (Mobile Nebula) | Security-maximalist pick |
| ZeroTier | Partial (roots/moons) | Good (weaker hard-NAT) | **Tier A** | Easy | Easy–Medium | Hobby free | **Weak** (iOS suspend) | Second-tier fallback |
| Firezone | You/vendor (heavy) | Very good | **Tier A** | Hard | High (wrong shape) | Self-host free | Good | Right tech, wrong shape |
| Innernet | **You** | Best-effort (CGNAT often needs port-fwd) | Tier A | Medium–Hard | High (**no mobile**) | Free | **None** | Not for phones |
| Twingate | **Vendor** | Good | Tier A | Easy | Medium (vendor-lock) | Free (5 users) | Good | Off-thesis (vendor) |
| **Cloudflare Tunnel** | **Vendor** | **Best** (pure outbound) | **Tier B** (edge sees plaintext in HTTP mode); L4 path is safe **only** if the *payload* is E2E (SSH/your-TLS) — **not** from any tunnel-mode E2E, and **not** via Access-for-Infra SSH (a deliberate MITM) | Easy | Easy | Free / paid TCP | Good (HTTP) / poor (terminal) | Great for web cockpit, **not the shell** |
| ngrok | Vendor | Excellent | Tier B default / **Tier A** passthrough+mTLS | Easy | Medium (doc burden) | ~$8–49 for real use | Good (no UDP) | Convenient, paid, vendor |
| Pinggy | Vendor | Excellent (over 443) | Tier B (HTTP) / **Tier A** (TLS-tunnel mode) | Trivial (stock ssh) | Easy | Free 60-min / paid | Good | Zero-install, viable in TLS mode |
| localtunnel | Vendor | Good | **Tier C (CVEs)** | Easy | — | Free | Good | **Never** |
| playit.gg | Vendor | Good | Tier B | Easy | — | Free | Good (TCP+UDP) | Free ≠ secure |
| **frp (STCP)** | **You** (own VPS) | Good (outbound) | **Tier A only as "you own the box"** — STCP secretKey = **auth only, not encryption**; frps decrypts at the VPS. Needs SSH/app-TLS inside for true E2E | Medium | Medium | VPS ~$5 | Medium | Most capable DIY |
| **rathole (Noise)** | **You** | Good | **Tier A only as "you own the box"** — Noise secures Mac↔VPS; **VPS decrypts & forwards plaintext.** Needs app-layer E2E inside for true keystroke E2E | Medium | Medium | VPS ~$5 | Medium | Leanest high-quality DIY pipe |
| sish | **You** | Good | **Tier A (self-owned)** — TLS terminates on your VPS | Medium | Medium | VPS ~$5 | Medium | Self-hosted ngrok |
| bore | **You** | Good | Tier A **only if you wrap TLS/SSH** (raw stream is plain TCP) | Easy | Medium | VPS ~$5 | Medium | Dumb pipe; wrap it |
| zrok / OpenZiti | **You** (or SaaS) | Good | **Tier A** (genuine E2E, even from zrok servers) | Hard | High | VPS ≥1GB | Public ok / **private hard on phone** | Powerful, heavy |
| boringproxy / telebit | You | — | **Tier C (stale/dead)** | — | — | VPS | — | **Avoid** |
| **Raw WireGuard + VPS (point-to-point routed)** | **You** fully | **Excellent** (Mac dials out) | **Tier A** if peers tunnel directly; **if routed through a WG hub the hub decrypts** (you own it, so plaintext = yourself) | Medium | Medium–High (guide/gen) | VPS $0–5 (Oracle free) | Good (best roaming/battery) | **Realistic DIY winner** |
| SSH reverse / autossh | **You** | Excellent (outbound) | Tier A (SSH is genuinely E2E Mac↔VPS); **but tunnel authenticates Mac→VPS, not phone — engine auth must be solid** | Medium | Medium | VPS $0–5 | Good (no app) | OK, fragile edges |
| OpenVPN + VPS | **You** | Excellent | Tier A (to your own box) | High (PKI) | High | VPS $0–5 | Medium | Dominated by WireGuard |
| Native IPv6 direct | **You** | **N/A — bypasses CGNAT entirely** (needs working v6 *both* ends) | Tier A in transit, **but exposes the RCE port directly to the internet** (no NAT) | Medium–High | Medium | $0 | Good (when v6) | Opportunistic fast-path only |
| Port-forward + DDNS | **You** | **Dies on CGNAT** | Engine fully exposed (worst surface) | Low | Low | $0 | Good | **Trap** |
| WebRTC P2P (+TURN) | **You** (run TURN) | Excellent **only with self-hosted TURN** | **Tier A (DTLS)** but signaling-MITM footgun if SDP travels over plain `ws://` | Hard | **High** | TURN bandwidth | **Excellent (app-free)** | App-free dream, most work |
| **App-layer E2E mirror (§6)** | n/a (orthogonal) | n/a | **Tier A over ANY transport** | n/a | **High (our build)** | $0 | depends on transport | The "BYO transport" enabler |

\*NetBird cloud free-tier peer count not crisply documented for 2026 — **verify before quoting a number.**

---

## 3. Option-by-option, grouped by class

### Class A — Mesh / overlay VPNs (WireGuard-class)

All put the data plane on WireGuard (or Nebula's Noise / ZeroTier's crypto): **end-to-end encrypted
node-to-node.** They differ on *who owns the control plane*, *NAT-traversal quality*, and — critically —
*whether traffic ever passes through a box that decrypts it*.

#### 3a. Tailscale (managed coordinator + WireGuard data plane)
- **How:** `login.tailscale.com` is a "drop box for public keys" — your private key never leaves the
  device. Peers form direct WireGuard tunnels via STUN/ICE; when hole-punching fails, **DERP relays**
  forward already-encrypted packets. **[Verified]** DERP terminates the *outer* TLS but the *inner*
  WireGuard payload stays encrypted, so **DERP cannot read keystrokes**. The phone joins the tailnet and
  reaches the Mac at its MagicDNS name / `100.x` IP — nothing exposed publicly.
- **Pros:** Best-in-class NAT/CGNAT traversal (>90% direct in typical conditions; near-100% overall with
  DERP fallback). Mature, audited iOS/Android apps. `tailscale serve` exposes the engine over HTTPS
  **with TLS terminating on your Mac**. WireGuard battery/latency is the best of any VPN. It's what the
  user runs and what Epic G shipped.
- **Cons — two disqualifying-as-*defaults* config gotchas that MUST be hardened [Verified, holds]:**
  1. **Default tailnet policy is allow-all.** A new tailnet ships with `{"action":"accept",
     "src":["*"],"dst":["*:*"]}` — every device ever added can reach the engine port.
     **[Precision, per verification]** Tailscale's ACL *evaluation model* is technically deny-by-default
     (there are no `deny` rules; access requires an `accept`), but the **shipped default policy** supplies
     a wildcard accept, so the **out-of-box posture is allow-all**. Ship a deny-by-default grant scoping
     the engine port to the phone's identity only. (Tailscale now recommends "grants" over legacy "acls";
     either can scope it.)
  2. **Control-plane key-injection risk.** A compromised/malicious coordination server could insert a
     rogue node and read traffic *as a legitimate peer* — **without DERP ever decrypting anything.**
     **[Verified, holds]** Mitigated by **Tailnet Lock** (new node keys must be co-signed by your own
     trusted nodes), which is **off by default** and carries real operational cost (manage signing keys +
     disablement secrets; risk of locking yourself out). It defends against an *injected node*, not a
     *legitimately-enrolled-but-compromised* device, and complements — does not replace — the ACL.
  - The coordinator also sees **metadata** (which nodes talk, public IPs, timing) even when payload is
    opaque — relevant for a shell, since keystroke *timing* can leak. iOS always-on VPN battery drain is a
    recurring complaint (mitigate with on-demand activation).
- **Complexity:** User = **trivial**; our integration = **trivial** (Epic G already does the tailnet bind
  + `PairingService`). Hardened onboarding (ACL + Tailnet Lock prompt) adds a little.
- **Security for shell:** Excellent. Disqualifiers are fixable config, not architecture.
- **Cost [Corrected]:** Free for personal — **6 users / unlimited user-owned devices** as of the **Pricing
  v4 change on April 8, 2026** (the draft said April 12 — **wrong date**), up from 3 users / 100 devices.
  Caveat: *tagged* resources are capped at **50** (reportedly cut from 100) — irrelevant for a Mac+phone
  (both user-owned), but "unlimited" is imprecise. *Re-verify at publish.*
- **Sentiment:** The pragmatic default; broad practitioner consensus for exactly this use case.

#### 3b. Tailscale Serve & Funnel (a feature of 3a, not a separate network)
- **Serve** = expose a local port over HTTPS *within your tailnet*, cert auto-provisioned, **TLS
  terminates on your node** — the safe path when the phone is on the tailnet. (Also fixes the PWA
  "secure-context" problem: a `*.ts.net` HTTPS name lets `wss://` + service workers work, which a raw
  `100.x` over `http` does not.)
- **Funnel** = same, but reachable from the **public internet** via a Tailscale relay that **proxies an
  encrypted TCP stream it cannot decrypt.** **[Verified, holds-with-caveats]** Confirmed: Funnel does
  *no* TLS termination at the relay (TLS terminates on your node), it's SNI-routed, and the cert is
  publicly auditable in CT logs. **So it's Tier A even though it's a public URL.**
- **Use Funnel only when the phone can't be a tailnet node.** Caveats, all verified:
  - **No built-in auth or rate-limiting** (open FRs [#13809], [#14244]) — **our app-level token is the
    *only* gate.**
  - **The public URL is genuinely discoverable:** the same CT logs that make it auditable also let
    attackers **enumerate every `ts.net` Funnel hostname** (researchers have done exactly this). So the
    no-auth gap is the **dominant practical risk** for an RCE endpoint — the token auth has to be solid.
  - **WS query-param stripping** ([#18651], open) — put the WS token in a header / path / subprotocol /
    first message, **never** the query string.
  - Beta; HTTPS-only on 443/8443/10000.

#### 3c. Headscale (self-hosted Tailscale control server)
- **How:** OSS reimplementation of Tailscale's coordinator; official clients point at it via
  `--login-server`.
- **Pros:** You **own the entire control plane** — removes the key-injection trust problem outright (the
  thing Tailnet Lock exists to mitigate); same excellent clients + WireGuard data plane; MagicDNS / ACLs /
  subnet routers / exit nodes work.
- **Cons:** **Serve/Funnel do NOT work** (they depend on Tailscale's hosted infra) — you lose the easiest
  HTTPS-expose path, the most attractive part for our phone use case. By default it still uses
  **Tailscale's public DERP relays** unless you self-host DERP too — so "fully self-hosted" is more work
  than it looks (those DERP relays still can't decrypt, so it's a sovereignty/availability concern, not a
  confidentiality one). iOS/Android need the fiddly custom-login-server flow. You run/patch/secure the
  control server (usually on a VPS, partly reintroducing a hosted box); if it's down, new connections /
  re-keys block.
- **Verdict:** "own it end-to-end" at real ops cost.

#### 3d. NetBird (WireGuard mesh; cloud OR full self-host)
- **How:** P2P WireGuard with self-hostable **management + signal + relay (TURN)** — entire stack BSD-3.
  Cloud option for zero-ops.
- **Pros:** The strongest "**self-host everything**" WireGuard option (control plane, signaling, TURN all
  yours). Self-host reduced to ~4–5 containers / ~1 GB RAM in v0.62, built-in user mgmt (no external IdP).
  Web UI + ACLs. The TURN relay forwards **ciphertext** (Tier A).
- **Cons:** Self-host means **you run a public-reachable VM** (domain + TLS + TURN) and back it up. Mobile
  apps less battle-tested than Tailscale's. **Cloud free-tier exact peer count for 2026 was not crisply
  documented — verify before quoting a number.**
- **Verdict:** Best pick if "user owns the whole stack, WireGuard-grade, without maximal pain."

#### 3e. Nebula (Slack OSS; Defined Networking)
- **How:** Self-hosted overlay — **you run a CA**, sign per-host certs, and run a **lighthouse** on a
  public IP (e.g. a $5 droplet) for discovery + UDP punching; relays when direct fails. E2E (Noise).
- **Pros:** Genuinely **no vendor in the data or trust path** if you self-host lighthouse + CA — the
  security-maximalist answer. Mature **Mobile Nebula** iOS/Android apps (free, OSS). High performance.
- **Cons:** **Most manual** of the class: provision CA, distribute certs/config to every device, run the
  public lighthouse yourself. No HTTPS-expose like Serve. **Defined.net** managed tier eases enrollment
  (**Free up to 100 hosts**, Pro $1/host/mo) **but explicitly does NOT host lighthouses/relays — you still
  run that infra.**
- **Verdict:** Best "no-vendor-in-the-path" answer, at the most setup friction.

#### 3f. ZeroTier (managed roots + optional self-host "moons"; L2 overlay)
- **How:** Virtual Ethernet (L2) overlay; crypto device identity, UDP hole-punching, 4 global root servers
  for discovery + relay fallback; self-host extra roots ("moons"). E2E encrypted.
- **Pros:** L2 if ever needed; self-hostable controller + moons; free hobby tier.
- **Cons:** **NAT traversal rated below Tailscale on hard/symmetric NAT** (community consensus). **Mobile
  is the weak spot in 2026** — recurring UI breakage, connection-stability complaints, and **iOS
  suspending the VPN on screen-off** (an always-on reliability problem for a phone cockpit). Roots
  vendor-run unless you deploy moons.
- **Verdict:** Workable second-tier fallback; mobile instability + weaker hard-NAT traversal make it a
  poorer fit here than Tailscale/NetBird.

#### 3g. Firezone (YC; WireGuard zero-trust gateway)
- Strong zero-trust tech (per-resource policy, ephemeral keys; relays can't decrypt), but it's an
  **access-gateway model, not a symmetric mesh** ("users → protected resources via a Gateway") — heavier
  than one-phone→one-Mac needs; full self-host is a sizable Elixir/Postgres stack; managed tier
  reintroduces vendor trust. **Verdict:** excellent tech, **wrong shape/weight.**

#### 3h. Innernet (tonari; WireGuard + SQLite coordinator)
- Self-hosted coordination server hands out peer lists + STUN-like punching, but **NAT traversal is
  best-effort** — CGNAT often still needs a manual stable listen-port / port-forward a CGNAT'd home user
  *cannot* do — and there's **no first-party mobile app.** **Verdict:** not suitable (no mobile; weak
  CGNAT auto-traversal).

#### 3i. Twingate (managed zero-trust; Connector self-host)
- Slick zero-trust UX, Connector runs on your side, free plan (5 users) — but **the Controller + Relay
  infra are vendor-run and not self-hostable**, and it's shaped for "users → corporate apps," not a
  personal device mesh. Practitioners do use Twingate+Termius+tmux successfully; it's a fine zero-trust
  flavor, just vendor-dependent. **Verdict:** off-thesis for "user owns it."

### Class B — Vendor (SaaS) tunnels

Dial out from the Mac to a vendor edge — **best NAT/CGNAT story (pure outbound, no hole-punching)** — but
most **terminate TLS/SSH at the vendor edge by default and can read plaintext (Tier B).** Several have a
non-default passthrough/mTLS mode that moves them to Tier A.

#### 3j. Cloudflare Tunnel / Zero Trust / WARP
- **How:** `cloudflared` dials out; public hostname over HTTPS; lock down with Cloudflare Access (free
  Zero Trust: 1000 tunnels / 500 apps; SSO/service tokens/mTLS).
- **The decisive con [Verified, holds]:** **Cloudflare terminates TLS at its edge and decrypts your
  traffic by design** (WAF/Access/caching) before re-encrypting to origin — including, architecturally,
  keystrokes and command output. For an interactive RCE terminal that is the textbook
  third-party-plaintext problem.
- **[Corrected — the draft's "TCP/SSH mode stays E2E" wording is *wrong*, even though the practical
  conclusion is right]:**
  - The `cloudflared` **TCP/L4 tunnel is NOT itself end-to-end encrypted.** Cloudflare's own
    `cloudflared` issue #1257: *"arbitrary TCP tunnel is not encrypted end to end … Cloudflare can look in
    your arbitrary TCP stream if they wanted to."* What protects an SSH session over L4 is **SSH's own
    application-layer encryption running end-to-end inside the tunnel** — Cloudflare sees ciphertext
    *because SSH encrypted it*, **not** because "TCP mode" is E2E. A plaintext protocol (telnet) over the
    same L4 mode would be fully readable. **The safety is a property of the payload, not the tunnel mode.**
  - **[Refuted — "use Cloudflare's SSH product and you're safe"]:** Cloudflare's *recommended* SSH path,
    **Access for Infrastructure**, **deliberately MITMs the SSH connection** (two SSH connections meeting
    at a proxy) so it can **inspect and log SSH commands** — i.e. Cloudflare **reads SSH plaintext in
    transit there.** Command-log encryption-at-rest does not change that. **Do not use that mode** if
    confidentiality from Cloudflare is required; use the raw `cloudflared access tcp` / `ssh
    ProxyCommand` passthrough with your own E2E payload.
- **Mobile friction (a real killer for the terminal):** phone-friendly modes are weak —
  browser-rendered SSH (poor interactive UX), `cloudflared access tcp` (needs `cloudflared` on the phone,
  which mobile SSH apps don't run), or WARP-to-Tunnel (needs the WARP VPN app). **No UDP → no Mosh.** Past
  ToS friction for heavy non-HTML / general TCP piping (worth a glance if ever defaulting to it).
- **Verdict:** Most reliable connectivity; **do NOT lead with it for the terminal.** Genuinely good for
  the **web cockpit over HTTPS** (where the cockpit's content isn't a confidential shell), or *only* with
  GlaudeCode's own E2E inside (§6).

#### 3k. ngrok
- Agent dials out; public URL; NAT/CGNAT-proof; built-in auth (OAuth/OIDC/basic); TCP endpoints. **TLS
  nuance:** **configurable** — default HTTPS terminates at ngrok's cloud (Tier B); **agent/upstream TLS
  termination or TLS-passthrough/mTLS** = "ngrok cannot see payloads" (Tier A). Defaults are unsafe for a
  shell; the safe config exists but is a **documentation burden we'd own** (and a misconfig silently
  re-enables the unsafe path). Stable URL / reserved domain / real TCP require **paid** (~$8/mo Personal,
  Pro ~$20–49). No UDP → no Mosh. **Verdict:** Tier A *only* in passthrough/mTLS mode; convenient but
  vendor-locked and paid for real use.

#### 3l. Pinggy
- Zero-install — uses the **system's built-in SSH** (`ssh -p 443 -R0:localhost:PORT a.pinggy.io`); beats
  NAT/CGNAT over 443. **TLS nuance:** HTTP/HTTPS tunnels = Pinggy terminates TLS (Tier B); **TLS tunnels
  ("Zero Trust mode")** = "Pinggy does not terminate SSL/TLS … cannot read your data" (Tier A). Free
  tunnels expire after 60 min (persistence/custom domains need paid); smaller vendor. **Verdict:** Tier A
  in TLS-tunnel mode — genuinely viable; zero-install is attractive.

#### 3m. localtunnel — **DO NOT USE**
- Effectively unmaintained, HTTP-only with no real auth, **known CRITICAL CVEs** (unpatched axios: info
  disclosure, SSRF, DoS), TLS terminated by the public server. **Tier C — unacceptable for anything, let
  alone a shell.**

#### 3n. playit.gg
- Free TCP+UDP tunnels (game-server oriented). **Another third party terminating your traffic**;
  trust/permanence concerns. Shows up in "free Claude Code mobile" gists because it's *free*, not
  *secure*. **Tier B; not for the keystroke channel.**

#### 3o. VS Code / dev tunnels (Microsoft) — *competitive data point, not a recommendation*
- `code tunnel`; Microsoft relay bridges WebSockets through firewalls; both ends auth with the same
  GitHub/MS account; an **SSH connection runs *over* the tunnel for E2E** (relay carries ciphertext —
  same correct pattern as §6). Microsoft-hosted (not BYO); researchers flag dev tunnels as an "accidental
  C2" (they bypass egress controls). **Relevant as the pattern Microsoft chose** (own relay + E2E
  SSH-in-tunnel) — independent validation of §6.

### Class C — Self-hosted tunnels (you run a relay on your own public VPS)

"Bring your own transport" in the purest sense — **no SaaS company involved** — but **every one needs a
public VPS** (~$4–6/mo, or $0 on Oracle Cloud Always-Free) as the rendezvous, since the Mac is behind
CGNAT. **[Corrected — the load-bearing nuance]:** "you control TLS" does **not** mean the tunnel is
end-to-end. In the standard reverse-proxy topology the **tunnel server on the VPS decrypts** and forwards
plaintext to the local service. These are Tier A in the **"the only box that sees plaintext is *yours*"**
sense — a trust assumption. For cryptographic keystroke E2E against the relay, run an **E2E payload
protocol inside** (SSH, or the engine's own TLS/§6 layer). The catch is also a **permanently
internet-facing public port** to harden (mTLS-required, fail2ban, non-standard port, patching).

#### 3p. frp (fast reverse proxy) — *the most capable DIY*
- `frps` on your VPS, `frpc` on the Mac dials out. TCP/UDP/HTTP/HTTPS/STCP. Actively maintained. TLS on by
  default since v0.50; token + OIDC auth. **STCP mode** = a private, authenticated tunnel with **no public
  port at all** + a shared `secretKey` — ideal topology for a shell.
  **[Corrected]:** the STCP **`secretKey` is for authentication / access-control ONLY — it does NOT
  encrypt traffic.** frp's transport encryption/TLS is **per-hop** (`frpc`↔`frps`) and **terminates at
  `frps` on the VPS.** So STCP secret-key mode alone is **not** end-to-end confidentiality of keystrokes
  against the VPS — wrap SSH or app-TLS inside. Con: config sprawl; you operate/patch the VPS.

#### 3q. rathole (Noise) — *leanest high-quality pipe*
- Rust equivalent of frp's core, TCP/UDP. Actively maintained. **Mandatory per-service tokens + optional
  Noise Protocol encryption** (default `Noise_NK_…`).
  **[Corrected — the draft called Noise "exactly the right confidentiality primitive for keystrokes; Tier
  A." That overstates it]:** Noise encrypts the **Mac↔VPS hop only**; the rathole **server on the VPS
  decrypts the Noise tunnel and forwards plaintext** to the connecting client/service. The default NK
  pattern authenticates the **server**, not the client. It is **not end-to-end** — the existence of a
  community "zero-knowledge rathole" blog (adding a separate E2E layer) exists precisely because the VPS
  sees plaintext by default. **True keystroke E2E still needs SSH/app-TLS inside the tunnel.** Much higher
  throughput / lower memory / more stable than frp; fewer features. Still needs a VPS.

#### 3r. sish — *self-hosted ngrok with zero client install beyond SSH*
- Tunnels over plain SSH (`ssh -R`); HTTP(S)/WS(S)/TCP; auto wildcard subdomains; auth via SSH public
  keys. Actively maintained. TLS typically terminated at sish/your reverse proxy **on the VPS** (plaintext
  on *your* box only). Con: you run/patch the VPS. **Tier A (self-owned).** Strong if you live in SSH.

#### 3s. bore — *dead-simple dumb pipe*
- ~400-line Rust TCP tunnel. Optional `--secret` (HMAC handshake) — **but the data stream is plain TCP, no
  built-in encryption.** Actively maintained. **Tier A only if you wrap it in your own TLS/SSH;** raw bore
  is unsafe for keystrokes. Avoid the public `bore.pub` (third party).

#### 3t. zrok / OpenZiti — *best-in-class self-hostable security, heaviest to run*
- Built on the OpenZiti zero-trust overlay; **E2E-encrypted even from the zrok servers**; public or
  private shares; self-hostable. Actively maintained. **Strongest security model in this class.** Cons:
  **heaviest to operate** (OpenZiti controller + router, ≥1 GB VPS, wildcard DNS); a private share needs
  `zrok access` running on the **client — awkward on a phone**; public shares work from a browser but then
  it's a public URL needing app auth. **Tier A; overkill unless you want zero-trust identity baked in.**

#### 3u. boringproxy / telebit — **avoid**
- boringproxy stale (2023-05); telebit dead (2021-11). Designs are fine/E2E-capable but **unmaintained**
  — don't build an RCE channel on them. **Tier C.**

### Class D — Raw DIY (hand-rolled, no tunnel product)

#### 3v. Raw WireGuard + a public VPS — *the realistic DIY winner*
- **How:** A cheap VPS with a public IP is the **hub**; the **Mac dials out** and holds the tunnel with
  `PersistentKeepalive = 25`; the **phone** (official WireGuard app) also dials the VPS; the VPS routes
  between them. Because the Mac initiates outbound, **this works through CGNAT and strict firewalls.**
- **Pros:** CGNAT-proof; best mobile roaming/battery of any VPN (survives Wi-Fi↔cellular handoff
  statelessly; ~8–12%/8h Android battery vs OpenVPN's 18–22%); ~$0–5/mo; low ongoing maintenance. The
  hand-rolled twin of Tailscale.
- **[Corrected — the "E2E (VPS sees only ciphertext)" claim is topology-dependent]:** if the VPS is a
  WireGuard **hub** that routes spoke-to-spoke (the simplest setup), the **hub decrypts and re-encrypts**
  (Cryptokey Routing) — it *does* see plaintext. Because **you own the VPS**, that plaintext chokepoint is
  *yourself*, so it still satisfies "no *third party* sees plaintext." For true ciphertext-only at the
  hub, peer the phone and Mac **directly** (the VPS only relays packets / does NAT, never terminates a
  tunnel to each), or nest a tunnel-in-tunnel. State this honestly in docs.
- **Cons / real gotchas people get wrong:** forgetting `PersistentKeepalive=25` on the NAT'd side (tunnel
  "works then mysteriously dies"); `net.ipv4.ip_forward=1` not persisted; wrong MASQUERADE egress
  interface; `AllowedIPs` is a routing table, not an ACL; you manage a VPS (SSH hardening, updates,
  iptables) and key distribution.
- **Verdict:** The honest DIY sweet spot. Pairs naturally with opportunistic IPv6 (§3y).

#### 3w. SSH reverse tunnel / autossh — *clever, lightweight, operationally fiddly*
- **How:** Mac runs `ssh -R` to a public VPS exposing the engine port; phone hits VPS:port;
  `autossh`/systemd keeps it alive. Mac dials out → CGNAT bypassed; no VPN app on the phone. **SSH is
  genuinely end-to-end Mac↔VPS** (the encryption is the payload protocol's, exactly the right model).
- **Gotchas (well-documented):** `GatewayPorts yes` needed or the forward binds loopback-only on the VPS
  (and then you've exposed a public port needing its own auth/TLS); `-M 0` + `ServerAliveInterval`/
  `CountMax`; `ExitOnForwardFailure=yes` (stale port after an ungraceful drop silently fails to rebind);
  don't use `-f` under systemd; Mac sleep drops the tunnel (`caffeinate`).
- **Security:** strong, but the tunnel authenticates **Mac→VPS, not phone→VPS** — the engine's own auth
  must be solid. **Verdict:** fine lighter-weight alternative; **higher fragility** than WireGuard at the
  edges.

#### 3x. OpenVPN (self-hosted) — *works, strictly dominated*
- Same VPS-relay job, but ~half WireGuard's throughput, ~4× CPU, worse battery, worse Wi-Fi↔cellular
  roaming, and **HIGH complexity (TLS/PKI: CA + server/client certs)**. E2E to your own box. **Only
  reason to pick it:** DPI/censorship evasion (TCP/443) — not a stated requirement. **Verdict:** dominated
  by WireGuard on every axis that matters here.

#### 3y. Native IPv6 direct connect — *the one true CGNAT escape, but opportunistic only*
- **How:** IPv6 gives every device a globally routable address — **no NAT, no relay, no coordinator.**
  **[Verified — this is the genuine exception to Fact 1:** CGNAT is an IPv4-only address-sharing
  mechanism; with native routable IPv6 on **both** the phone (cellular) and the Mac (home ISP), the phone
  reaches the Mac's IPv6 address **directly with no rendezvous at all** — only address discovery (DDNS
  over AAAA) and the Mac opening its **own inbound IPv6 firewall.**]
- **Reality (why it's a fast-lane, not the only transport):** coverage is uneven (Google measured IPv6
  >50% of users, but **both** legs need working v6 *simultaneously* — a v4-only/NAT64 mobile leg kills
  it); **dynamic prefix delegation** rotates your `/56`–`/48` several times a day (one reported a 26-min
  lease), breaking DNS records *and* firewall rules tied to the address (workaround: match only the static
  interface-suffix — fiddly, router-dependent); and **no NAT means you directly expose an RCE-bearing port
  to the open internet** (a globally routable address is globally *attackable*). Still needs DDNS over
  AAAA with propagation lag.
- **Verdict:** A great **opportunistic fast lane** (lower latency, no relay cost) **behind a WireGuard
  fallback** — the dual-stack pattern real self-hosters land on. Not reliable enough to be the only
  transport, and the direct-exposure security cost means the engine's own auth/E2E must be airtight.

#### 3z. WebRTC P2P data channel — *app-free dream, but most engineering and still needs a relay*
- **How:** Browser-native, **E2E (DTLS mandatory)** data channel — phone needs *no app*, just a web page.
  But "P2P" hides three pieces **you must build/host:** a **signaling server** (your code), **STUN**
  (cheap, coturn), and — the expensive mandatory-for-reliability piece — a **TURN relay**, because
  hole-punching fails specifically under **symmetric** CGNAT.
  **[Verified, holds-with-caveats]:** STUN succeeds only when the NAT uses Endpoint-Independent Mapping;
  cellular CGNAT commonly uses **symmetric (endpoint-dependent) mapping** (one study: ~40% symmetric among
  cellular networks), which breaks STUN and forces TURN. (Nuance: hole-punching does **not** *always* fail
  under CGNAT — only the symmetric subtype.) GlaudeCode's worst case (phone cellular CGNAT ↔ Mac home
  CGNAT) is squarely in the **TURN-required** bucket (~20–30% added latency). TURN forwards **DTLS-SRTP
  ciphertext** — it cannot decrypt, so it's Tier A.
- **Security footgun:** if SDP travels over plain `ws://`, an attacker can substitute DTLS fingerprints
  and **MITM the key exchange** — the signaling server is a trusted MITM point unless you pin fingerprints
  out-of-band.
- **Verdict:** The best *app-free, E2E* experience, but the realistic version **still requires a
  self-hosted public TURN relay** — so it doesn't escape the VPS, it just spends far more engineering to
  get a no-install phone client. A strong **later** bet, not a cheap first transport.

### Class E — Terminal-specific (patterns to steal, not dependencies)

**The transport question and the terminal question are separable — keep them separate.** GlaudeCode
already owns its terminal (Rust PTY + xterm.js + engine WS); it needs a *pipe* to its existing engine, not
a third-party terminal protocol. These are mostly **patterns to steal and competitive references.**

- **3aa. Mosh** — SSHes in, hands off to a **UDP State-Synchronization Protocol** (AES-128-OCB3) syncing
  *screen state* with **speculative local echo** — feels instant on laggy LTE; **roaming** survives
  Wi-Fi↔LTE / sleep / NAT rebind. **But Mosh does NOT solve NAT traversal** — it needs an inbound UDP port
  (60000–61000), exactly what CGNAT denies — so you run **Mosh *inside* Tailscale/WireGuard.** The
  community's converged stack is **overlay-VPN + Mosh + tmux + Blink/Termius**; there's even a shipping
  "SSH & Mosh terminal for Claude Code" (Moshi/getmoshi.app). **Steal:** predictive echo + screen-state
  sync for our mirror.
- **3bb. Eternal Terminal (et)** — same resilience shape as Mosh but **TCP** (worse on lossy links), same
  NAT problem (needs inbound TCP port), 3 CVEs in 2023. *Document-only.*
- **3cc. sshx** — closest existing thing to our mirror (Rust PTY host + xterm.js + genuine E2E
  Argon2+AES, server can't read input, predictive echo). **[Corrected — the draft's "self-hosting not
  supported → disqualifies it" overstates]:** the README does say verbatim *"Self-hosted deployments are
  not supported at the moment"* (you'd implement reverse proxy + gRPC forwarding + TLS + mesh + graceful
  shutdown yourself) **— but a `--server` flag / `SSHX_SERVER` env var exists and `sshx-server` is
  published on crates.io; at least one user self-hosted it** (only blocker was TLS/secure-context for
  WebCrypto). So it's a **weak/high-friction BYO dependency, not categorically impossible.** Also note its
  E2E is **AES-CTR without AEAD** (no integrity/authentication) and the server is *partially* trusted —
  confidentiality against a passive relay, not authenticated encryption. **Architectural reference, not a
  dependency.**
- **3dd. TermPair** — best open reference for a self-hostable E2E browser mirror: per-session AES-128-GCM;
  **bootstrap key in the URL hash fragment, never sent to the server**; server is an explicit "blind
  relay"; **self-hosting fully supported**; active. **This is the exact pattern §6 should adopt.**
- **3ee. tmate** — **skip for keystrokes. [Verified, holds]:** tmate is **NOT end-to-end encrypted** — its
  relay runs a real (forked) tmux server that **terminates SSH and reconstructs the session in plaintext**
  (the host replicates pane content/keystrokes as plaintext msgpack *inside* the SSH transport). The
  author confirmed on the repo he *wanted* E2E and decided against it (viewers use an unmodified `ssh`
  client, forcing the server to be trusted); promised "3.0" E2E **never shipped** (latest release 2.4.0,
  Nov 2019). **Self-hosting `tmate-ssh-server` fixes *who* runs the relay, not the plaintext-at-relay
  property** — the operator can read/record/replay the session. Each leg *is* SSH-encrypted in transit and
  host-key-pinned against a network MITM, but the **relay endpoint is a plaintext chokepoint.** Wrong
  model for RCE keystrokes.
- **3ff. ttyd / wetty / gotty** — *irrelevant.* They relay a local PTY over WebSocket on localhost (no NAT
  traversal, no E2E, unauthenticated by default) — literally what our engine already *is*. The interesting
  part was always the tunnel.

**iOS reality affecting all of these [Verified]:** iOS suspends a backgrounded app after ~3 min; silent
push is rate-limited, not a keep-alive. So **the durable session must live on the Mac** (the engine
already holds PTYs server-side) and the phone **reattaches and resyncs screen state** on foreground —
which is exactly GlaudeCode's architecture, and the strongest argument *against* a thin browser tab and
*for* the server-side-durable mirror.

---

## 4. Options to AVOID (and why)

- **Cloudflare Tunnel (HTTP mode) for the terminal** — Cloudflare terminates TLS at its edge and reads
  plaintext keystrokes by design; its *recommended* SSH product (Access for Infrastructure)
  **deliberately MITMs SSH to log commands**; no UDP (no Mosh); weak mobile-terminal modes. *Fine for the
  web cockpit over HTTPS; never the shell* unless wrapped in our own E2E (§6) over a raw L4 passthrough.
- **tmate** — relay terminates SSH and sees plaintext session content (not E2E); self-hosting fixes
  *who*, not *what*.
- **localtunnel** (critical CVEs), **telebit** (dead 2021), **boringproxy** (stale 2023) —
  abandoned/vulnerable; never for an RCE channel.
- **Port-forward + DDNS** — **impossible under CGNAT** (nothing inbound to forward to; no DDNS trick
  fixes it) for a large/growing share of users; and even *with* a real public IP it **exposes the RCE
  endpoint directly to the open internet** (Shodan-indexed, brute-forced) — the scariest posture of all,
  plus DDNS operational rot. **DISQUALIFIED as a default;** at most an expert-only escape hatch with a
  real static IPv4 and loud warnings.
- **Innernet** (no mobile app; weak CGNAT auto-traversal), **Firezone** (right tech, wrong/heavy shape),
  **Twingate** (vendor-locked Controller+Relay), **ZeroTier** (2026 iOS background-suspend + weaker
  hard-NAT traversal) — each off-fit for one-phone→one-Mac.
- **WebRTC as a "no-server" play** — under (symmetric) CGNAT it needs a self-hosted TURN relay anyway, so
  it's the most engineering for the same "you need a public relay" conclusion. Revisit later for the
  app-free phone client.
- **Treating rathole-Noise / frp-STCP / a WireGuard hub as automatically "E2E for keystrokes"** — they are
  *not*. They protect the Mac↔VPS hop and the VPS (which you own) decrypts. Safe enough *because you own
  the box*, but document the plaintext chokepoint honestly and put SSH or §6 E2E inside if the threat
  model includes a compromised VPS.

---

## 5. The cross-cutting strategic option — make the mirror E2E at the app layer (§6 reframed)

This is **not a transport** — it's a decision that **changes how much the transport choice matters**, and
several research angles plus the verifications independently point at it.

If GlaudeCode's engine↔phone WebSocket is itself **end-to-end encrypted + mutually authenticated at the
app layer** (mTLS, or a TermPair-style per-session AES-GCM with the bootstrap key in the URL fragment),
then:
- the transport collapses to "NAT traversal + attack surface" only;
- a vendor edge that terminates TLS (Cloudflare/ngrok-HTTP) only ever sees **inner ciphertext**,
  neutralizing the Tier-B objection;
- a self-hosted tunnel's VPS-decrypts property (rathole/frp/WG-hub) stops mattering — the VPS sees only
  inner ciphertext too;
- the same mirror is safe over *any* pipe — the literal fulfillment of "bring your own transport."

**Do it right (lessons from the verifications):** TermPair's bootstrap-key-in-URL-fragment is the pattern;
**use an AEAD** (AES-GCM / ChaCha20-Poly1305) — *not* sshx's AES-CTR-without-integrity — so you get
authentication, not just confidentiality; pin keys out-of-band to avoid the WebRTC-style signaling MITM.
**Cost:** real engineering (key exchange, session keys, mobile crypto, predictive echo). GlaudeCode is
~80% there (owns the PTY + engine WS + xterm.js + `PairingService` scoped tokens). **Trade-off:** doing
this lets us *relax* the transport recommendation and even bless convenient Tier-B tunnels; *not* doing it
forces strict reliance on genuinely-E2E-at-the-data-plane (Tier A) transports. **Highest-leverage item in
the whole analysis** — and it directly discharges the owed Epic-G remote threat-model debt for the
input-escalation case.

---

## 6. Honest open questions / unknowns

1. **NetBird cloud free-tier peer count for 2026** — not crisply documented; **verify before quoting a
   number** in user-facing docs.
2. **Tailscale Pricing v4 specifics** — confirmed 6 users / unlimited user-owned devices, **effective
   April 8, 2026** (not the draft's April 12), with a **50-tag cap** (reportedly cut from 100). Re-verify
   the exact numbers and tag cap at publish; vendor free tiers move.
3. **Funnel #18651 (WS query-param stripping)** — open at time of research; if Tailscale fixes it the
   header/path workaround becomes optional (but ship the workaround regardless — it's strictly safer).
4. **Real-world relay-fallback rate for *our* topology** — the literature ranges from <10% (Tailscale
   typical) to ~30% (a 2025 libp2p measurement study) to "almost always" (both ends CGNAT). We have no
   GlaudeCode-specific telemetry; the honest planning assumption is **relay is the common case** for
   phone-cellular ↔ Mac-home. Worth measuring once we have users (with consent).
5. **IPv6 availability among our users** — the one true CGNAT escape, but coverage/cellular-carrier
   behavior and prefix-rotation cadence vary widely; we can't assume it. A CGNAT/IPv6 detection helper
   would let onboarding route users correctly.
6. **Metadata leakage tolerance** — even Tier-A transports leak *who-talks-to-whom*, public IPs, and
   keystroke **timing** to the coordinator/relay. For most personal-cockpit users this is acceptable; it
   should be stated, not hidden, in the security docs.
7. **Community-sentiment confidence** — the Reddit MCP/API was rate-limited/forbidden across the research
   sessions, so r/* verbatim quotes could not be pulled; sentiment was triangulated from Hacker News,
   vendor docs, primary repos (issues, READMEs, whitepapers), and 2026 practitioner write-ups. The
   *technical* claims rest on primary sources (stronger evidence); the *sentiment* claims are the softer
   ones.

---

## 7. RECOMMENDATION (the founder decides)

> **This is a recommendation with reasoning, not a decision.** It is framed as three independent knobs so
> the founder can accept some and defer others.

**Knob 1 — Default we recommend in onboarding: Tailscale tailnet node + `tailscale serve`.** *Almost
certainly yes.* It uniquely combines best-in-class CGNAT traversal, mature mobile apps, **TLS termination
on your Mac**, a data plane DERP **cannot decrypt**, near-zero setup/integration cost (Epic G already
shipped the bind + `PairingService`), and it's what the user runs and the practitioner community
converged on. **Conditions we must meet, all verified as real:** ship hardened onboarding — a
**deny-by-default ACL/grant** scoping the engine port to the phone's identity (the shipped default is
allow-all), a prompt to enable **Tailnet Lock** before remote bind (off by default; closes the
coordinator key-injection gap), and honesty about the **metadata** leak and the **proprietary control
plane** (the "you own it" wart, mitigable not eliminable). Use **Serve** within the tailnet; reserve
**Funnel** for "phone can't be a tailnet node," with **app-token auth as the only gate** (the public URL
is CT-enumerable) and the **#18651** token-off-the-query-string fix.

**Knob 2 — Self-hosted "I own everything" tier we document.** *Yes — pick the purism/ergonomics point.*
The honest answer to the user's explicit "show me the fully self-hosted/DIY path":
- **NetBird self-host** — most ergonomic full-stack-yours WireGuard; TURN forwards ciphertext.
- **Raw WireGuard + a $5 VPS** ($0 on Oracle Always-Free) — purist, fully owned. **Document the topology
  honestly:** peer phone↔Mac *directly* (VPS relays packets only) for true ciphertext-at-the-hub, or
  accept that a routing **hub decrypts** (the plaintext point is *you*).
- **Nebula** — for maximalists who want no vendor in the trust path at all.
- **rathole/frp/sish on the user's VPS** — proper DIY pipes, but **document that the VPS decrypts** and
  put SSH or §6 E2E inside if the threat model includes a compromised VPS.

**Knob 3 — Do we invest in the app-layer E2E mirror (§5/§6)?** *Highest-leverage call.* If **yes**,
transport stops being a security gate, convenient Tier-B tunnels (Cloudflare/ngrok-HTTP) become safe
because they carry only inner ciphertext, and "bring your own transport" becomes literally true — and the
owed Epic-G input-escalation threat-model is discharged. If **no**, we must steer users strictly to
genuinely-E2E-at-the-data-plane (Tier-A) transports and forbid the convenient HTTP tunnels for the shell.
GlaudeCode is ~80% there; build it with an **AEAD** and out-of-band key pinning.

**Engineering-side, regardless of the choices above:** bind the engine to a non-loopback interface
cleanly; **enforce app-level token auth on every transport** (Epic G's `PairingService` does most of
this); add a remote-access CORS mode; move the WS token off the query string (#18651); ship a
**CGNAT/IPv6-detection helper** so the docs route users to options that can actually work; and **never**
default to a transport where a *third party* terminates the shell's encryption (Cloudflare-HTTP, ngrok
default, Pinggy-HTTP, tmate) unless §6 is in place.

---

*Verification provenance: every load-bearing claim was checked against primary sources (Tailscale KB +
blog + GitHub issues; Cloudflare `cloudflared` issue #1257 + Access-for-Infrastructure blog/docs; frp +
rathole docs; sshx README + CLI source + issues; tmate whitepaper + author statements + release state;
CGNAT/IPv6/WebRTC measurement studies). Corrections folded in above and flagged `[Corrected]`/`[Refuted]`.
Soft spot: community sentiment (Reddit API unavailable; triangulated from HN + docs + practitioner
write-ups). Re-confirm at publish: Tailscale Pricing v4 numbers (effective April 8 2026; 50-tag cap) and
NetBird cloud free-tier peer count.*

# Tailnet ACL hardening (a MUST on a shared tailnet)

> V5 Phase 5 / Story 5.4.2. The engine's remote listener / Tailscale Serve exposes a **remote shell
> (RCE)** to your tailnet. Tailscale's default ACL is **allow-all** — every node on the tailnet can
> reach the engine port, including `/pair` and `/app`. On a **personal** tailnet (only your devices)
> that's your own trusted devices. On a **shared** tailnet (work, family, a club), it is a real
> exposure: any other member's node can hit the pairing endpoint.

## Deny-by-default grant: scope the engine to your phone only

In the Tailscale admin console (Access Controls), restrict the engine to **only your phone's node**.
Tag the Mac and grant just your phone:

```jsonc
// Tag your GlaudeCode Mac (e.g. tag:glaudecode) and grant ONLY your phone to reach it.
{
  "tagOwners": { "tag:glaudecode": ["your-email@example.com"] },
  "grants": [
    {
      "src": ["your-phone-node"],          // or a tag:phone you assign to the phone
      "dst": ["tag:glaudecode"],
      "ip":  ["tcp:443", "tcp:1024-65535"] // 443 for Serve; the ephemeral range for the plain bind
    }
  ]
}
```

The engine binds an **ephemeral** port, so the plain-bind path needs the high range (or pin the port
and narrow this to it). With **Tailscale Serve** the public surface is just `tcp:443` on the node —
prefer Serve and you can drop the wide range entirely.

This is a **MUST** on a shared tailnet and good hygiene on any tailnet: even a stolen pairing code is
useless from a node the ACL doesn't allow to reach the port.

## Opt-ins, with loud caveats

- **Tailscale Funnel — not a default.** Funnel exposes the service to the **whole public internet**
  (the MagicDNS name is enumerable via Certificate Transparency logs), dropping the tailnet
  guarantee. The engine's pairing token becomes the *only* gate. Acceptable **only** if the phone
  truly cannot be a tailnet node, and only with the token kept **off the query string** (Funnel
  strips/queries can leak `?token=` — already enforced, the token rides in the first WS message).
  Treat Funnel as last-resort, not the recommended path.

- **Cloudflare Tunnel — gated behind Phase 3.** A Cloudflare-fronted tunnel terminates TLS at
  Cloudflare, so Cloudflare sees plaintext keystrokes. **Do not enable it until V5 Phase 3 (app-layer
  E2E) ships**, after which the AEAD session is opaque to Cloudflare. Until then it is off.

## Bottom line

Personal tailnet + Tailscale Serve = lock the grant to your phone and you're done. Shared tailnet =
the grant above is mandatory. Public exposure (Funnel/Cloudflare) waits for Phase 3 E2E.

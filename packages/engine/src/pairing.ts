// Pairing & scoped tokens (Epic G §3.2 — the security heart). The per-launch bearer token
// must NEVER be shared to a phone. Instead the desktop issues a short, expiring PAIR CODE; a
// client redeems it for a scoped, expiring, revocable REMOTE TOKEN. Scope is "view" (read-only),
// "steer" (can answer approvals / send follow-ups), or "terminal" (can type into armed terminal
// panes — the RCE-class scope; V5 Phase 2). All time + randomness is injected so the logic is
// fully deterministic under test.
//
// V8/C1: tokens are HMAC-SIGNED capabilities (tokenSigning.ts) — `sign(deviceId.scope, key)` — and the
// authoritative scope/expiry/revocation live in a PERSISTED device roster (deviceStore.ts). The only
// secret at rest is the signing key; the bearer token still never touches the Mac's disk. With both
// the key and the roster persisted, a paired phone now SURVIVES an engine respawn instead of being
// logged out. Revocation = removing the device from the roster (its signed token then fails the
// presence check). Without an injected key/store it falls back to a per-process ephemeral key + an
// in-memory roster (the pre-C1 behaviour: dies on restart) — so existing callers/tests are unchanged.
//
// Scope is a linear privilege ladder: view < steer < terminal. A higher scope satisfies every
// lower requirement, but NEVER the reverse — crucially, a "steer" token can answer approvals yet
// can NEVER type into a terminal (terminal is a dedicated, more-privileged scope, never implied
// by steer). `terminal` is the "full control from my phone" scope.

import { randomBytes } from "node:crypto";
import { signDeviceToken, verifyDeviceToken } from "./tokenSigning";
import type { DeviceStore } from "./deviceStore";

export type TokenScope = "view" | "steer" | "terminal";

/** Privilege rank for the linear scope ladder (view < steer < terminal). Higher satisfies lower. */
const SCOPE_RANK: Record<TokenScope, number> = { view: 0, steer: 1, terminal: 2 };

/** True iff a token of `held` scope is allowed to do something requiring `required` scope. */
export function scopeSatisfies(held: TokenScope, required: TokenScope): boolean {
  return SCOPE_RANK[held] >= SCOPE_RANK[required];
}

/** Validate an untrusted scope string before minting (audit L4) — so a client can't pass e.g.
 *  "Terminal" or garbage and have it cast silently to a non-terminal 24h token / a junk device. */
export function isTokenScope(s: unknown): s is TokenScope {
  return s === "view" || s === "steer" || s === "terminal";
}

/** Generate a pairing code: uppercased hex of `len` chars (V5 Phase 0.3 widened 8→10 — ~16^10
 *  ≈ 1.1e12 keyspace; the rate limiter on /pair is the primary brute-force defense). */
export function genPairCode(len = 10): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, len).toUpperCase();
}

export interface PairCode {
  code: string;
  scope: TokenScope;
  expiresAt: string;
}

export interface RemoteToken {
  token: string;
  scope: TokenScope;
  expiresAt: string;
  deviceId: string;
}

export interface PairedDevice {
  id: string;
  name: string;
  scope: TokenScope;
  pairedAt: string;
  expiresAt: string;
  lastSeen?: string;
}

export interface VerifyResult {
  ok: boolean;
  scope?: TokenScope;
  deviceId?: string;
  reason?: string;
}

export interface PairingDeps {
  now: () => number;
  genCode: () => string;
  genToken: () => string;
  /** Pair-code lifetime (default 2 min — short, it's only for the handshake). */
  codeTtlMs?: number;
  /** view/steer remote-token lifetime (default 24h). */
  tokenTtlMs?: number;
  /** `terminal`-scope (RCE) token lifetime — capped short (default 1h); rolled forward by refresh()
   *  while a session is live, so a leaked terminal token that isn't continuously connected dies fast
   *  (design R8 / V5 Phase 3.3.3). */
  terminalTokenTtlMs?: number;
  /** Persisted HMAC signing key (C1) — tokens survive an engine respawn. Default: a per-process
   *  ephemeral key (pre-C1 behaviour — re-pair on restart). */
  signingKey?: Buffer;
  /** Persisted device roster (C1) — the authority for scope/expiry/revocation, survives respawn.
   *  Default: in-memory only. */
  deviceStore?: DeviceStore;
}

interface PendingCode {
  scope: TokenScope;
  expiresAtMs: number;
}

const DEFAULT_CODE_TTL = 2 * 60_000;
const DEFAULT_TOKEN_TTL = 24 * 60 * 60_000;
const DEFAULT_TERMINAL_TOKEN_TTL = 60 * 60_000; // 1h — RCE scope, kept short (R8)

// IP-INDEPENDENT brute-force backstop (audit M3): the per-IP /pair limiter collapses to ONE bucket
// behind Tailscale Serve (every remote phone arrives from 127.0.0.1). This global sliding-window cap
// on FAILED redeems holds regardless of source IP. Generous enough that a legit user (who pastes/scans
// the code and rarely fails) never trips it, tight enough to bound an aggregate guessing burst.
const FAILURE_WINDOW_MS = 60_000;
const FAILURE_MAX = 20;

// Roster persistence is throttled so a terminal token's ~2s refresh doesn't write to disk every tick;
// at most one write per this window. Redeem/revoke persist immediately (force). A respawn then sees an
// expiry at worst this stale — still well within a live token's remaining lifetime.
const PERSIST_THROTTLE_MS = 5 * 60_000;

export class PairingService {
  private readonly codes = new Map<string, PendingCode>();
  private readonly devices = new Map<string, PairedDevice>();
  private readonly failures: number[] = []; // timestamps of recent failed redeems (M3 backstop)
  private readonly codeTtl: number;
  private readonly tokenTtl: number;
  private readonly terminalTokenTtl: number;
  private readonly key: Buffer;
  private readonly store?: DeviceStore;
  private lastPersistMs = 0;

  constructor(private readonly deps: PairingDeps) {
    this.codeTtl = deps.codeTtlMs ?? DEFAULT_CODE_TTL;
    this.tokenTtl = deps.tokenTtlMs ?? DEFAULT_TOKEN_TTL;
    this.terminalTokenTtl = deps.terminalTokenTtlMs ?? DEFAULT_TERMINAL_TOKEN_TTL;
    this.key = deps.signingKey ?? randomBytes(32);
    this.store = deps.deviceStore;
    if (this.store) for (const d of this.store.load()) this.devices.set(d.id, d);
  }

  /** Write the roster to disk (if persisted). `force` for durable changes (redeem/revoke); throttled
   *  for the high-frequency refresh roll so live terminal sessions don't hammer the disk. */
  private persist(force: boolean): void {
    if (!this.store) return;
    const now = this.deps.now();
    if (!force && now - this.lastPersistMs < PERSIST_THROTTLE_MS) return;
    this.lastPersistMs = now;
    this.store.save([...this.devices.values()]);
  }

  /** TTL for a scope's token — `terminal` is capped short (R8). */
  private ttlFor(scope: TokenScope): number {
    return scope === "terminal" ? this.terminalTokenTtl : this.tokenTtl;
  }

  /** Desktop-only: mint a short, single-use pair code for the requested scope. */
  createPairCode(scope: TokenScope = "steer"): PairCode {
    const code = this.deps.genCode();
    const expiresAtMs = this.deps.now() + this.codeTtl;
    this.codes.set(code, { scope, expiresAtMs });
    return { code, scope, expiresAt: new Date(expiresAtMs).toISOString() };
  }

  /** True if too many redeem attempts have FAILED recently — an IP-independent brute-force backstop
   *  that still holds when Tailscale Serve collapses every remote phone to 127.0.0.1 (audit M3). The
   *  /pair handler returns 429 when this trips, regardless of source IP. */
  pairingLocked(): boolean {
    const cutoff = this.deps.now() - FAILURE_WINDOW_MS;
    while (this.failures.length && this.failures[0] < cutoff) this.failures.shift();
    return this.failures.length >= FAILURE_MAX;
  }

  /** Client: exchange a valid code for a scoped, expiring token. Code is single-use. */
  redeem(code: string, deviceName: string): RemoteToken | null {
    const pending = this.codes.get(code);
    if (!pending) {
      this.failures.push(this.deps.now()); // record a wrong/unknown code attempt (M3 backstop)
      return null;
    }
    this.codes.delete(code); // single-use, even if expired
    if (this.deps.now() > pending.expiresAtMs) {
      this.failures.push(this.deps.now());
      return null;
    }

    const now = this.deps.now();
    const expiresAtMs = now + this.ttlFor(pending.scope); // terminal scope gets the short cap (R8)
    const deviceId = this.deps.genToken();
    const token = signDeviceToken(deviceId, pending.scope, this.key); // signed capability — survives respawn
    this.devices.set(deviceId, {
      id: deviceId,
      name: deviceName || "device",
      scope: pending.scope,
      pairedAt: new Date(now).toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
    });
    this.persist(true); // durable: a new device joined the roster
    return { token, scope: pending.scope, expiresAt: new Date(expiresAtMs).toISOString(), deviceId };
  }

  /** Roll an active token's expiry forward by its scope's TTL (silent refresh while a session is
   *  live). Returns the new expiry, or null if unknown/expired. An IDLE terminal token gets no
   *  refresh, so it still dies at its short cap (R8 / V5 Phase 3.3.3). */
  refresh(token: string): { expiresAt: string } | null {
    const claim = verifyDeviceToken(token, this.key);
    if (!claim) return null;
    const device = this.devices.get(claim.deviceId);
    if (!device) return null; // revoked/unknown — its roster entry is gone
    const now = this.deps.now();
    if (now > Date.parse(device.expiresAt)) {
      this.devices.delete(device.id);
      this.persist(true);
      return null;
    }
    device.expiresAt = new Date(now + this.ttlFor(device.scope)).toISOString();
    this.persist(false); // throttled — refresh fires ~every 2s while a terminal session is live
    return { expiresAt: device.expiresAt };
  }

  /** Verify a token's signature, then consult the roster (the authority): the device must still be
   *  present (absence = revoked) and unexpired. Updates lastSeen. */
  verify(token: string): VerifyResult {
    const claim = verifyDeviceToken(token, this.key);
    if (!claim) return { ok: false, reason: "bad signature" };
    const device = this.devices.get(claim.deviceId);
    if (!device) return { ok: false, reason: "revoked or unknown device" };
    if (this.deps.now() > Date.parse(device.expiresAt)) return { ok: false, reason: "token expired" };
    if (device.scope !== claim.scope) return { ok: false, reason: "scope mismatch" }; // signed scope must match the roster
    device.lastSeen = new Date(this.deps.now()).toISOString();
    return { ok: true, scope: device.scope, deviceId: device.id };
  }

  /** Verify AND require a scope along the linear ladder (view < steer < terminal). A higher
   *  scope satisfies a lower requirement; a lower NEVER satisfies a higher (so a "steer" token
   *  is denied "terminal", and "view" is denied "steer"). */
  requireScope(token: string, required: TokenScope): VerifyResult {
    const v = this.verify(token);
    if (!v.ok) return v;
    if (!v.scope || !scopeSatisfies(v.scope, required)) return { ok: false, reason: "insufficient scope" };
    return v;
  }

  listDevices(): PairedDevice[] {
    return [...this.devices.values()].sort((a, b) => a.pairedAt.localeCompare(b.pairedAt));
  }

  /** Revoke a device and invalidate its token immediately (its signed token then fails the roster
   *  presence check). Persisted so the revocation survives a respawn too. */
  revoke(deviceId: string): boolean {
    if (!this.devices.has(deviceId)) return false;
    this.devices.delete(deviceId);
    this.persist(true);
    return true;
  }
}

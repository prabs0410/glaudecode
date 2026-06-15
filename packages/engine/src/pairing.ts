// Pairing & scoped tokens (Epic G §3.2 — the security heart). The per-launch bearer token
// must NEVER be shared to a phone. Instead the desktop issues a short, expiring PAIR CODE; a
// client redeems it for a scoped, expiring, revocable REMOTE TOKEN. Tokens are held in memory
// only (no token at rest) and die with the engine — re-pair after a restart. Scope is "view"
// (read-only), "steer" (can answer approvals / send follow-ups), or "terminal" (can type into
// armed terminal panes — the RCE-class scope; V5 Phase 2). All time + randomness is injected so
// the logic is fully deterministic under test.
//
// Scope is a linear privilege ladder: view < steer < terminal. A higher scope satisfies every
// lower requirement, but NEVER the reverse — crucially, a "steer" token can answer approvals yet
// can NEVER type into a terminal (terminal is a dedicated, more-privileged scope, never implied
// by steer). `terminal` is the "full control from my phone" scope.

export type TokenScope = "view" | "steer" | "terminal";

/** Privilege rank for the linear scope ladder (view < steer < terminal). Higher satisfies lower. */
const SCOPE_RANK: Record<TokenScope, number> = { view: 0, steer: 1, terminal: 2 };

/** True iff a token of `held` scope is allowed to do something requiring `required` scope. */
export function scopeSatisfies(held: TokenScope, required: TokenScope): boolean {
  return SCOPE_RANK[held] >= SCOPE_RANK[required];
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
}

interface PendingCode {
  scope: TokenScope;
  expiresAtMs: number;
}
interface ActiveToken {
  token: string;
  deviceId: string;
  scope: TokenScope;
  expiresAtMs: number;
}

const DEFAULT_CODE_TTL = 2 * 60_000;
const DEFAULT_TOKEN_TTL = 24 * 60 * 60_000;
const DEFAULT_TERMINAL_TOKEN_TTL = 60 * 60_000; // 1h — RCE scope, kept short (R8)

export class PairingService {
  private readonly codes = new Map<string, PendingCode>();
  private readonly tokens = new Map<string, ActiveToken>();
  private readonly devices = new Map<string, PairedDevice>();
  private readonly codeTtl: number;
  private readonly tokenTtl: number;
  private readonly terminalTokenTtl: number;

  constructor(private readonly deps: PairingDeps) {
    this.codeTtl = deps.codeTtlMs ?? DEFAULT_CODE_TTL;
    this.tokenTtl = deps.tokenTtlMs ?? DEFAULT_TOKEN_TTL;
    this.terminalTokenTtl = deps.terminalTokenTtlMs ?? DEFAULT_TERMINAL_TOKEN_TTL;
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

  /** Client: exchange a valid code for a scoped, expiring token. Code is single-use. */
  redeem(code: string, deviceName: string): RemoteToken | null {
    const pending = this.codes.get(code);
    if (!pending) return null;
    this.codes.delete(code); // single-use, even if expired
    if (this.deps.now() > pending.expiresAtMs) return null;

    const now = this.deps.now();
    const expiresAtMs = now + this.ttlFor(pending.scope); // terminal scope gets the short cap (R8)
    const deviceId = this.deps.genToken();
    const token = this.deps.genToken();
    this.tokens.set(token, { token, deviceId, scope: pending.scope, expiresAtMs });
    this.devices.set(deviceId, {
      id: deviceId,
      name: deviceName || "device",
      scope: pending.scope,
      pairedAt: new Date(now).toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
    });
    return { token, scope: pending.scope, expiresAt: new Date(expiresAtMs).toISOString(), deviceId };
  }

  /** Roll an active token's expiry forward by its scope's TTL (silent refresh while a session is
   *  live). Returns the new expiry, or null if unknown/expired. An IDLE terminal token gets no
   *  refresh, so it still dies at its short cap (R8 / V5 Phase 3.3.3). */
  refresh(token: string): { expiresAt: string } | null {
    const t = this.tokens.get(token);
    if (!t) return null;
    const now = this.deps.now();
    if (now > t.expiresAtMs) {
      this.tokens.delete(t.token);
      return null;
    }
    t.expiresAtMs = now + this.ttlFor(t.scope);
    const device = this.devices.get(t.deviceId);
    if (device) device.expiresAt = new Date(t.expiresAtMs).toISOString();
    return { expiresAt: new Date(t.expiresAtMs).toISOString() };
  }

  /** Verify a token is active + unexpired; updates lastSeen. */
  verify(token: string): VerifyResult {
    const t = this.tokens.get(token);
    if (!t) return { ok: false, reason: "unknown token" };
    if (this.deps.now() > t.expiresAtMs) {
      this.tokens.delete(t.token);
      return { ok: false, reason: "token expired" };
    }
    const device = this.devices.get(t.deviceId);
    if (device) device.lastSeen = new Date(this.deps.now()).toISOString();
    return { ok: true, scope: t.scope, deviceId: t.deviceId };
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

  /** Revoke a device and invalidate its token immediately. */
  revoke(deviceId: string): boolean {
    if (!this.devices.has(deviceId)) return false;
    this.devices.delete(deviceId);
    for (const [token, t] of this.tokens) if (t.deviceId === deviceId) this.tokens.delete(token);
    return true;
  }
}

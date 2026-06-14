// Pairing & scoped tokens (Epic G §3.2 — the security heart). The per-launch bearer token
// must NEVER be shared to a phone. Instead the desktop issues a short, expiring PAIR CODE; a
// client redeems it for a scoped, expiring, revocable REMOTE TOKEN. Tokens are held in memory
// only (no token at rest) and die with the engine — re-pair after a restart. Scope is "view"
// (read-only) or "steer" (can answer approvals / send follow-ups). All time + randomness is
// injected so the logic is fully deterministic under test.

export type TokenScope = "view" | "steer";

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
  /** Remote-token lifetime (default 24h). */
  tokenTtlMs?: number;
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

export class PairingService {
  private readonly codes = new Map<string, PendingCode>();
  private readonly tokens = new Map<string, ActiveToken>();
  private readonly devices = new Map<string, PairedDevice>();
  private readonly codeTtl: number;
  private readonly tokenTtl: number;

  constructor(private readonly deps: PairingDeps) {
    this.codeTtl = deps.codeTtlMs ?? DEFAULT_CODE_TTL;
    this.tokenTtl = deps.tokenTtlMs ?? DEFAULT_TOKEN_TTL;
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
    const expiresAtMs = now + this.tokenTtl;
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

  /** Verify AND require a scope. "steer" implies "view"; "view" never satisfies "steer". */
  requireScope(token: string, required: TokenScope): VerifyResult {
    const v = this.verify(token);
    if (!v.ok) return v;
    if (required === "steer" && v.scope !== "steer") return { ok: false, reason: "insufficient scope" };
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

// Persisted paired-device roster (V8 Phase 2 / C1). With signed tokens (tokenSigning.ts), the roster
// — NOT the token — is the authority for scope, expiry, and revocation: a device's PRESENCE here means
// its token is valid, its ABSENCE means revoked/unknown. Persisting it (0600) alongside the signing
// key is what lets a paired phone survive an engine respawn. Holds only device METADATA — never a
// bearer token (the token lives on the phone). Sync JSON I/O, mirroring PushSubscriptionStore.

import { homedir } from "node:os";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { PairedDevice } from "./pairing";

export class DeviceStore {
  constructor(private readonly home: string = homedir()) {}

  private path(): string {
    return join(this.home, ".glaudecode", "devices.json");
  }

  /** Load the persisted roster (empty on a missing/corrupt file — fail-safe, never throws). A CORRUPT
   *  file (vs a missing one) is surfaced: resetting the roster logs every paired device out. */
  load(): PairedDevice[] {
    try {
      const raw = readFileSync(this.path(), "utf8");
      const parsed = raw.trim() ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? (parsed as PairedDevice[]) : [];
    } catch (e: any) {
      if (e?.code !== "ENOENT") {
        console.error("[glaudecode] device roster unreadable/corrupt — resetting; all paired devices must re-pair");
      }
      return [];
    }
  }

  save(devices: PairedDevice[]): void {
    const p = this.path();
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(devices), { mode: 0o600 });
  }
}

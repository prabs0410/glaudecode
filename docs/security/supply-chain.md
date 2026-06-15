# Supply chain & signed releases (V5 Phase 7.4)

> An **auto-updating remote-shell tool is one tricked update away from mass RCE.** So every release is
> signed and the updater verifies it against a key **pinned in the app** — never a key fetched from the
> update manifest. This doc states the scheme + how to verify; the actual signing **trust-root is a
> maintainer action** (Task 7.4.3, a HUMAN-GATE) and is not in the repo.

## Target

- **SLSA Build Level 3+** — built only by the CI workflow (`.github/workflows/release.yml`) from a
  tagged commit, with provenance attestation; no local/unattested release artifacts.
- **Signed artifacts** — each release binary + the update manifest are signed.
- **Published SBOM** — a CycloneDX/SPDX SBOM attached to each release.

## Pinned-key updater (the P0 control)

The Tauri updater config (added when the key is provisioned — see 7.4.3) pins the **public** key at
build time and rejects any update not signed by the matching private key:

```jsonc
// packages/desktop/src-tauri/tauri.conf.json — added during the signing-root gate (7.4.3)
"plugins": {
  "updater": {
    "pubkey": "<minisign/tauri PUBLIC key — pinned at build, NEVER fetched from the manifest>",
    "endpoints": ["https://github.com/prabs0410/glaudecode/releases/latest/download/latest.json"],
    "windows": { "installMode": "passive" }
  }
}
```

Rules:
- The **public** key is committed (pinned). The **private** key lives ONLY in CI secrets
  (`TAURI_SIGNING_PRIVATE_KEY` + its password) — never in the repo, never in logs.
- The updater verifies every update's signature against the pinned key. A manifest signed by the
  wrong key (or unsigned) is **rejected** — this is the mass-RCE backstop.

## How a user verifies a release

1. Download the artifact + its `.sig` from the GitHub release.
2. Verify with the published public key (minisign/cosign), e.g. `minisign -Vm <artifact> -P <pubkey>`.
3. Confirm the SBOM + SLSA provenance attestation on the release.

## Maintainer setup (HUMAN-GATE 7.4.3 — release-blocking for public)

1. Generate the keypair: `bun --cwd packages/desktop run tauri signer generate -w ~/.glaudecode.key`.
2. Add the **private** key + password to GitHub Actions secrets.
3. Paste the **public** key into `tauri.conf.json` `plugins.updater.pubkey` and commit (the pin).
4. Confirm a CI release run signs with that key and the pinned-key updater accepts it; the private
   key never appears in the repo or logs.

Until this is done, **do not publish a public auto-updating release.**

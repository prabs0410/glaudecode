// File-upload helpers (V6) — a paired (terminal-scope) phone POSTs a document/photo to /upload and
// the engine writes it under <cwd>/.glaudecode-uploads/ so the composer can @-reference it to Claude.
// The destination directory is ALWAYS server-chosen (process.cwd()); the client only supplies a
// filename, which is reduced here to a safe basename that can never traverse out of the uploads dir.
// Pure logic, unit-tested; the route in server.ts does the gating + the actual disk write.

import { basename } from "node:path";

/** Subdirectory (under the engine's working dir) where uploads land. Gitignored on creation. */
export const UPLOAD_SUBDIR = ".glaudecode-uploads";
/** Hard cap on an upload — generous for a doc/photo, absurd for abuse. Mirrors the INPUT byte cap. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MiB

/**
 * Reduce an arbitrary client-supplied filename to a safe basename that can only ever land INSIDE the
 * uploads dir. Drops any directory components (so `../../etc/passwd`, `/etc/shadow`, `a/b/c.png` all
 * collapse to their last segment), keeps a conservative allowlist, refuses a leading dot (no hidden /
 * `.gitignore` clobber, no `.`/`..`), and bounds the length. Empty/degenerate input → "upload".
 */
export function safeUploadName(raw: string): string {
  let n = String(raw ?? "").replace(/\\/g, "/"); // treat a backslash as a separator too (Windows names)
  n = basename(n); // strip any path: foo/../bar, /etc/x, a\b\c → last segment
  n = n.replace(/[^A-Za-z0-9._-]/g, "_"); // conservative allowlist (spaces, parens, unicode → _)
  n = n.replace(/^\.+/, ""); // no leading dots — kills ".", "..", ".hidden", "...x"
  n = n.replace(/_+/g, "_"); // collapse runs of underscores from the substitutions
  n = n.slice(0, 120); // bound the length
  if (!n || n === "_") n = "upload";
  return n;
}

/**
 * Read a byte stream into a single buffer, aborting the moment the running total exceeds `cap` (#36).
 * The naive `await request.arrayBuffer()` buffers the WHOLE body before any size check, so a chunked
 * upload with no honest `content-length` could OOM the sidecar before a post-hoc `bytes.length > cap`
 * fired. This counts bytes AS they arrive and cancels the stream at the first chunk over the cap, so
 * we never hold more than `cap` (+ one chunk) in memory. Returns the bytes, or `null` if the cap was
 * exceeded (the caller responds 413). A null stream → an empty buffer (an empty body the caller 400s).
 */
export async function readStreamCapped(
  stream: ReadableStream<Uint8Array> | null | undefined,
  cap: number,
): Promise<Uint8Array | null> {
  if (!stream) return new Uint8Array(0);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    let res: Awaited<ReturnType<typeof reader.read>>;
    try {
      res = await reader.read();
    } catch {
      return null; // a broken/aborted body is treated as a failed upload, not a partial save
    }
    if (res.done) break;
    const value = res.value;
    if (!value || value.byteLength === 0) continue;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => {}); // stop the peer streaming more; we already refuse it
      return null;
    }
    chunks.push(value);
  }
  if (chunks.length === 1) return chunks[0];
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

/**
 * Pick a non-clobbering destination filename: if `name` is free, use it; otherwise insert -1, -2 …
 * before the extension. `exists` is injected so this stays pure + unit-testable.
 */
export function uniqueUploadName(name: string, exists: (n: string) => boolean): string {
  if (!exists(name)) return name;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let i = 1; i < 10000; i++) {
    const candidate = `${stem}-${i}${ext}`;
    if (!exists(candidate)) return candidate;
  }
  return name; // 10000 collisions is absurd — overwrite as the last resort
}

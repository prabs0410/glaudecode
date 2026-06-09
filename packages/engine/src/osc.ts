// OSC shell-integration parsing (V3-E2). The shell emits OSC 133 (FinalTerm semantic prompt
// markers) and OSC 7 (cwd); the WebView's OSC handlers feed the payloads here to learn command
// boundaries, exit codes, and the live directory. Pure + unit-tested; mirrored in the bundle.

export interface Osc133Event {
  kind: "prompt-start" | "command-start" | "pre-exec" | "command-done" | "other";
  /** Present on `command-done` (OSC 133 ; D ; <exit>). */
  exitCode?: number;
}

/** Parse an OSC 133 payload (the text after "133;"), e.g. "A", "C", "D", "D;0", "D;130". */
export function parseOsc133(payload: string): Osc133Event {
  const parts = payload.split(";");
  switch (parts[0]) {
    case "A":
      return { kind: "prompt-start" };
    case "B":
      return { kind: "command-start" };
    case "C":
      return { kind: "pre-exec" };
    case "D": {
      const raw = parts[1];
      const code = raw !== undefined && raw !== "" ? Number(raw) : undefined;
      return { kind: "command-done", exitCode: Number.isFinite(code as number) ? code : undefined };
    }
    default:
      return { kind: "other" };
  }
}

/** Parse an OSC 7 payload "file://<host><path>" into an absolute path, or null. */
export function parseOsc7(payload: string): string | null {
  const m = payload.match(/^file:\/\/[^/]*(\/.*)$/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

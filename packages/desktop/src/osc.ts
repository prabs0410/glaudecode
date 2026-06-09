// Frontend mirror of @glaudecode/engine's OSC parsing (verified by that package's osc.test.ts).
// Kept in sync so the WebView's OSC handlers don't import the Node-only engine.

export interface Osc133Event {
  kind: "prompt-start" | "command-start" | "pre-exec" | "command-done" | "other";
  exitCode?: number;
}

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

export function parseOsc7(payload: string): string | null {
  const m = payload.match(/^file:\/\/[^/]*(\/.*)$/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

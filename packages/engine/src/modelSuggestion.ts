import type { SessionMessage } from "./types";

// Cheap-mode model suggestion (Epic C §3.4). A pure heuristic that flags a likely-trivial
// task so the user can switch the session to Haiku and save cost. SUGGESTION-FIRST: we
// never silently reroute a prompt (we can't, for interactive sessions — documented limit);
// we only surface a one-click switch. Tested as a pure function.

export interface ModelSuggestion {
  /** "haiku" to suggest downgrading; null when there's no strong signal. */
  suggest: "haiku" | null;
  reason: string;
}

// Words that signal simple, mechanical work.
const TRIVIAL = [
  /\btypos?\b/, /\brename\b/, /\bformat(ting)?\b/, /\blint\b/, /\bcomments?\b/, /\bgitignore\b/,
  /\bbump\b/, /\bwhitespace\b/, /\breadme\b/, /\bspelling\b/, /\bindent/, /\blog messages?\b/,
];
// Words that signal hard work — never suggest a downgrade for these.
const COMPLEX = [
  /\barchitect/, /\bdesign\b/, /\brefactor/, /\bdebug/, /\binvestigat/, /\bimplement/,
  /\balgorithm/, /\bperformance\b/, /\bsecurity\b/, /\bconcurren/, /\brace condition/,
  /\bmigrat/, /\boptimi[sz]e/, /\broot cause/, /\bwhy\b/,
];

export function suggestModel(prompt: string, opts: { currentModel?: string } = {}): ModelSuggestion {
  const cur = (opts.currentModel ?? "").toLowerCase();
  if (cur.includes("haiku")) return { suggest: null, reason: "already on Haiku" };

  const p = prompt.trim().toLowerCase();
  if (!p) return { suggest: null, reason: "no prompt yet" };
  if (COMPLEX.some((re) => re.test(p))) return { suggest: null, reason: "looks non-trivial" };

  if (TRIVIAL.some((re) => re.test(p)) && p.length <= 140) {
    return { suggest: "haiku", reason: "looks like a simple edit — Haiku can likely handle it" };
  }
  if (p.length <= 40 && !p.includes("?")) {
    return { suggest: "haiku", reason: "very short task — try Haiku to save cost" };
  }
  return { suggest: null, reason: "no strong signal" };
}

/** The text of the most recent user message (the latest instruction). */
export function latestUserPrompt(messages: SessionMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== "user") continue;
    const text = m.blocks
      .filter((b): b is { kind: "text"; text: string } => b.kind === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (text) return text;
  }
  return "";
}

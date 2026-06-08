import type { SessionSummary } from "./types";

// Pure session search/filter. Case-insensitive AND-of-terms substring match across
// the human-meaningful fields. Kept here (with the engine's test infra) so the
// sidebar's filtering is verified independently of the UI.

export function filterSessions(sessions: SessionSummary[], query: string): SessionSummary[] {
  const q = query.trim().toLowerCase();
  if (!q) return sessions;
  const terms = q.split(/\s+/);
  return sessions.filter((s) => {
    const haystack = [s.title, s.firstPrompt, s.summary, s.gitBranch, s.tag, s.cwd]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return terms.every((t) => haystack.includes(t));
  });
}

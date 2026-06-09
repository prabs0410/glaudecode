import { useEffect, useState } from "react";
import { resumeBriefing, type ResumeBriefing } from "./engine";

// Semantic-resume banner (Epic E §3.5). When a session is inspected, show a short recap +
// suggested next step so you can pick it back up without re-reading the transcript.
// Dismissible per session.

export function ResumeBanner({ dir, selectedId }: { dir: string | null; selectedId: string | null }) {
  const [briefing, setBriefing] = useState<ResumeBriefing | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    if (!dir || !selectedId) {
      setBriefing(null);
      return;
    }
    let alive = true;
    resumeBriefing(selectedId, dir)
      .then((b) => alive && setBriefing(b))
      .catch(() => alive && setBriefing(null));
    return () => {
      alive = false;
    };
  }, [dir, selectedId]);

  if (!selectedId || !briefing || dismissed === selectedId) return null;

  return (
    <div className="resume-banner">
      <button className="resume-x" title="Dismiss" onClick={() => setDismissed(selectedId)}>
        ✕
      </button>
      <div className="resume-recap">{briefing.recap}</div>
      <div className="resume-next">→ {briefing.suggestedNext}</div>
    </div>
  );
}

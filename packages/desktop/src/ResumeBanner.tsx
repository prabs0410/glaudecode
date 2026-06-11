import { useEffect, useState } from "react";
import { resumeBriefing, type ResumeBriefing } from "./engine";

// Semantic-resume banner (Epic E §3.5, retimed in V4-A3). Shown when you SELECT a stale session
// you haven't opened yet — a short recap + suggested next step so you can decide to pick it back
// up before spawning the resume. It is deliberately NOT bound to the active pane (the dock is);
// a session already open as the foreground pane never shows this.

export function ResumeBanner({
  dir,
  sessionId,
  onResume,
  onDismiss,
}: {
  dir: string | null;
  sessionId: string | null;
  onResume: () => void;
  onDismiss: () => void;
}) {
  const [briefing, setBriefing] = useState<ResumeBriefing | null>(null);

  useEffect(() => {
    if (!dir || !sessionId) {
      setBriefing(null);
      return;
    }
    let alive = true;
    setBriefing(null);
    resumeBriefing(sessionId, dir)
      .then((b) => alive && setBriefing(b))
      .catch(() => alive && setBriefing(null));
    return () => {
      alive = false;
    };
  }, [dir, sessionId]);

  if (!sessionId) return null;

  return (
    <div className="resume-banner">
      <div className="resume-text">
        <div className="resume-recap">{briefing ? briefing.recap : "Loading recap…"}</div>
        {briefing && <div className="resume-next">→ {briefing.suggestedNext}</div>}
      </div>
      <button className="act resume-go" onClick={onResume}>
        Resume this session
      </button>
      <button className="resume-x" title="Dismiss" onClick={onDismiss}>
        ✕
      </button>
    </div>
  );
}

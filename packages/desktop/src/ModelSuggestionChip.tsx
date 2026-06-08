import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { modelSuggestion, type ModelSuggestion } from "./engine";

// Cheap-mode chip (Epic C §3.4). For the inspected session, if its latest task looks
// trivial, suggest Haiku. SUGGESTION-FIRST: clicking types `/model haiku ` into the live
// pane for the user to review and send — we never silently reroute a prompt.
const POLL_MS = 6000;
const HAIKU = "claude-haiku-4-5";

interface Props {
  sessionId: string | null;
  dir: string | null;
  /** True if this session has a live pane (paneId === sessionId) we can type into. */
  isLive: boolean;
}

export function ModelSuggestionChip({ sessionId, dir, isLive }: Props) {
  const [sug, setSug] = useState<ModelSuggestion | null>(null);

  useEffect(() => {
    if (!sessionId || !dir) {
      setSug(null);
      return;
    }
    let alive = true;
    const poll = async () => {
      try {
        const s = await modelSuggestion(sessionId, dir);
        if (alive) setSug(s);
      } catch {
        /* transient */
      }
    };
    void poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [sessionId, dir]);

  if (!sug || sug.suggest !== "haiku") return null;

  const apply = () => {
    if (!isLive || !sessionId) return;
    // Type the command in; the user reviews and presses Enter (no auto-submit).
    void invoke("pty_write", { paneId: sessionId, data: `/model ${HAIKU} ` });
  };

  return (
    <button
      className="model-suggest"
      title={isLive ? `${sug.reason} — click to type /model ${HAIKU}` : sug.reason}
      onClick={apply}
      disabled={!isLive}
    >
      💡 Haiku?
    </button>
  );
}

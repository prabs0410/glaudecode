import { useState } from "react";
import { TimelinePanel } from "./TimelinePanel";
import { ChangesPanel } from "./ChangesPanel";
import { MemoryPanel } from "./MemoryPanel";
import { GraphPanel } from "./GraphPanel";
import { ComparePanel } from "./ComparePanel";
import { ReplayPanel } from "./ReplayPanel";

// Right-hand dock: tabbed Timeline (V1-3), Changes (V1-5), Memory + Graph (Epic D), and
// Compare (Epic E) for the selected session / project.

type Tab = "timeline" | "changes" | "memory" | "graph" | "compare" | "replay";

export function RightDock({
  dir,
  selectedId,
  projectDir,
  inferred = false,
  ambiguous = false,
  width,
}: {
  dir: string | null;
  selectedId: string | null;
  /** The project root (≠ a worktree session's cwd) — used to scope cross-session compare. */
  projectDir: string | null;
  /** True when this session was auto-detected in a shell pane (heuristic), not spawned by us. */
  inferred?: boolean;
  /** True when ≥2 sessions are live in this cwd and the inference can't tell which the shell drives;
   *  the dock may be showing the wrong one (audit #11) — say so rather than imply certainty. */
  ambiguous?: boolean;
  width?: number;
}) {
  const [tab, setTab] = useState<Tab>("timeline");

  return (
    <section className="rightdock" style={width ? { width, minWidth: width } : undefined}>
      {inferred && selectedId && (
        <div
          className={`dock-inferred${ambiguous ? " ambiguous" : ""}`}
          title={
            ambiguous
              ? "Multiple Claude sessions are live in this folder — this may not be the one you're typing in. Open the session in its own pane to be sure."
              : "Auto-detected from the active shell's working directory"
          }
        >
          {ambiguous ? "⚠ Multiple live sessions here — showing the newest (may be wrong)" : "⌁ Detected Claude session in this shell"}
        </div>
      )}
      <div className="dock-tabs">
        <button
          className={`dock-tab${tab === "timeline" ? " active" : ""}`}
          onClick={() => setTab("timeline")}
        >
          Timeline
        </button>
        <button
          className={`dock-tab${tab === "changes" ? " active" : ""}`}
          onClick={() => setTab("changes")}
        >
          Changes
        </button>
        <button
          className={`dock-tab${tab === "memory" ? " active" : ""}`}
          onClick={() => setTab("memory")}
        >
          Memory
        </button>
        <button
          className={`dock-tab${tab === "graph" ? " active" : ""}`}
          onClick={() => setTab("graph")}
        >
          Graph
        </button>
        <button
          className={`dock-tab${tab === "compare" ? " active" : ""}`}
          onClick={() => setTab("compare")}
        >
          Compare
        </button>
        <button
          className={`dock-tab${tab === "replay" ? " active" : ""}`}
          onClick={() => setTab("replay")}
        >
          Replay
        </button>
      </div>
      <div className="dock-body">
        {tab === "timeline" && <TimelinePanel dir={dir} selectedId={selectedId} />}
        {tab === "changes" && <ChangesPanel dir={dir} selectedId={selectedId} />}
        {tab === "memory" && <MemoryPanel dir={dir} selectedId={selectedId} />}
        {tab === "graph" && <GraphPanel dir={dir} />}
        {tab === "compare" && (
          <ComparePanel dir={dir} selectedId={selectedId} projectDir={projectDir} />
        )}
        {tab === "replay" && <ReplayPanel dir={dir} selectedId={selectedId} />}
      </div>
    </section>
  );
}

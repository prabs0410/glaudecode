import { useState } from "react";
import { TimelinePanel } from "./TimelinePanel";
import { ChangesPanel } from "./ChangesPanel";
import { MemoryPanel } from "./MemoryPanel";

// Right-hand dock: tabbed Timeline (V1-3), Changes (V1-5), and Memory (Epic D) for the
// selected session / project.

type Tab = "timeline" | "changes" | "memory";

export function RightDock({ dir, selectedId }: { dir: string | null; selectedId: string | null }) {
  const [tab, setTab] = useState<Tab>("timeline");

  return (
    <section className="rightdock">
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
      </div>
      <div className="dock-body">
        {tab === "timeline" && <TimelinePanel dir={dir} selectedId={selectedId} />}
        {tab === "changes" && <ChangesPanel dir={dir} selectedId={selectedId} />}
        {tab === "memory" && <MemoryPanel dir={dir} selectedId={selectedId} />}
      </div>
    </section>
  );
}

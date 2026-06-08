import { useState } from "react";
import { TimelinePanel } from "./TimelinePanel";
import { ChangesPanel } from "./ChangesPanel";

// Right-hand dock: tabbed Timeline (V1-3) and Changes (V1-5) for the selected session.

type Tab = "timeline" | "changes";

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
      </div>
      <div className="dock-body">
        {tab === "timeline" ? (
          <TimelinePanel dir={dir} selectedId={selectedId} />
        ) : (
          <ChangesPanel dir={dir} selectedId={selectedId} />
        )}
      </div>
    </section>
  );
}

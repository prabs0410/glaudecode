import { useEffect, useState } from "react";
import { metaObservations, type Observation } from "./engine";

// Advisory meta-agent strip (Epic B §3.3). OFF by default — it polls nothing until the
// user turns it on. When on, it asks the engine for rule-based cross-session
// observations (stuck / conflict / finished) and lists them. It never acts; at most an
// observation invites the user to hand off. Rule-based, so its cost is $0 (shown).
const POLL_MS = 5000;

interface LiveSession {
  id: string;
  dir: string;
  title: string;
}

export function MetaAgentPanel({ sessions }: { sessions: LiveSession[] }) {
  const [enabled, setEnabled] = useState(false);
  const [observations, setObservations] = useState<Observation[]>([]);
  const key = sessions
    .map((s) => s.id)
    .sort()
    .join(",");

  useEffect(() => {
    if (!enabled || sessions.length === 0) {
      setObservations([]);
      return;
    }
    let alive = true;
    const poll = async () => {
      try {
        const obs = await metaObservations(sessions.map((s) => ({ id: s.id, dir: s.dir, title: s.title })));
        if (alive) setObservations(obs);
      } catch {
        /* transient — keep last known */
      }
    };
    void poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key]);

  // Nothing to advise on until at least one live Claude session exists.
  if (sessions.length === 0) return null;

  return (
    <div className="advisor">
      <div className="advisor-head">
        <button
          className={`advisor-toggle${enabled ? " on" : ""}`}
          onClick={() => setEnabled((e) => !e)}
          title="Advisory observations across your live sessions (off by default)"
        >
          <span className="advisor-dot" /> Advisor {enabled ? "On" : "Off"}
        </button>
        {enabled && <span className="advisor-cost" title="Rule-based — no model cost">$0.00</span>}
      </div>
      {enabled && observations.length > 0 && (
        <ul className="advisor-list">
          {observations.map((o) => (
            <li key={o.id} className={`advisor-item ${o.level}`}>
              {o.text}
            </li>
          ))}
        </ul>
      )}
      {enabled && observations.length === 0 && (
        <div className="advisor-empty">No observations — sessions look healthy.</div>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { agentState, budgetStatus, pendingApprovals } from "./engine";
import { coalesceNotifications, type AppNotification } from "./notify";

// Notification service (Epic F §3.4). Watches the signals that let you walk away — a session
// finishing, a tool call needing approval, a budget threshold — and fires a native OS
// notification (debounced via the poll interval, coalesced so a burst becomes one) plus an
// in-app toast fallback. Quiet mode suppresses the OS notifications; toasts still show. The
// EventBus (Epic B) will replace this polling with a push stream later.
const POLL_MS = 3000;
const TOAST_MS = 6000;

interface Toast extends AppNotification {
  id: string;
}

interface Props {
  liveSessions: Array<{ id: string; dir: string }>;
  projectDir: string | null;
  quiet: boolean;
  onSelectSession: (sessionId: string) => void;
}

async function osNotify(title: string, body: string) {
  try {
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    if (granted) sendNotification({ title, body });
  } catch {
    /* permission denied / plugin unavailable → toast only (§5) */
  }
}

const titleFor: Record<AppNotification["kind"], string> = {
  finished: "Session finished",
  approval: "Approval needed",
  error: "Session error",
  budget: "Budget alert",
  question: "Waiting on you",
};

export function NotificationService({ liveSessions, projectDir, quiet, onSelectSession }: Props) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const prevApprovals = useRef(0);
  const prevStatus = useRef<Map<string, string>>(new Map());
  const prevBudget = useRef<string>("none");
  const sessKey = liveSessions.map((s) => s.id).sort().join(",");

  const addToast = (n: AppNotification) => {
    const id = crypto.randomUUID();
    setToasts((t) => [...t, { ...n, id }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), TOAST_MS);
  };

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const batch: AppNotification[] = [];

      try {
        const ap = await pendingApprovals();
        if (ap.length > prevApprovals.current) batch.push({ kind: "approval", text: `${ap.length} tool call(s) need approval`, sessionId: ap[0]?.sessionId });
        prevApprovals.current = ap.length;
      } catch {
        /* ignore */
      }

      for (const s of liveSessions) {
        try {
          const st = await agentState(s.id, s.dir);
          const prev = prevStatus.current.get(s.id);
          if ((prev === "thinking" || prev === "running-tool") && st.status === "idle") {
            batch.push({ kind: "finished", sessionId: s.id, text: "A session finished" });
          }
          prevStatus.current.set(s.id, st.status);
        } catch {
          /* ignore */
        }
      }

      if (projectDir) {
        try {
          const b = await budgetStatus(projectDir, liveSessions);
          if ((b.state === "warn" || b.state === "over") && b.state !== prevBudget.current) {
            const pct = Math.round((b.dailyPct ?? b.totalPct ?? 0) * 100);
            batch.push({ kind: "budget", text: `Budget ${b.state} — ${pct}% of cap` });
          }
          prevBudget.current = b.state;
        } catch {
          /* ignore */
        }
      }

      if (!alive || batch.length === 0) return;
      for (const n of coalesceNotifications(batch)) {
        if (!quiet) void osNotify(titleFor[n.kind], n.text);
        addToast(n);
      }
    };
    void poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessKey, projectDir, quiet]);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast ${t.kind}`}
          onClick={() => {
            if (t.sessionId) onSelectSession(t.sessionId);
            setToasts((ts) => ts.filter((x) => x.id !== t.id));
          }}
        >
          <span className="toast-title">{titleFor[t.kind]}</span>
          <span className="toast-text">{t.text}</span>
        </div>
      ))}
    </div>
  );
}

// Notification coalescing (Epic F §3.4). A chatty fleet shouldn't spam the OS: a batch of
// pending notifications is coalesced so several same-kind events become one ("3 sessions
// finished"). Pure + unit-tested; the frontend NotificationService debounces a window of
// events then runs them through this before calling the OS notification plugin.

export type NotificationKind = "finished" | "approval" | "error" | "budget";

export interface AppNotification {
  kind: NotificationKind;
  sessionId?: string;
  text: string;
}

export function coalesceNotifications(items: AppNotification[]): AppNotification[] {
  const byKind = new Map<NotificationKind, AppNotification[]>();
  for (const n of items) {
    const list = byKind.get(n.kind) ?? [];
    list.push(n);
    byKind.set(n.kind, list);
  }
  const out: AppNotification[] = [];
  for (const [kind, group] of byKind) {
    if (group.length === 1) out.push(group[0]);
    else out.push({ kind, text: summaryText(kind, group.length) });
  }
  return out;
}

function summaryText(kind: NotificationKind, n: number): string {
  switch (kind) {
    case "finished":
      return `${n} sessions finished`;
    case "approval":
      return `${n} tool calls need approval`;
    case "error":
      return `${n} sessions errored`;
    case "budget":
      return `${n} budget alerts`;
  }
}

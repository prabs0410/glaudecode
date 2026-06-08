// Lifecycle EventBus (Epic B §3.1). A typed in-engine emitter: the orchestrator
// (Epic A) and the adapter emit session-lifecycle events; the bus fans them out to
// (a) the WebView for UI reactions and (b) the ExtensionHost (B2). The taxonomy is
// locked by ADR 0002. Handler failures are isolated — one throwing subscriber never
// blocks delivery to the others (§5) — and reported back to the caller.

export type LifecycleEventType =
  | "session_start"
  | "session_before_fork"
  | "session_before_switch"
  | "session_before_compact"
  | "session_compact"
  | "session_shutdown"
  | "session_forked_to_worktree"
  | "session_merged_from_peer";

export type SessionStartReason = "new" | "resume" | "fork" | "startup";

export interface LifecycleEvent {
  type: LifecycleEventType;
  sessionId: string;
  /** Only on `session_start`. */
  reason?: SessionStartReason;
  /** The other session, on cross-session events (forked_to/merged_from). */
  peer?: string;
  /** ISO timestamp; caller-supplied so the bus stays pure/deterministic in tests. */
  at?: string;
}

export type LifecycleHandler = (event: LifecycleEvent) => void;

/** Subscribe to one event type, or to "*" for every event. */
export type Subscription = LifecycleEventType | "*";

export interface EmitResult {
  /** Number of handlers the event was delivered to. */
  delivered: number;
  /** Handlers that threw, with their error — delivery continued past each. */
  errors: Array<{ handler: LifecycleHandler; error: unknown }>;
}

export class EventBus {
  private readonly handlers = new Map<Subscription, Set<LifecycleHandler>>();

  /** Register a handler. Returns an unsubscribe function. */
  on(type: Subscription, handler: LifecycleHandler): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(handler);
    return () => this.off(type, handler);
  }

  off(type: Subscription, handler: LifecycleHandler): void {
    this.handlers.get(type)?.delete(handler);
  }

  /** Deliver an event to its type-specific handlers, then to "*" handlers. */
  emit(event: LifecycleEvent): EmitResult {
    const targets = [
      ...(this.handlers.get(event.type) ?? []),
      ...(this.handlers.get("*") ?? []),
    ];
    const errors: EmitResult["errors"] = [];
    for (const handler of targets) {
      try {
        handler(event);
      } catch (error) {
        errors.push({ handler, error });
      }
    }
    return { delivered: targets.length, errors };
  }

  /** Live handler count for a type (or the grand total when no type is given). */
  listenerCount(type?: Subscription): number {
    if (type) return this.handlers.get(type)?.size ?? 0;
    let n = 0;
    for (const set of this.handlers.values()) n += set.size;
    return n;
  }

  /** Drop every subscription (e.g. on engine shutdown). */
  clear(): void {
    this.handlers.clear();
  }
}

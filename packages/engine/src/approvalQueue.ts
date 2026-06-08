import { classifyTool } from "./approval";
import type { ToolDecision } from "./approval";

// Approval queue (Epic C §3.2). The PreToolUse hook POSTs each tool call here; the queue
// classifies it and returns a final allow/deny. Read-only auto-allows and catastrophic
// auto-denies resolve instantly. An "ask" is enqueued as a pending ApprovalRequest and
// the call HANGS (the hook is waiting) until the user resolves it in the UI — the
// terminal stream is never interrupted. If no one answers within the timeout it resolves
// to the SAFE default (deny) — fail-closed, the locked V2 approval decision.

export type FinalDecision = "allow" | "deny";

export interface ApprovalRequest {
  id: string;
  sessionId: string;
  tool: string;
  input: unknown;
  classified: ToolDecision;
  dangerous: boolean;
  reason: string;
  at: string;
}

export interface ApprovalResult {
  decision: FinalDecision;
  reason: string;
}

export interface SubmitCall {
  sessionId: string;
  tool: string;
  input: unknown;
  repoDir?: string;
}

export interface SubmitOptions {
  /** How long an "ask" waits before failing closed. Default 5 min. */
  timeoutMs?: number;
  /** Injected wall-clock (ms) for a deterministic `at`. */
  now?: number;
  /** Injected id (tests); defaults to a uuid. */
  id?: string;
  /** Called when an "ask" is enqueued (so the server can notify the UI). */
  onEnqueue?: (req: ApprovalRequest) => void;
}

const DEFAULT_TIMEOUT_MS = 5 * 60_000;

interface Pending {
  req: ApprovalRequest;
  settle: (r: ApprovalResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class ApprovalQueue {
  private readonly pending = new Map<string, Pending>();

  /** Classify and resolve a tool call (auto-allow/deny immediately; "ask" waits). */
  submit(call: SubmitCall, opts: SubmitOptions = {}): Promise<ApprovalResult> {
    const c = classifyTool(call.tool, call.input, { repoDir: call.repoDir });

    if (c.decision === "auto-allow") return Promise.resolve({ decision: "allow", reason: c.reason });
    if (c.decision === "auto-deny") return Promise.resolve({ decision: "deny", reason: c.reason });

    const req: ApprovalRequest = {
      id: opts.id ?? crypto.randomUUID(),
      sessionId: call.sessionId,
      tool: call.tool,
      input: call.input,
      classified: c.decision,
      dangerous: c.dangerous,
      reason: c.reason,
      at: new Date(opts.now ?? Date.now()).toISOString(),
    };

    return new Promise<ApprovalResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(req.id);
        resolve({ decision: "deny", reason: "approval timed out — denied (fail-closed)" });
      }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      // Don't let a pending approval keep the process alive.
      (timer as any)?.unref?.();
      this.pending.set(req.id, { req, settle: resolve, timer });
      opts.onEnqueue?.(req);
    });
  }

  /** The approval cards the UI should show right now. */
  list(): ApprovalRequest[] {
    return [...this.pending.values()].map((p) => p.req);
  }

  /** Resolve a pending approval with the user's choice. Returns false if unknown. */
  resolve(id: string, decision: FinalDecision, reason = "decided by user"): boolean {
    const p = this.pending.get(id);
    if (!p) return false;
    clearTimeout(p.timer);
    this.pending.delete(id);
    p.settle({ decision, reason });
    return true;
  }

  /** Deny everything outstanding (e.g. engine shutdown). */
  clear(): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.settle({ decision: "deny", reason: "engine shutting down" });
    }
    this.pending.clear();
  }
}

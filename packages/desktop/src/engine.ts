// Renderer-side client for the @glaudecode/engine sidecar. Gets the {port, token}
// from the Rust core (which spawned the engine) and calls its localhost RPC. This
// is the only path the UI uses to reach Claude Code data.

import { invoke } from "@tauri-apps/api/core";

interface Endpoint {
  port: number;
  token: string;
}

let cached: Endpoint | null = null;

async function endpoint(): Promise<Endpoint> {
  if (!cached) cached = await invoke<Endpoint>("engine_endpoint");
  return cached;
}

export async function engineRpc<T>(method: string, params: Record<string, unknown>): Promise<T> {
  const { port, token } = await endpoint();
  const res = await fetch(`http://127.0.0.1:${port}/rpc`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ method, params }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? `engine rpc ${method} failed (${res.status})`);
  return body.result as T;
}

export interface SessionSummary {
  id: string;
  title?: string;
  firstPrompt?: string;
  summary?: string;
  gitBranch?: string;
  cwd?: string;
  tag?: string;
  lastModified?: string;
}

/** Nearest git repo root at/above the app cwd — the project to list sessions for. */
export const projectDir = () => invoke<string>("project_dir");

export const listSessions = (dir: string) => engineRpc<SessionSummary[]>("listSessions", { dir });

export const renameSession = (id: string, title: string, dir: string) =>
  engineRpc<{ ok: true }>("renameSession", { id, title, dir });

export const tagSession = (id: string, tag: string | null, dir: string) =>
  engineRpc<{ ok: true }>("tagSession", { id, tag, dir });

export const deleteSession = (id: string, dir: string) =>
  engineRpc<{ ok: true }>("deleteSession", { id, dir });

export interface AgentState {
  status: "idle" | "thinking" | "running-tool";
  toolName?: string;
  model?: string;
  sinceMs?: number;
}

/** Computed server-side by the engine (deriveAgentState, tested there). */
export const agentState = (id: string, dir: string) =>
  engineRpc<AgentState>("agentState", { id, dir });

export type TimelineEntry =
  | { kind: "thinking"; id: string; text: string; timestamp?: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      input: unknown;
      status: "pending" | "ok" | "error";
      timestamp?: string;
    };

/** Computed server-side by the engine (buildTimeline, tested there). */
export const timeline = (id: string, dir: string) =>
  engineRpc<TimelineEntry[]>("timeline", { id, dir });

export interface SessionCost {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  usd: number;
  unpricedTokens: number;
}

/** Computed server-side by the engine (computeSessionCost, tested there). */
export const sessionCost = (id: string, dir: string) =>
  engineRpc<SessionCost>("sessionCost", { id, dir });

export interface ContextUsage {
  usedTokens: number;
  limit: number;
  pct: number;
  nearCompaction: boolean;
  model?: string;
}

/** Context-window fullness for a session, or null if the model limit is unknown. */
export const contextUsage = (id: string, dir: string) =>
  engineRpc<ContextUsage | null>("contextUsage", { id, dir });

// ---------- Orchestration (Epic A) ----------

/** Create a worktree on a new branch under <dir>/.glaudecode/worktrees/<branch>. */
export const createWorktree = (dir: string, branch: string) =>
  engineRpc<{ path: string }>("createWorktree", { dir, branch });

export interface ConflictWarning {
  path: string;
  sessionIds: string[];
}

/** Cross-session file conflicts. Each session is read from its own worktree dir. */
export const conflicts = (sessions: Array<{ id: string; dir: string }>) =>
  engineRpc<ConflictWarning[]>("conflicts", { sessions });

/** Build an injectable digest of where a source session left off (§3.5). */
export const handoff = (fromId: string, dir: string) =>
  engineRpc<{ prompt: string }>("handoff", { fromId, dir });

export interface Observation {
  id: string;
  level: "info" | "warn";
  text: string;
  sessionIds: string[];
  at: string;
}

/** Advisory cross-session observations (Epic B §3.3). Caller opts in (off by default). */
export const metaObservations = (sessions: Array<{ id: string; dir: string; title?: string }>) =>
  engineRpc<Observation[]>("metaObservations", { sessions });

// ---------- Smart approval (Epic C §3.2) ----------

export interface ApprovalRequest {
  id: string;
  sessionId: string;
  tool: string;
  input: unknown;
  classified: "auto-allow" | "ask" | "auto-deny";
  dangerous: boolean;
  reason: string;
  at: string;
}

export const pendingApprovals = () => engineRpc<ApprovalRequest[]>("pendingApprovals", {});

export const resolveApproval = (id: string, decision: "allow" | "deny") =>
  engineRpc<{ ok: boolean }>("resolveApproval", { id, decision });

export const installApprovalHook = (dir: string) =>
  engineRpc<{ ok: true }>("installApprovalHook", { dir });

export const uninstallApprovalHook = (dir: string) =>
  engineRpc<{ ok: true }>("uninstallApprovalHook", { dir });

export const approvalHookStatus = (dir: string) =>
  engineRpc<{ installed: boolean }>("approvalHookStatus", { dir });

// ---------- Budgets (Epic C §3.3) ----------

export interface Budget {
  dailyUsd?: number;
  totalUsd?: number;
  warnPct: number;
}

export interface BudgetStatus {
  state: "none" | "ok" | "warn" | "over";
  dailyUsd: number;
  totalUsd: number;
  dailyPct?: number;
  totalPct?: number;
  budget?: Budget;
}

export const budgetStatus = (dir: string, sessions: Array<{ id: string; dir: string }>) =>
  engineRpc<BudgetStatus>("budgetStatus", { dir, sessions });


export const setBudget = (dir: string, budget: Budget) =>
  engineRpc<{ ok: true }>("setBudget", { dir, budget });

export interface ModelSuggestion {
  suggest: "haiku" | null;
  reason: string;
}

/** Cheap-mode suggestion for a session's latest task (Epic C §3.4). Suggestion-first. */
export const modelSuggestion = (id: string, dir: string) =>
  engineRpc<ModelSuggestion>("modelSuggestion", { id, dir });

// ---------- Memory & knowledge (Epic D §3.1) ----------

export interface MemoryFile {
  path: string;
  name: string;
  bytes: number;
}

export const listMemory = (dir: string) => engineRpc<MemoryFile[]>("listMemory", { dir });

export const readMemory = (dir: string, path: string) =>
  engineRpc<{ content: string }>("readMemory", { dir, path });

export const writeMemory = (dir: string, path: string, content: string) =>
  engineRpc<{ ok: true }>("writeMemory", { dir, path, content });

export const readProjectInstructions = (dir: string) =>
  engineRpc<{ path: string; content: string } | null>("readProjectInstructions", { dir });

export const writeProjectInstructions = (dir: string, content: string) =>
  engineRpc<{ path: string }>("writeProjectInstructions", { dir, content });

/** What memory/instructions were actually loaded into a given session. */
export const loadedContext = (id: string, dir: string) =>
  engineRpc<{ instructions?: string }>("loadedContext", { id, dir });

export interface GraphNode {
  id: string;
  label: string;
  kind: string;
}
export interface GraphEdge {
  from: string;
  to: string;
  kind: string;
}
export interface GraphResult {
  available: boolean;
  reason?: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
}

/** Build the project knowledge graph via graphify (degrades if Python/graphify absent). */
export const buildGraph = (dir: string) => engineRpc<GraphResult>("buildGraph", { dir });

export interface SearchHit {
  sessionId: string;
  snippet: string;
  score: number;
  when?: string;
}

/** Full-text search, scoped to a project `dir` when given (Epic D §3.3; V4-B1 scoping). */
export const search = (query: string, dir?: string, limit?: number) =>
  engineRpc<SearchHit[]>("search", { query, dir, limit });

/** (Re)index a project's sessions into the global search index. */
export const reindex = (dir: string) => engineRpc<{ indexed: number }>("reindex", { dir });

// ---------- Git in changes (Epic E §3.2) ----------

export type GitState = "modified" | "staged" | "untracked" | "deleted";

export interface GitChangeFile {
  path: string;
  rel: string;
  edits: number;
  lastTool: string;
  gitState: GitState | null;
}

export interface SessionChangesGit {
  isRepo: boolean;
  files: GitChangeFile[];
}

export const sessionChangesGit = (id: string, dir: string) =>
  engineRpc<SessionChangesGit>("sessionChangesGit", { id, dir });

export const gitStage = (dir: string, paths: string[]) =>
  engineRpc<{ ok: true }>("gitStage", { dir, paths });

export const gitCommit = (dir: string, message: string) =>
  engineRpc<{ output: string }>("gitCommit", { dir, message });

export interface FileDiff {
  path: string;
  hunks: { header: string; lines: string[] }[];
}

export const gitDiff = (dir: string, path: string) => engineRpc<FileDiff[]>("gitDiff", { dir, path });

export const gitRestore = (dir: string, paths: string[]) =>
  engineRpc<{ ok: true }>("gitRestore", { dir, paths });

/** Revert a single hunk to HEAD (refuses on conflict; Epic E §3.3). */
export const gitRevertHunk = (dir: string, path: string, hunk: { header: string; lines: string[] }) =>
  engineRpc<{ ok: true }>("gitRevertHunk", { dir, path, hunk });

// ---------- Session compare (Epic E §3.4) ----------

export interface SetDiff {
  onlyA: string[];
  onlyB: string[];
  both: string[];
}

export interface SessionComparison {
  a: string;
  b: string;
  tools: SetDiff;
  files: SetDiff;
  costDeltaUsd: number;
  tokenDelta: number;
}

export const compareSessions = (a: { id: string; dir: string }, b: { id: string; dir: string }) =>
  engineRpc<SessionComparison>("compareSessions", { a, b });

export interface ResumeBriefing {
  recap: string;
  suggestedNext: string;
}

/** A short recap + suggested next step for reopening a session (Epic E §3.5). */
export const resumeBriefing = (id: string, dir: string) =>
  engineRpc<ResumeBriefing>("resumeBriefing", { id, dir });

export interface ReplayEntry {
  id: string;
  role: string;
  blocks: Array<{ kind: string; text?: string; name?: string }>;
}
export interface ReplayBundle {
  version: 1;
  sessionId: string;
  entries: ReplayEntry[];
  meta: Record<string, unknown>;
  redacted: boolean;
}

/** Build a portable replay bundle (redacted by default; Epic E §3.6). */
export const buildReplay = (id: string, dir: string, redact = true) =>
  engineRpc<ReplayBundle>("buildReplay", { id, dir, redact });

// ---------- Bookmarks (Epic E §3.7) ----------

export interface Bookmark {
  sessionId: string;
  messageId: string;
  note?: string;
  at: string;
}

export const listBookmarks = (sessionId: string) =>
  engineRpc<Bookmark[]>("listBookmarks", { sessionId });

export const addBookmark = (sessionId: string, messageId: string, note?: string) =>
  engineRpc<Bookmark[]>("addBookmark", { sessionId, messageId, note });

export const removeBookmark = (sessionId: string, messageId: string) =>
  engineRpc<Bookmark[]>("removeBookmark", { sessionId, messageId });

// ---------- Keybindings (Epic F §3.2) ----------

export interface Keybinding {
  command: string;
  keys: string;
}
export interface Keymap {
  bindings: Keybinding[];
  conflicts: Array<{ keys: string; commands: string[] }>;
}

export const getKeybindings = () => engineRpc<Keymap>("getKeybindings", {});

export const setKeybinding = (command: string, keys: string | null) =>
  engineRpc<Keymap>("setKeybinding", { command, keys });

export const resetKeybindings = () => engineRpc<Keymap>("resetKeybindings", {});

// ---------- Prompt library + slash commands (Epic F §3.3) ----------

export interface PromptInfo {
  id: string;
  name: string;
  variables: string[];
}

export const listPrompts = () => engineRpc<PromptInfo[]>("listPrompts", {});
export const readPrompt = (id: string) => engineRpc<{ body: string }>("readPrompt", { id });
export const savePrompt = (id: string, body: string) => engineRpc<{ id: string }>("savePrompt", { id, body });
export const deletePrompt = (id: string) => engineRpc<{ ok: true }>("deletePrompt", { id });

export const buildSlashCommand = (dir: string, name: string, body: string) =>
  engineRpc<{ command: string }>("buildSlashCommand", { dir, name, body });

// ---------- Pairing / remote cockpit (Epic G §3.2) ----------

// "terminal" is the RCE-class scope (type into armed panes); never implied by steer (V5 Phase 2).
export type TokenScope = "view" | "steer" | "terminal";
export interface PairCode {
  code: string;
  scope: TokenScope;
  expiresAt: string;
}
export interface PairedDevice {
  id: string;
  name: string;
  scope: TokenScope;
  pairedAt: string;
  expiresAt: string;
  lastSeen?: string;
}

export const createPairCode = (scope: TokenScope) => engineRpc<PairCode>("createPairCode", { scope });
export const listDevices = () => engineRpc<PairedDevice[]>("listDevices", {});
export const revokeDevice = (deviceId: string) => engineRpc<{ ok: boolean }>("revokeDevice", { deviceId });

/** State of the engine's optional remote (Tailscale) listener (Epic G remote). */
export interface RemoteInfo {
  enabled: boolean;
  hostname: string | null;
  port: number;
  url: string | null;
}
export const enableRemote = (hostname: string) => engineRpc<RemoteInfo>("enableRemote", { hostname });
export const disableRemote = () => engineRpc<RemoteInfo>("disableRemote", {});
export const remoteStatus = () => engineRpc<RemoteInfo>("remoteStatus", {});

/** The engine's localhost endpoint (port + token), for building the cockpit URL. */
export const engineEndpoint = () => invoke<{ port: number; token: string }>("engine_endpoint");

// ---------- Remote terminal input arming (V5 Phase 2) ----------
// Per-pane opt-in for phone keystrokes. Default OFF; the Rust core is the authoritative gate.

/** Arm / disarm a single pane for remote (phone) input. */
export const setPaneArmed = (paneId: string, armed: boolean) =>
  invoke<void>("pty_set_armed", { paneId, armed });
/** Kill switch: disarm every pane at once; returns the pane ids that were armed. */
export const disarmAllPanes = () => invoke<string[]>("pty_disarm_all", {});

// Frontend mirror of @glaudecode/engine's filterSessions. Behavior is verified by
// that package's tests (test/filter.test.ts); kept in sync deliberately rather than
// importing the engine package (which pulls the Node-only Agent SDK) into the bundle.
export function filterSessions(sessions: SessionSummary[], query: string): SessionSummary[] {
  const q = query.trim().toLowerCase();
  if (!q) return sessions;
  const terms = q.split(/\s+/);
  return sessions.filter((s) => {
    const haystack = [s.title, s.firstPrompt, s.summary, s.gitBranch, s.tag, s.cwd]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return terms.every((t) => haystack.includes(t));
  });
}

import type { SessionMessage } from "./types";

// The files an agent touched this session. Interactive Claude Code sessions don't
// expose file-history snapshots through getSessionMessages, so we derive changes
// from the file-writing tool calls in the message stream. Pure and tested; exposed
// via the "sessionChanges" RPC.

export interface ChangeEntry {
  path: string;
  edits: number;
  lastTool: string;
}

// Tool name -> the input field holding the target path.
const FILE_TOOLS: Record<string, string> = {
  Write: "file_path",
  Edit: "file_path",
  MultiEdit: "file_path",
  NotebookEdit: "notebook_path",
};

export function buildChanges(messages: SessionMessage[]): ChangeEntry[] {
  const map = new Map<string, { edits: number; order: number; lastTool: string }>();
  let order = 0;

  for (const m of messages) {
    for (const b of m.blocks) {
      if (b.kind !== "tool_use") continue;
      const field = FILE_TOOLS[b.name];
      if (!field) continue;
      const path = (b.input as Record<string, unknown> | undefined)?.[field];
      if (typeof path !== "string" || !path) continue;

      const cur = map.get(path);
      if (cur) {
        cur.edits++;
        cur.order = order;
        cur.lastTool = b.name;
      } else {
        map.set(path, { edits: 1, order, lastTool: b.name });
      }
      order++;
    }
  }

  return [...map.entries()]
    .sort((a, b) => b[1].order - a[1].order) // most-recently-touched first
    .map(([path, v]) => ({ path, edits: v.edits, lastTool: v.lastTool }));
}

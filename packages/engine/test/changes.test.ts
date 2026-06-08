import { describe, expect, test } from "bun:test";
import { buildChanges } from "../src/changes";
import type { SessionMessage } from "../src/types";

function m(blocks: SessionMessage["blocks"]): SessionMessage {
  return { id: "m", role: "assistant", blocks };
}

describe("buildChanges", () => {
  test("collects file paths from Write/Edit/MultiEdit/NotebookEdit", () => {
    const changes = buildChanges([
      m([{ kind: "tool_use", name: "Write", input: { file_path: "/a.ts" } }]),
      m([{ kind: "tool_use", name: "Edit", input: { file_path: "/b.ts" } }]),
      m([{ kind: "tool_use", name: "NotebookEdit", input: { notebook_path: "/n.ipynb" } }]),
    ]);
    expect(changes.map((c) => c.path).sort()).toEqual(["/a.ts", "/b.ts", "/n.ipynb"]);
  });

  test("counts repeated edits to the same file and tracks last tool", () => {
    const changes = buildChanges([
      m([{ kind: "tool_use", name: "Write", input: { file_path: "/a.ts" } }]),
      m([{ kind: "tool_use", name: "Edit", input: { file_path: "/a.ts" } }]),
      m([{ kind: "tool_use", name: "Edit", input: { file_path: "/a.ts" } }]),
    ]);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ path: "/a.ts", edits: 3, lastTool: "Edit" });
  });

  test("most-recently-touched file comes first", () => {
    const changes = buildChanges([
      m([{ kind: "tool_use", name: "Write", input: { file_path: "/old.ts" } }]),
      m([{ kind: "tool_use", name: "Write", input: { file_path: "/new.ts" } }]),
    ]);
    expect(changes.map((c) => c.path)).toEqual(["/new.ts", "/old.ts"]);
  });

  test("ignores non-file tools and missing paths", () => {
    const changes = buildChanges([
      m([{ kind: "tool_use", name: "Bash", input: { command: "ls" } }]),
      m([{ kind: "tool_use", name: "Write", input: {} }]),
      m([{ kind: "text", text: "hi" }]),
    ]);
    expect(changes).toEqual([]);
  });
});

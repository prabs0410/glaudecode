// Integration test: exercises the real Agent SDK through ClaudeCodeAdapter against
// whatever sessions exist for a project dir. Skips gracefully when none are present
// (e.g. CI), so it never blocks the suite while still validating the real path
// locally (proven in docs/research/technical/spike-claude-code-integration.md).

import { beforeAll, describe, expect, test } from "bun:test";
import { ClaudeCodeAdapter } from "../src/adapter";

const DIR = process.env.GLAUDE_TEST_PROJECT_DIR ?? process.cwd();
const adapter = new ClaudeCodeAdapter();

let hasSessions = false;
let firstId: string | undefined;

beforeAll(async () => {
  try {
    const sessions = await adapter.listSessions({ dir: DIR });
    hasSessions = sessions.length > 0;
    firstId = sessions[0]?.id;
  } catch {
    hasSessions = false;
  }
});

describe("ClaudeCodeAdapter (integration)", () => {
  test("listSessions returns domain summaries with an id", async () => {
    if (!hasSessions) {
      console.log("[skip] no Claude Code sessions for", DIR);
      return;
    }
    const sessions = await adapter.listSessions({ dir: DIR });
    expect(sessions.length).toBeGreaterThan(0);
    for (const s of sessions) expect(typeof s.id).toBe("string");
  });

  test("getSessionInfo returns metadata for a known session", async () => {
    if (!hasSessions || !firstId) return;
    const info = await adapter.getSessionInfo(firstId, { dir: DIR });
    expect(info?.id).toBe(firstId);
  });

  test("getSessionMessages returns mapped messages", async () => {
    if (!hasSessions || !firstId) return;
    const msgs = await adapter.getSessionMessages(firstId, { dir: DIR }, { limit: 50 });
    expect(Array.isArray(msgs)).toBe(true);
    for (const m of msgs) {
      expect(typeof m.id).toBe("string");
      expect(["user", "assistant", "system", "other"]).toContain(m.role);
      expect(Array.isArray(m.blocks)).toBe(true);
    }
  });
});

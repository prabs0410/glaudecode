import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BookmarkStore } from "../src/bookmarks";

const tmpDirs: string[] = [];
afterAll(async () => {
  for (const d of tmpDirs) await rm(d, { recursive: true, force: true });
});

async function store() {
  const home = await mkdtemp(join(tmpdir(), "glaude-bm-"));
  tmpDirs.push(home);
  return new BookmarkStore(home);
}

describe("BookmarkStore", () => {
  test("add, list, remove", async () => {
    const s = await store();
    expect(await s.list("sess1")).toEqual([]);

    await s.add("sess1", "m1", "key moment", "2026-06-09T00:00:00Z");
    await s.add("sess1", "m2", undefined, "2026-06-09T00:01:00Z");
    const list = await s.list("sess1");
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ messageId: "m1", note: "key moment" });

    await s.remove("sess1", "m1");
    expect((await s.list("sess1")).map((b) => b.messageId)).toEqual(["m2"]);
  });

  test("add is idempotent per messageId", async () => {
    const s = await store();
    await s.add("sess1", "m1", "a", "t");
    await s.add("sess1", "m1", "b", "t");
    const list = await s.list("sess1");
    expect(list).toHaveLength(1);
    expect(list[0].note).toBe("a"); // first wins, not duplicated
  });

  test("prune removes all of a session's bookmarks", async () => {
    const s = await store();
    await s.add("sess1", "m1", undefined, "t");
    await s.prune("sess1");
    expect(await s.list("sess1")).toEqual([]);
  });

  test("bookmarks are isolated per session", async () => {
    const s = await store();
    await s.add("a", "m1", undefined, "t");
    await s.add("b", "m2", undefined, "t");
    expect(await s.list("a")).toHaveLength(1);
    expect((await s.list("b"))[0].messageId).toBe("m2");
  });
});

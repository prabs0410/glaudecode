import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PromptStore, SlashCommandWriter, extractVariables, fillTemplate } from "../src/prompt";

describe("extractVariables / fillTemplate", () => {
  test("extracts unique variables in order", () => {
    expect(extractVariables("Refactor {{file}} for {{goal}}, keep {{file}} tests")).toEqual(["file", "goal"]);
  });

  test("fills provided values and reports missing", () => {
    const { text, missing } = fillTemplate("do {{a}} then {{b}}", { a: "X" });
    expect(text).toBe("do X then {{b}}");
    expect(missing).toEqual(["b"]);
  });

  test("no variables → unchanged, no missing", () => {
    expect(fillTemplate("plain text", {})).toEqual({ text: "plain text", missing: [] });
  });
});

const tmpDirs: string[] = [];
afterAll(async () => {
  for (const d of tmpDirs) await rm(d, { recursive: true, force: true });
});

describe("PromptStore", () => {
  test("save, list (with variables), read, remove", async () => {
    const home = await mkdtemp(join(tmpdir(), "glaude-prompt-"));
    tmpDirs.push(home);
    const store = new PromptStore(home);
    expect(await store.list()).toEqual([]);

    await store.save("review", "Review {{file}} carefully");
    const list = await store.list();
    expect(list).toEqual([{ id: "review", name: "review", variables: ["file"] }]);
    expect(await store.read("review")).toBe("Review {{file}} carefully");

    await store.remove("review");
    expect(await store.list()).toEqual([]);
  });
});

describe("SlashCommandWriter", () => {
  test("writes a command and refuses to overwrite", async () => {
    const repo = await mkdtemp(join(tmpdir(), "glaude-slash-"));
    tmpDirs.push(repo);
    const w = new SlashCommandWriter();
    const cmd = await w.write(repo, "ship-it", "Run tests then commit.");
    expect(cmd).toBe("/ship-it");
    expect(await w.list(repo)).toEqual(["ship-it"]);
    await expect(w.write(repo, "ship-it", "other")).rejects.toThrow(/already exists/);
  });
});

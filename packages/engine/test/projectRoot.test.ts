import { describe, expect, test } from "bun:test";
import { findProjectRoot } from "../src/projectRoot";

describe("findProjectRoot (mirror of the desktop's .git walk)", () => {
  test("returns the cwd when it directly contains .git", () => {
    const exists = (p: string) => p === "/repo/.git";
    expect(findProjectRoot("/repo", exists)).toBe("/repo");
  });

  test("walks UP to the nearest ancestor with .git (the tauri-dev subdir case)", () => {
    const exists = (p: string) => p === "/repo/.git";
    expect(findProjectRoot("/repo/packages/desktop/src-tauri", exists)).toBe("/repo");
  });

  test("falls back to the cwd when no .git is found up to the filesystem root", () => {
    const exists = () => false;
    expect(findProjectRoot("/some/where/deep", exists)).toBe("/some/where/deep");
  });

  test("picks the CLOSEST .git when nested repos exist", () => {
    const exists = (p: string) => p === "/repo/.git" || p === "/repo/sub/.git";
    expect(findProjectRoot("/repo/sub/pkg", exists)).toBe("/repo/sub");
  });
});

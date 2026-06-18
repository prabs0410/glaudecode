// The "project root" the phone surfaces (cockpit + conversation view) should target — the SAME
// project the user runs `claude` in. The engine's raw process.cwd() is the app's launch dir, which
// under `tauri dev` is often a subdir (packages/desktop/src-tauri), so listing sessions there finds
// nothing. Mirror the desktop's find_project_dir: walk up to the nearest ancestor containing `.git`,
// else fall back to the cwd. `exists` is injected so the walk is pure + unit-testable.

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export function findProjectRoot(cwd: string, exists: (p: string) => boolean = existsSync): string {
  let dir = cwd;
  for (;;) {
    if (exists(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return cwd; // reached the filesystem root with no .git → the cwd itself
    dir = parent;
  }
}

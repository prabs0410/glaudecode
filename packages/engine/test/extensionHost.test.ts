import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventBus } from "../src/eventBus";
import {
  ExtensionHost,
  defaultExtensionDirs,
  type ExtensionImporter,
  type ExtensionModule,
} from "../src/extensionHost";

// Build a host whose importer serves modules from an in-memory map keyed by path.
function hostWithModules(modules: Record<string, ExtensionModule>) {
  const bus = new EventBus();
  const logs: Array<{ ext: string; args: unknown[] }> = [];
  const importer: ExtensionImporter = async (path) => {
    const mod = modules[path];
    if (!mod) throw new Error(`not found: ${path}`);
    return mod;
  };
  const host = new ExtensionHost(bus, { importer, logger: (ext, args) => logs.push({ ext, args }) });
  return { bus, host, logs };
}

const tmpDirs: string[] = [];
afterAll(async () => {
  for (const d of tmpDirs) await rm(d, { recursive: true, force: true });
});

describe("ExtensionHost.load", () => {
  test("calls register and records commands + subscriptions", async () => {
    const { host, bus } = hostWithModules({
      "/ext/a.ts": {
        register(api) {
          api.on("session_start", () => {});
          api.registerCommand("a.hello", () => "hi");
        },
      },
    });
    const res = await host.load("/ext/a.ts");
    expect(res).toMatchObject({ name: "a", ok: true, commands: ["a.hello"], subscriptions: 1 });
    expect(host.listCommands()).toEqual(["a.hello"]);
    expect(host.runCommand("a.hello")).toBe("hi");
    expect(bus.listenerCount("session_start")).toBe(1);
  });

  test("a subscribed handler fires on real events", async () => {
    const seen: string[] = [];
    const { host, bus } = hostWithModules({
      "/ext/log.ts": {
        register(api) {
          api.on("session_start", (e) => seen.push(e.sessionId));
        },
      },
    });
    await host.load("/ext/log.ts");
    bus.emit({ type: "session_start", sessionId: "s9", reason: "new" });
    expect(seen).toEqual(["s9"]);
  });

  test("module without register() is reported, not thrown", async () => {
    const { host } = hostWithModules({ "/ext/bad.ts": {} });
    const res = await host.load("/ext/bad.ts");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no register/);
  });

  test("an extension throwing in register is isolated and rolled back", async () => {
    const { host, bus } = hostWithModules({
      "/ext/boom.ts": {
        register(api) {
          api.registerCommand("boom.cmd", () => 1);
          throw new Error("kaboom");
        },
      },
    });
    const res = await host.load("/ext/boom.ts");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/kaboom/);
    // partial registration rolled back
    expect(host.listCommands()).toEqual([]);
    // the bus subscription it made before throwing... it made none here
    expect(bus.listenerCount()).toBe(0);
  });

  test("one bad extension does not stop the others (loadAll-style)", async () => {
    const { host } = hostWithModules({
      "/ext/good.ts": { register: (api) => api.registerCommand("g", () => "g") },
      "/ext/bad.ts": {},
    });
    const a = await host.load("/ext/good.ts");
    const b = await host.load("/ext/bad.ts");
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(false);
    expect(host.listCommands()).toEqual(["g"]);
  });

  test("duplicate command id fails the second extension only", async () => {
    const { host } = hostWithModules({
      "/ext/one.ts": { register: (api) => api.registerCommand("dup", () => 1) },
      "/ext/two.ts": { register: (api) => api.registerCommand("dup", () => 2) },
    });
    expect((await host.load("/ext/one.ts")).ok).toBe(true);
    const two = await host.load("/ext/two.ts");
    expect(two.ok).toBe(false);
    expect(two.error).toMatch(/already registered/);
    expect(host.runCommand("dup")).toBe(1); // first one still wins
  });

  test("dispose unsubscribes handlers and clears commands", async () => {
    const { host, bus } = hostWithModules({
      "/ext/d.ts": {
        register(api) {
          api.on("session_shutdown", () => {});
          api.registerCommand("d.cmd", () => 1);
        },
      },
    });
    await host.load("/ext/d.ts");
    expect(bus.listenerCount()).toBe(1);
    host.dispose();
    expect(bus.listenerCount()).toBe(0);
    expect(host.listCommands()).toEqual([]);
  });

  test("runCommand throws on unknown id", () => {
    const { host } = hostWithModules({});
    expect(() => host.runCommand("nope")).toThrow(/no such command/);
  });
});

describe("ExtensionHost.discover", () => {
  test("finds *.ts across dirs, sorted, skipping .d.ts and missing dirs", async () => {
    const root = await mkdtemp(join(tmpdir(), "glaude-ext-"));
    tmpDirs.push(root);
    const dir = join(root, "extensions");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "b.ts"), "export const register = () => {}");
    await writeFile(join(dir, "a.ts"), "export const register = () => {}");
    await writeFile(join(dir, "types.d.ts"), "export {}");
    await writeFile(join(dir, "readme.md"), "# not an extension");

    const { host } = hostWithModules({});
    const found = await host.discover([dir, join(root, "does-not-exist")]);
    expect(found).toEqual([join(dir, "a.ts"), join(dir, "b.ts")]);
  });

  test("defaultExtensionDirs is user-global then repo-local", () => {
    expect(defaultExtensionDirs("/home/u", "/repo")).toEqual([
      "/home/u/.glaudecode/extensions",
      "/repo/.glaudecode/extensions",
    ]);
  });
});

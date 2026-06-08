// ExtensionHost (Epic B §3.2). Discovers user/repo `.ts` extensions and loads them
// via jiti (no build step — ADR 0002). Each extension exports `register(api)` and
// uses the narrow ExtensionApi to subscribe to lifecycle events, register commands,
// and log. Failures are isolated: a bad extension disables itself and surfaces an
// error; it never crashes the engine (§5).
//
// SECURITY (§6): V2 extensions are TRUSTED code — they run in-sidecar with full
// privileges, like a shell rc file. No registry, no remote fetch (removes the
// supply-chain vector). The API surface is intentionally narrow and message-shaped so
// a future move to Worker isolation (a pre-1.0 gate) won't change extension code.

import { readdir } from "node:fs/promises";
import { join, basename } from "node:path";
import type { EventBus, LifecycleHandler, Subscription } from "./eventBus";

export type CommandFn = (...args: unknown[]) => unknown;

/** The capability surface handed to each extension's register(). Deliberately small. */
export interface ExtensionApi {
  /** Subscribe to a lifecycle event (or "*"). */
  on(type: Subscription, handler: LifecycleHandler): void;
  /** Register a named command other parts of the app (or a palette) can invoke. */
  registerCommand(id: string, fn: CommandFn): void;
  /** Structured log routed through the host (prefixed with the extension name). */
  log(...args: unknown[]): void;
}

export interface ExtensionModule {
  register?: (api: ExtensionApi) => void;
}

export interface LoadedExtension {
  path: string;
  name: string;
  ok: boolean;
  error?: string;
  commands: string[];
  subscriptions: number;
}

export type ExtensionImporter = (path: string) => Promise<ExtensionModule>;

export interface ExtensionHostOptions {
  /** Injectable for tests; defaults to jiti (loads .ts with no build step). */
  importer?: ExtensionImporter;
  /** Sink for extension logs; defaults to console with an [ext:name] prefix. */
  logger?: (extName: string, args: unknown[]) => void;
}

export class ExtensionHost {
  private readonly commands = new Map<string, { ext: string; fn: CommandFn }>();
  private readonly disposers: Array<() => void> = [];
  private readonly importer: ExtensionImporter;
  private readonly logger: (extName: string, args: unknown[]) => void;

  constructor(
    private readonly bus: EventBus,
    opts: ExtensionHostOptions = {},
  ) {
    this.importer = opts.importer ?? defaultJitiImporter;
    this.logger = opts.logger ?? ((ext, args) => console.log(`[ext:${ext}]`, ...args));
  }

  /** List `*.ts` extension files across the given dirs (missing dirs are skipped). */
  async discover(dirs: string[]): Promise<string[]> {
    const found: string[] = [];
    for (const dir of dirs) {
      let entries: string[];
      try {
        entries = await readdir(dir);
      } catch {
        continue; // dir doesn't exist — fine
      }
      for (const name of entries.sort()) {
        if (name.endsWith(".ts") && !name.endsWith(".d.ts")) found.push(join(dir, name));
      }
    }
    return found;
  }

  /** Discover and load every extension under the given dirs. */
  async loadAll(dirs: string[]): Promise<LoadedExtension[]> {
    const files = await this.discover(dirs);
    const loaded: LoadedExtension[] = [];
    for (const file of files) loaded.push(await this.load(file));
    return loaded;
  }

  /** Load one extension, isolating any failure into the returned record. */
  async load(path: string): Promise<LoadedExtension> {
    const name = basename(path).replace(/\.ts$/, "");
    const commands: string[] = [];
    let subscriptions = 0;

    const api: ExtensionApi = {
      on: (type, handler) => {
        this.disposers.push(this.bus.on(type, handler));
        subscriptions++;
      },
      registerCommand: (id, fn) => {
        if (this.commands.has(id)) throw new Error(`command already registered: ${id}`);
        this.commands.set(id, { ext: name, fn });
        commands.push(id);
      },
      log: (...args) => this.logger(name, args),
    };

    try {
      const mod = await this.importer(path);
      if (typeof mod.register !== "function") {
        return { path, name, ok: false, error: "extension has no register(api) export", commands: [], subscriptions: 0 };
      }
      mod.register(api);
      return { path, name, ok: true, commands, subscriptions };
    } catch (e: any) {
      // Roll back anything this extension partially registered so a half-loaded
      // extension can't leave dangling commands behind.
      for (const id of commands) this.commands.delete(id);
      return { path, name, ok: false, error: String(e?.message ?? e), commands: [], subscriptions };
    }
  }

  /** Invoke a registered command by id. Throws if unknown. */
  runCommand(id: string, ...args: unknown[]): unknown {
    const cmd = this.commands.get(id);
    if (!cmd) throw new Error(`no such command: ${id}`);
    return cmd.fn(...args);
  }

  listCommands(): string[] {
    return [...this.commands.keys()].sort();
  }

  /** Unsubscribe every handler and drop every command (engine shutdown). */
  dispose(): void {
    for (const off of this.disposers) off();
    this.disposers.length = 0;
    this.commands.clear();
  }
}

/** Default importer: jiti loads `.ts` with no build step (ADR 0002). Lazy so unit
 *  tests that inject their own importer never pull jiti in. */
const defaultJitiImporter: ExtensionImporter = async (path) => {
  const { createJiti } = await import("jiti");
  const jiti = createJiti(import.meta.url);
  return (await jiti.import(path)) as ExtensionModule;
};

/** Default extension search paths: user-global then repo-local (§3.2). */
export function defaultExtensionDirs(home: string, repoDir: string): string[] {
  return [join(home, ".glaudecode", "extensions"), join(repoDir, ".glaudecode", "extensions")];
}

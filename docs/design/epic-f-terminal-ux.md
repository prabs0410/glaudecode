# Epic F — Terminal UX

**Status:** Draft for review
**Depends on:** V1 shell; Epic D (palette ties to global search); Epic C (notifications carry alerts)
**Features:** command palette, keybindings, prompt library + slash-command builder, desktop notifications

## 1. Problem & user value
The "terminal you live in" polish. A command palette and configurable keybindings make GlaudeCode
keyboard-driven; a prompt library + slash-command builder make repeated work reusable; desktop
notifications are what actually let you walk away (told when a session finishes, needs approval,
errors, or hits budget).

**Felt-improvement test:** desktop notifications + prompt/slash-command building lean into the
"walk away" and "make it yours" wedges. Palette/keybindings are table-stakes polish done well.

## 2. Research / constraints
- **Desktop notifications:** Tauri's official `@tauri-apps/plugin-notification` provides native OS
  notifications + permission flow. Add the plugin + a capability. (No PTY/web hacks needed.)
- **Slash commands:** Claude Code reads custom slash commands from `.claude/commands/*.md`. A
  "slash-command builder" writes there (merge-safe), so built commands work in the real `claude`.
- **Prompt insertion:** a saved prompt is inserted by writing to the active pane's PTY (`pty_write`),
  exactly like typing — no special integration.
- **Notifications must be debounced** — a chatty agent shouldn't spam the OS; coalesce + respect a
  user "quiet" toggle.

## 3. Architecture
### 3.1 Command palette (UI + command registry)
A central `CommandRegistry` (frontend) of app actions (new session, switch pane, open memory, search,
toggle dock, run a saved prompt, …). Cmd-K opens a fuzzy finder over it; global search results
(Epic D) appear inline. Extensions (Epic B) can register commands here.

### 3.2 Keybindings
A default keymap + user overrides at `~/.glaudecode/keybindings.json` (engine reads/writes). A
settings UI to rebind. Conflicts surfaced. Keep terminal keys (sent to PTY) distinct from app keys.

### 3.3 Prompt library + slash-command builder
- Prompts stored at `~/.glaudecode/prompts/*.md` with optional `{{variables}}`; engine CRUD + search.
- "Use prompt" fills variables then `pty_write`s into the active pane.
- Slash-command builder writes `.claude/commands/<name>.md` (merge-safe, recorded for clean removal),
  so the command is available to `claude` itself.

### 3.4 Desktop notifications (engine events → Rust plugin)
- The EventBus (Epic B) emits notable events: `session_finished`, `approval_needed` (Epic C),
  `session_error`, `budget_threshold` (Epic C).
- A NotificationService (frontend) subscribes, debounces/coalesces, respects quiet mode, and calls the
  Tauri notification plugin. Clicking a notification focuses the relevant session/pane.

## 4. Data model
```ts
interface Command { id: string; title: string; run: () => void | Promise<void>; keywords?: string[] }
interface Keybinding { command: string; keys: string }   // e.g. "mod+k"
interface PromptTemplate { id: string; name: string; body: string; variables: string[] }
interface AppNotification { kind: "finished"|"approval"|"error"|"budget"; sessionId?: string; text: string }
```

## 5. Edge cases & failure modes
- **Notification permission denied** → degrade to an in-app toast; never error.
- **Keybinding conflict / capturing a terminal key** → validate and warn; protect core terminal keys.
- **Slash-command name collision** with an existing `.claude/commands` file → warn, don't overwrite.
- **Prompt with unfilled variables** → block insertion until filled.
- **Notification storms** → coalesce (e.g. "3 sessions finished") + rate-limit.

## 6. Security
- `~/.glaudecode/*` and `.claude/commands/*` writes are scoped + recorded (reversible).
- Notifications carry no secret content (titles/short text only).

## 7. Test plan
- **Unit (pure):** fuzzy-match ranking for the palette; keymap parse/conflict detection; prompt
  variable extraction/fill; notification coalescing/debounce logic.
- **Integration:** prompt + keybinding + slash-command file CRUD round-trips.
- **Manual:** palette UX, native notification firing + click-to-focus, rebinding.

## 8. Acceptance criteria
- Cmd-K palette runs core actions and surfaces search results; extensions can add commands.
- Rebind a key; binding persists and applies; terminal keys protected.
- Save a templated prompt and insert it into a session; build a custom slash command usable by `claude`.
- Get a native desktop notification when a session finishes / needs approval / errors / hits budget;
  clicking focuses the session; quiet mode + coalescing work.

## 9. Open questions (for review)
1. **Keymap source of truth** — JSON file only, or a settings UI in V2 too? Recommend: file + minimal UI.
2. **Notification backend** — Tauri plugin only, or also in-app toasts as fallback? Recommend: both.
3. **Prompt/slash-command sharing** — local only for V2 (no registry), matching Epic B's no-supply-chain stance.

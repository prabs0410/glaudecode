import { useEffect, useMemo, useState } from "react";
import {
  buildSlashCommand,
  deletePrompt,
  listPrompts,
  readPrompt,
  savePrompt,
  type PromptInfo,
} from "./engine";

// Prompt library + slash-command builder (Epic F §3.3). Create reusable prompts with
// {{variables}}; "Use" fills them and types the prompt into the active pane. "Make slash
// command" writes .claude/commands/<name>.md so it works in the real `claude`.

const VAR_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
function fill(body: string, values: Record<string, string>): { text: string; missing: string[] } {
  const missing: string[] = [];
  const text = body.replace(VAR_RE, (_, n: string) => {
    const v = values[n];
    if (!v) {
      if (!missing.includes(n)) missing.push(n);
      return `{{${n}}}`;
    }
    return v;
  });
  return { text, missing };
}
function vars(body: string): string[] {
  const s = new Set<string>();
  for (const m of body.matchAll(VAR_RE)) s.add(m[1]);
  return [...s];
}

interface Props {
  dir: string | null;
  onClose: () => void;
  onInsert: (text: string) => void;
}

export function PromptsModal({ dir, onClose, onInsert }: Props) {
  const [prompts, setPrompts] = useState<PromptInfo[]>([]);
  const [id, setId] = useState("");
  const [body, setBody] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<string | null>(null);

  const reload = () => listPrompts().then(setPrompts).catch(() => setPrompts([]));
  useEffect(() => {
    void reload();
  }, []);

  const open = async (pid: string) => {
    setId(pid);
    setValues({});
    try {
      setBody((await readPrompt(pid)).body);
    } catch {
      setBody("");
    }
  };

  const variables = useMemo(() => vars(body), [body]);

  const save = async () => {
    if (!id.trim()) return;
    await savePrompt(id.trim(), body);
    setStatus(`Saved ${id.trim()}`);
    await reload();
  };

  const use = () => {
    const { text, missing } = fill(body, values);
    if (missing.length) {
      setStatus(`Fill: ${missing.join(", ")}`);
      return;
    }
    onInsert(text);
    onClose();
  };

  const makeSlash = async () => {
    if (!dir || !id.trim()) return;
    const name = prompt("Slash command name (used as /name):", id.trim());
    if (!name) return;
    try {
      const { command } = await buildSlashCommand(dir, name, body);
      setStatus(`Created ${command} in .claude/commands`);
    } catch (e: any) {
      setStatus(String(e?.message ?? e));
    }
  };

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="prompts-modal" onClick={(e) => e.stopPropagation()}>
        <div className="prompts-cols">
          <div className="prompts-list">
            <button
              className="act"
              onClick={() => {
                setId("");
                setBody("");
                setValues({});
              }}
            >
              + New
            </button>
            {prompts.map((p) => (
              <div
                key={p.id}
                className={`prompts-item${p.id === id ? " active" : ""}`}
                onClick={() => void open(p.id)}
              >
                {p.name}
                {p.variables.length > 0 && <span className="prompts-varcount">{p.variables.length}</span>}
              </div>
            ))}
          </div>

          <div className="prompts-edit">
            <input
              className="commit-input"
              placeholder="prompt id (filename)"
              value={id}
              onChange={(e) => setId(e.currentTarget.value)}
            />
            <textarea
              className="memory-editor"
              placeholder="Prompt body — use {{variables}}"
              value={body}
              spellCheck={false}
              onChange={(e) => setBody(e.currentTarget.value)}
            />

            {variables.length > 0 && (
              <div className="prompts-vars">
                {variables.map((v) => (
                  <input
                    key={v}
                    className="commit-input"
                    placeholder={v}
                    value={values[v] ?? ""}
                    onChange={(e) => setValues((vs) => ({ ...vs, [v]: e.currentTarget.value }))}
                  />
                ))}
              </div>
            )}

            <div className="prompts-actions">
              <button className="act" disabled={!id.trim()} onClick={() => void save()}>
                Save
              </button>
              <button className="act" disabled={!body} onClick={use}>
                Use → pane
              </button>
              <button className="act" disabled={!dir || !id.trim()} onClick={() => void makeSlash()}>
                Make /command
              </button>
              {id && (
                <button
                  className="act danger"
                  onClick={async () => {
                    await deletePrompt(id);
                    setId("");
                    setBody("");
                    await reload();
                  }}
                >
                  Delete
                </button>
              )}
            </div>
            {status && <div className="prompts-status">{status}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

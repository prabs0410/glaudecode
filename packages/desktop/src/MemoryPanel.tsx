import { useCallback, useEffect, useState } from "react";
import {
  listMemory,
  loadedContext,
  readMemory,
  readProjectInstructions,
  writeMemory,
  writeProjectInstructions,
  type MemoryFile,
} from "./engine";

// Memory & knowledge panel (Epic D §3.1). View/edit the project's AGENTS.md and memory
// files without leaving the terminal, and see exactly what was loaded into the selected
// session. Editing uses a plain textarea for V2 (a rich CodeMirror editor is a tracked
// enhancement). AGENTS.md saves confirm first; the engine writes through the
// CLAUDE.md→AGENTS.md symlink so the link is never broken.

interface Props {
  dir: string | null;
  selectedId: string | null;
}

export function MemoryPanel({ dir, selectedId }: Props) {
  const [instructions, setInstructions] = useState<string>("");
  const [instructionsPath, setInstructionsPath] = useState<string | null>(null);
  const [files, setFiles] = useState<MemoryFile[]>([]);
  const [openFile, setOpenFile] = useState<MemoryFile | null>(null);
  const [fileBody, setFileBody] = useState<string>("");
  const [loaded, setLoaded] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!dir) return;
    try {
      const [instr, mem] = await Promise.all([readProjectInstructions(dir), listMemory(dir)]);
      setInstructions(instr?.content ?? "");
      setInstructionsPath(instr?.path ?? null);
      setFiles(mem);
    } catch (e: any) {
      setStatus(String(e?.message ?? e));
    }
  }, [dir]);

  useEffect(() => {
    setOpenFile(null);
    setFileBody("");
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!dir || !selectedId) {
      setLoaded(null);
      return;
    }
    loadedContext(selectedId, dir)
      .then((c) => setLoaded(c.instructions ?? ""))
      .catch(() => setLoaded(null));
  }, [dir, selectedId]);

  const saveInstructions = async () => {
    if (!dir) return;
    if (!confirm("Save AGENTS.md? This changes the instructions every agent in this project loads.")) return;
    try {
      await writeProjectInstructions(dir, instructions);
      setStatus("Saved AGENTS.md");
    } catch (e: any) {
      setStatus(String(e?.message ?? e));
    }
  };

  const openMemory = async (f: MemoryFile) => {
    if (!dir) return;
    setOpenFile(f);
    try {
      const { content } = await readMemory(dir, f.path);
      setFileBody(content);
    } catch (e: any) {
      setStatus(String(e?.message ?? e));
    }
  };

  const saveMemory = async () => {
    if (!dir || !openFile) return;
    try {
      await writeMemory(dir, openFile.path, fileBody);
      setStatus(`Saved ${openFile.name}`);
      await reload();
    } catch (e: any) {
      setStatus(String(e?.message ?? e));
    }
  };

  if (!dir)
    return (
      <div className="dock-empty">Open or focus a Claude session to view & edit its memory.</div>
    );

  return (
    <div className="memory-panel">
      {status && <div className="memory-status">{status}</div>}

      <section className="memory-section">
        <div className="memory-head">
          <span>{instructionsPath ? basename(instructionsPath) : "AGENTS.md"}</span>
          <button className="act" onClick={() => void saveInstructions()}>
            Save
          </button>
        </div>
        <textarea
          className="memory-editor"
          value={instructions}
          spellCheck={false}
          onChange={(e) => setInstructions(e.currentTarget.value)}
          placeholder="No AGENTS.md / CLAUDE.md yet — type to create one."
        />
      </section>

      <section className="memory-section">
        <div className="memory-head">
          <span>Memory files{files.length ? ` · ${files.length}` : ""}</span>
        </div>
        <ul className="memory-list">
          {files.length === 0 && <li className="dock-empty">No memory files for this project.</li>}
          {files.map((f) => (
            <li
              key={f.path}
              className={`memory-file${openFile?.path === f.path ? " open" : ""}`}
              onClick={() => void openMemory(f)}
            >
              <span className="memory-file-name">{f.name}</span>
              <span className="memory-file-bytes">{f.bytes}b</span>
            </li>
          ))}
        </ul>
        {openFile && (
          <div className="memory-section">
            <div className="memory-head">
              <span>{openFile.name}</span>
              <button className="act" onClick={() => void saveMemory()}>
                Save
              </button>
            </div>
            <textarea
              className="memory-editor"
              value={fileBody}
              spellCheck={false}
              onChange={(e) => setFileBody(e.currentTarget.value)}
            />
          </div>
        )}
      </section>

      <section className="memory-section">
        <div className="memory-head">
          <span>Loaded into this session</span>
        </div>
        {selectedId ? (
          loaded ? (
            <pre className="memory-loaded">{loaded}</pre>
          ) : (
            <div className="dock-empty">No loaded-context record for this session.</div>
          )
        ) : (
          <div className="dock-empty">Select a session to see what it loaded.</div>
        )}
      </section>
    </div>
  );
}

function basename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

import { useEffect, useState } from "react";
import { chordFromEvent } from "./keybindings";
import { getKeybindings, resetKeybindings, setKeybinding, type Keybinding, type Keymap } from "./engine";

// Minimal keybindings settings (Epic F §3.2). Lists the effective keymap, lets you rebind a
// command by pressing a chord, surfaces conflicts, and resets to defaults. Terminal keys are
// protected server-side (validateKeys rejects bare keys).

interface Props {
  commands: Array<{ id: string; title: string }>;
  onClose: () => void;
  onChanged: (bindings: Keybinding[]) => void;
}

export function KeybindingsModal({ commands, onClose, onChanged }: Props) {
  const [keymap, setKeymap] = useState<Keymap | null>(null);
  const [capturing, setCapturing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const titleFor = (id: string) => commands.find((c) => c.id === id)?.title ?? id;
  const refresh = (km: Keymap) => {
    setKeymap(km);
    onChanged(km.bindings);
  };

  useEffect(() => {
    getKeybindings().then(setKeymap).catch(() => setKeymap({ bindings: [], conflicts: [] }));
  }, []);

  // While capturing, the next chord becomes the binding.
  useEffect(() => {
    if (!capturing) return;
    const onKey = async (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setCapturing(null);
        return;
      }
      if (["Meta", "Control", "Alt", "Shift"].includes(e.key)) return; // wait for the real key
      e.preventDefault();
      const chord = chordFromEvent(e);
      setCapturing(null);
      try {
        refresh(await setKeybinding(capturing, chord));
        setError(null);
      } catch (err: any) {
        setError(String(err?.message ?? err));
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing]);

  const reset = async () => refresh(await resetKeybindings());

  const conflictKeys = new Set((keymap?.conflicts ?? []).map((c) => c.keys));

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="keys-modal" onClick={(e) => e.stopPropagation()}>
        <div className="keys-head">
          <span>Keybindings</span>
          <button className="act" onClick={() => void reset()}>
            Reset to defaults
          </button>
        </div>
        {error && <div className="dock-error">{error}</div>}
        <ul className="keys-list">
          {(keymap?.bindings ?? []).map((b) => (
            <li key={b.command} className="keys-row">
              <span className="keys-cmd">{titleFor(b.command)}</span>
              <span className={`keys-chord${conflictKeys.has(b.keys) ? " conflict" : ""}`}>{b.keys}</span>
              <button className="act mini" onClick={() => setCapturing(b.command)}>
                {capturing === b.command ? "press…" : "rebind"}
              </button>
            </li>
          ))}
        </ul>
        {keymap && keymap.conflicts.length > 0 && (
          <div className="keys-warn">⚠ {keymap.conflicts.length} conflicting binding(s) — same chord on multiple commands.</div>
        )}
        <div className="keys-hint">Press a chord with a modifier (mod/alt). Esc cancels.</div>
      </div>
    </div>
  );
}

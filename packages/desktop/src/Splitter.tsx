import { useRef } from "react";

// A vertical drag handle between two panels. Reports a new width as you drag, clamped to
// [min, max]. `sign` is +1 when the panel to the LEFT grows as you drag right (sidebar) and
// -1 when the panel to the RIGHT grows as you drag left (right dock).
interface Props {
  value: number;
  min: number;
  max: number;
  sign: 1 | -1;
  onChange: (next: number) => void;
}

export function Splitter({ value, min, max, sign, onChange }: Props) {
  const drag = useRef<{ startX: number; startVal: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    drag.current = { startX: e.clientX, startVal: value };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    const move = (ev: PointerEvent) => {
      if (!drag.current) return;
      const delta = sign * (ev.clientX - drag.current.startX);
      onChange(Math.max(min, Math.min(max, drag.current.startVal + delta)));
    };
    const up = () => {
      drag.current = null;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return <div className="splitter" onPointerDown={onPointerDown} role="separator" aria-orientation="vertical" />;
}

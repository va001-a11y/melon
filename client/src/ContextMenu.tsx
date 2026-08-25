import { useEffect, useRef } from "react";

export interface MenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
}

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

/** Small floating menu anchored at a right-click position. */
export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // Defer so the click that opened the menu doesn't immediately close it.
    const id = setTimeout(() => {
      window.addEventListener("mousedown", onDown);
      window.addEventListener("contextmenu", onDown);
    }, 0);
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(id);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("contextmenu", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Keep the menu on screen near the right/bottom edges. The lower bound
  // matters on short viewports (a phone in landscape), where subtracting the
  // menu height from the window height can otherwise go negative and push the
  // first item off the top of the screen.
  const left = Math.max(8, Math.min(x, window.innerWidth - 190));
  const top = Math.max(8, Math.min(y, window.innerHeight - items.length * 32 - 16));

  return (
    <div className="context-menu" style={{ left, top }} ref={ref} role="menu">
      {items.map((item) => (
        <button
          key={item.label}
          className={`context-item ${item.danger ? "danger" : ""}`}
          role="menuitem"
          onClick={() => {
            item.onClick();
            onClose();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

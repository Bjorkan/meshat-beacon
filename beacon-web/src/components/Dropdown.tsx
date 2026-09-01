import { useState, useRef, useCallback, useEffect, type ReactNode } from "react";
import { useClickOutside } from "../hooks/useClickOutside";

export function Dropdown({ renderTrigger, align = "right", width = "w-48", fullWidth = false, className = "", mobileViewport = false, children }: {
  renderTrigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  align?: "left" | "right";
  width?: string;
  // stretch + render the panel inline (accordion) for the mobile filter sheet
  fullWidth?: boolean;
  className?: string;
  // On narrow screens, detach the panel from its compact trigger and center it in the viewport.
  mobileViewport?: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((v) => !v), []);
  useClickOutside(ref, open, close);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopPropagation(); // innermost layer wins — don't let an enclosing sheet/modal close too
      close();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, close]);

  return (
    <div ref={ref} className={`relative ${fullWidth ? "w-full" : ""} ${className}`}>
      {renderTrigger({ open, toggle })}
      {open && (
        <div className={
          fullWidth
            ? "mt-1 w-full bg-bg-raised border border-border rounded-md py-1 max-h-72 overflow-y-auto"
            : `absolute top-full mt-1 ${align === "left" ? "left-0" : "right-0"} ${width} max-w-[calc(100vw-1.5rem)] ${
                mobileViewport
                  ? "max-sm:fixed max-sm:top-[46px] max-sm:inset-x-3 max-sm:w-auto max-sm:max-w-none max-sm:max-h-[calc(100dvh-4rem)]"
                  : ""
              } bg-bg-raised border border-border rounded-md shadow-lg z-50 py-1 max-h-80 overflow-y-auto`
        }>
          {children(close)}
        </div>
      )}
    </div>
  );
}

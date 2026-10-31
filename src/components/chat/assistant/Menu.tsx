import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check } from "lucide-react";
import { AI_DURATION, AI_EASE } from "./motion";

export type MenuItem =
  | { kind?: "item"; label: string; icon?: ReactNode; onSelect: () => void; checked?: boolean }
  | { kind: "separator" }
  | { kind: "label"; label: string };

/**
 * The chat's one dropdown: white, a 1px hairline, 10px radius, no shadow. Anchored to its trigger, it opens below
 * (or above, near the bottom of the window) and toward the side with room; 160ms in, 120ms out. It is drawn over
 * the page (a portal), so the transcript's scroller never clips it. Arrow keys move through it, Escape and a click
 * outside close it, scrolling closes it, and focus goes back to the trigger.
 */
export function ChatMenu({
  trigger,
  items,
  label,
}: {
  /** renders the trigger button: it gets the open state and the props to spread on it */
  trigger: (props: { ref: React.Ref<HTMLButtonElement>; open: boolean; onClick: () => void; "aria-expanded": boolean; "aria-haspopup": "menu" }) => ReactNode;
  items: MenuItem[];
  label: string;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<"bottom" | "top">("bottom");
  const [align, setAlign] = useState<"start" | "end">("start");
  const [place, setPlace] = useState<CSSProperties>({});
  const reduced = useReducedMotion();

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    /* rows are 36px; labels and separators are shorter, so this errs toward room */
    const height = items.length * 36 + 14;
    const up = window.innerHeight - rect.bottom < height + 16 && rect.top > height + 16;
    const end = window.innerWidth - rect.left < 240;
    setSide(up ? "top" : "bottom");
    setAlign(end ? "end" : "start");
    setPlace({
      position: "fixed",
      top: up ? "auto" : rect.bottom + 4,
      bottom: up ? window.innerHeight - rect.top + 4 : "auto",
      left: end ? "auto" : rect.left,
      right: end ? window.innerWidth - rect.right : "auto",
    });
  }, [open, items.length]);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    const close = (refocus: boolean) => { setOpen(false); if (refocus) triggerRef.current?.focus({ preventScroll: true }); };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) close(false);
    };
    /* it is fixed to where the trigger was: a scroll elsewhere would leave it behind */
    const onScroll = (event: Event) => { if (!menuRef.current?.contains(event.target as Node)) close(false); };
    const onResize = () => close(false);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopPropagation(); close(true); return; }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
      const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
      if (!buttons.length) return;
      event.preventDefault();
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
        : event.key === "ArrowDown" ? (index + 1) % buttons.length : (index - 1 + buttons.length) % buttons.length;
      buttons[next].focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  const offset = side === "bottom" ? 4 : -4;
  return (
    <div className="clyra-ai-menu-root" ref={rootRef} style={{ position: "relative", display: "inline-flex" }}>
      {trigger({ ref: triggerRef, open, onClick: () => setOpen((value) => !value), "aria-expanded": open, "aria-haspopup": "menu" })}
      {createPortal(
      /* .clyra-chat-ui carries the chat's tokens out here */
      <div className="clyra-chat-ui">
      <AnimatePresence>
        {open ? (
          <motion.div
            ref={menuRef}
            key="menu"
            className="clyra-ai-menu"
            role="menu"
            aria-label={label}
            data-side={side}
            data-align={align}
            style={{ ...place, zIndex: 1000 }}
            initial={reduced ? false : { opacity: 0, y: offset }}
            animate={{ opacity: 1, y: 0, transition: { duration: reduced ? 0 : AI_DURATION.menuOpen, ease: AI_EASE } }}
            exit={{ opacity: 0, y: side === "bottom" ? 2 : -2, transition: { duration: reduced ? 0 : AI_DURATION.menuClose, ease: AI_EASE } }}
          >
            {items.map((item, i) =>
              item.kind === "separator" ? <div key={`sep-${i}`} className="clyra-ai-menu__sep" role="separator" />
              : item.kind === "label" ? <div key={`label-${i}`} className="clyra-ai-menu__label">{item.label}</div>
              : (
                <button
                  key={item.label}
                  type="button"
                  role={item.checked === undefined ? "menuitem" : "menuitemradio"}
                  aria-checked={item.checked}
                  className="clyra-ai-menu__item"
                  onClick={() => { setOpen(false); triggerRef.current?.focus({ preventScroll: true }); item.onSelect(); }}
                >
                  {item.icon}
                  {item.label}
                  {item.checked ? <Check className="clyra-ai-menu__check" aria-hidden /> : null}
                </button>
              ),
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
      </div>,
      document.body,
      )}
    </div>
  );
}

import { useEffect, type RefObject } from "react";

/**
 * Dismisses an open menu/popover on an outside pointer press or Escape.
 * `ref` should wrap both the trigger and the menu it opens, so pressing the
 * trigger again is handled by its own onClick instead of racing this.
 */
export function useClickAway(ref: RefObject<HTMLElement | null>, active: boolean, onDismiss: () => void) {
  useEffect(() => {
    if (!active) return;
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onDismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [active, ref, onDismiss]);
}

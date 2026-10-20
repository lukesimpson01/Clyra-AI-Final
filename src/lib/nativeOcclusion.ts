import { useLayoutEffect } from "react";

/**
 * Native Chromium surfaces (live previews, the browser) paint above the whole React tree. Any overlay that can sit on
 * top of one — a sheet, a popover, the Library — must ask them to hide while it is open. Holders are counted so two
 * overlays never fight: surfaces come back only when the last one closes.
 */
let holders = 0;

function broadcast() {
  window.dispatchEvent(new CustomEvent("clyra:native-surface-occlusion", { detail: { occluded: holders > 0 } }));
}

export function useNativeOcclusion(active: boolean) {
  useLayoutEffect(() => {
    if (!active) return;
    holders += 1;
    broadcast();
    return () => {
      holders = Math.max(0, holders - 1);
      broadcast();
    };
  }, [active]);
}

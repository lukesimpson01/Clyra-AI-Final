/**
 * Shared-element anchor for Clyra's orb. The chat home screen registers the
 * on-screen position of its orb here; the voice call reads it so the call's
 * orb can fly out of (and back into) exactly that spot instead of cutting.
 */
let anchorEl: HTMLElement | null = null;

export function setOrbAnchor(element: HTMLElement | null) {
  anchorEl = element;
}

export function getOrbAnchorRect(): DOMRect | null {
  if (!anchorEl || !anchorEl.isConnected) return null;
  const rect = anchorEl.getBoundingClientRect();
  // An orb hidden by a collapsed welcome block has no usable box.
  return rect.width > 8 && rect.height > 8 ? rect : null;
}

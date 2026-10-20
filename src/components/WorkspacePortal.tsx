import { useCallback, useLayoutEffect, useRef, type ReactNode } from "react";
import { cn } from "../lib/utils";

/**
 * Reverse portals for workspaces. Each app renders once, through `createPortal`, into a DOM node that belongs to it
 * for the life of the window. Wherever the app should appear — the normal workspace panel or a Task View card — a
 * `WorkspaceSlot` adopts that node. Moving between the two is a DOM move, not a React remount, so entering and leaving
 * Task View never rebuilds an app or loses its state.
 */
export function useWorkspacePortalNodes() {
  const nodes = useRef(new Map<string, HTMLDivElement>());
  return useCallback((id: string) => {
    let node = nodes.current.get(id);
    if (!node) {
      node = document.createElement("div");
      node.className = "clyra-workspace-portal";
      node.dataset.workspacePortal = id;
      nodes.current.set(id, node);
    }
    return node;
  }, []);
}

export function WorkspaceSlot({ node, placeholder, className }: { node: HTMLDivElement; placeholder?: ReactNode; className?: string }) {
  const slotRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const slot = slotRef.current;
    if (!slot) return;
    slot.appendChild(node);
    return () => {
      if (node.parentNode === slot) slot.removeChild(node);
    };
  }, [node]);
  return (
    <div ref={slotRef} className={cn("clyra-workspace-slot", className)}>
      {placeholder}
    </div>
  );
}

/** Shown on a Task View card while that app's live surface is still being prepared. */
export function WorkspaceCardPlaceholder({ label }: { label: string }) {
  return (
    <div className="clyra-workspace-placeholder" aria-hidden>
      <div className="clyra-workspace-placeholder__rail" />
      <div className="clyra-workspace-placeholder__body">
        <span className="clyra-workspace-placeholder__mark">{label.slice(0, 1)}</span>
        <span className="clyra-workspace-placeholder__name">{label}</span>
        <span className="clyra-workspace-placeholder__line" />
        <span className="clyra-workspace-placeholder__line clyra-workspace-placeholder__line--short" />
      </div>
    </div>
  );
}

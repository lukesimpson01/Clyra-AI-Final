import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Small controller for programmatic, space-like transitions. It deliberately
 * owns no pointer or touch handling: callers decide exactly when navigation
 * happens, then call `transitionTo(view, direction, commit)`.
 */
export type PageTransitionDirection = "forward" | "back" | 1 | -1;

export type MacOSPageTransitionController<View extends string> = {
  isTransitioning: boolean;
  transitionTo: (
    view: View,
    direction: PageTransitionDirection,
    commit: () => void,
  ) => boolean;
};

const TRANSITION_LOCK_MS = 500;

export function useMacOSPageTransition<View extends string>(
  activeView: View,
  onDirection: (direction: -1 | 1) => void,
  onTransitionStateChange: (active: boolean) => void,
): MacOSPageTransitionController<View> {
  const activeViewRef = useRef(activeView);
  const lockedRef = useRef(false);
  const unlockTimerRef = useRef<number | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);

  useEffect(() => {
    activeViewRef.current = activeView;
  }, [activeView]);

  useEffect(() => () => {
    if (unlockTimerRef.current != null) window.clearTimeout(unlockTimerRef.current);
  }, []);

  const transitionTo = useCallback((view: View, direction: PageTransitionDirection, commit: () => void) => {
    // A repeated activation must never queue duplicate enter/exit trees. The
    // current space completes from its exact presentation value instead.
    if (lockedRef.current || view === activeViewRef.current) return false;
    const normalized = direction === "back" || direction === -1 ? -1 : 1;
    lockedRef.current = true;
    setIsTransitioning(true);
    onTransitionStateChange(true);
    onDirection(normalized);
    activeViewRef.current = view;
    commit();

    unlockTimerRef.current = window.setTimeout(() => {
      lockedRef.current = false;
      setIsTransitioning(false);
      onTransitionStateChange(false);
      unlockTimerRef.current = null;
    }, TRANSITION_LOCK_MS);
    return true;
  }, [onDirection, onTransitionStateChange]);

  return { isTransitioning, transitionTo };
}

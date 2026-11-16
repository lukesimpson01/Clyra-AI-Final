import { useCallback, useRef } from "react";

/**
 * Composition-aware helpers for a text control. While an IME composition is open nothing may rewrite the text or the selection,
 * and Enter belongs to the IME, not to "send". Ordinary typing is left entirely to the browser.
 */
export function useTextInput() {
  const composing = useRef(false);
  const onCompositionStart = useCallback(() => { composing.current = true; }, []);
  const onCompositionEnd = useCallback(() => { composing.current = false; }, []);
  const isComposing = useCallback((event?: { nativeEvent?: { isComposing?: boolean } }) => composing.current || Boolean(event?.nativeEvent?.isComposing), []);
  return { composing, isComposing, onCompositionStart, onCompositionEnd };
}

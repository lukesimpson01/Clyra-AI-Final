import { forwardRef, memo, useImperativeHandle, useLayoutEffect, useRef, type KeyboardEvent, type TextareaHTMLAttributes } from "react";
import { useTextInput } from "../../hooks/useTextInput";
import { autoResize } from "./AutoResizeController";
import "./TextEngine.css";

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value"> & {
  value: string;
  onValueChange: (value: string) => void;
  /** Enter (without Shift, outside an IME composition) calls this. */
  onSubmit?: () => void;
  maxHeight?: number;
};

/**
 * A native textarea with the editing behaviour a premium text field needs and nothing that fights the browser: native caret and
 * selection, IME-safe Enter, height that follows the content without moving text, stable identity so focus survives re-renders.
 */
export const PremiumTextarea = memo(forwardRef<HTMLTextAreaElement, Props>(function PremiumTextarea({ value, onValueChange, onSubmit, maxHeight = 240, className = "", onKeyDown, onCompositionStart, onCompositionEnd, ...rest }, forwardedRef) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(forwardedRef, () => ref.current as HTMLTextAreaElement);
  const { isComposing, onCompositionStart: start, onCompositionEnd: end } = useTextInput();
  useLayoutEffect(() => { if (ref.current) autoResize(ref.current, maxHeight); }, [value, maxHeight]);
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === "Enter" && !event.shiftKey && !isComposing(event) && onSubmit) { event.preventDefault(); onSubmit(); }
  };
  return (
    <textarea
      ref={ref}
      rows={1}
      spellCheck
      {...rest}
      className={`clyra-text-input ${className}`.trim()}
      value={value}
      onChange={(event) => onValueChange(event.currentTarget.value)}
      onKeyDown={keyDown}
      onCompositionStart={(event) => { start(); onCompositionStart?.(event); }}
      onCompositionEnd={(event) => { end(); onCompositionEnd?.(event); }}
    />
  );
}));

import * as React from "react";
import { cn } from "../../lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
};

const FIELD_CLASS =
  "w-full rounded-[var(--clyra-radius-md)] border border-[var(--clyra-color-border)] bg-[var(--clyra-color-surface)] text-[var(--clyra-color-label)] outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-[var(--clyra-color-label-tertiary)] focus:border-[var(--clyra-color-accent)] focus:shadow-[0_0_0_3px_var(--clyra-color-accent-soft)] disabled:opacity-45";

/** Universal text field. Wrap with leading/trailing icons instead of rolling a one-off input + absolutely-positioned icon each time. */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, leadingIcon, trailingIcon, ...props }, ref) => {
    if (!leadingIcon && !trailingIcon) {
      return <input ref={ref} className={cn(FIELD_CLASS, "h-9 px-3 text-[13.5px]", className)} {...props} />;
    }
    return (
      <div className={cn(FIELD_CLASS, "flex h-9 items-center gap-2 px-3")}>
        {leadingIcon ? <span className="shrink-0 text-[var(--clyra-color-label-tertiary)]">{leadingIcon}</span> : null}
        <input
          ref={ref}
          className={cn("w-full min-w-0 bg-transparent text-[13.5px] outline-none placeholder:text-[var(--clyra-color-label-tertiary)]", className)}
          {...props}
        />
        {trailingIcon ? <span className="shrink-0 text-[var(--clyra-color-label-tertiary)]">{trailingIcon}</span> : null}
      </div>
    );
  },
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={cn(FIELD_CLASS, "min-h-[72px] resize-none px-3 py-2 text-[13.5px] leading-[1.5]", className)} {...props} />
  ),
);
Textarea.displayName = "Textarea";

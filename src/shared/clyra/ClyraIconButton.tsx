import type { ButtonHTMLAttributes, ReactNode } from "react";
export function ClyraIconButton({ children, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) { return <button {...props} className={`clyra-icon-button ${className}`.trim()}>{children}</button>; }

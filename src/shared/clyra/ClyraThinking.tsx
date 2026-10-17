import type { ReactNode } from "react";
import "./clyra-motion.css";

export function ClyraThinking({ children, icon, className = "" }: { children: ReactNode; icon?: ReactNode; className?: string }) {
  return <div className={`clyra-thinking ${className}`.trim()}>{icon ? <span className="clyra-thinking__icon" aria-hidden>{icon}</span> : null}<span className="clyra-thinking__text">{children}</span></div>;
}

// Creator Studio: Fake Text Story, Would You Rather and AI Clipper. The editing
// UI, previews and in-browser MP4 export live in creatorStudio.ts; this wrapper
// mounts it into the Shorts shell and hands control back on exit.

import { useEffect, useRef } from "react";
import studioCss from "./studioStyles.css?inline";
import { mountCreatorStudio } from "./studioEngine";
import type { EditorSend } from "../ShortsVideoEditor";

export type CreatorStudioTool = "text" | "wyr" | "clipper";

const STYLE_ID = "creator-studio-styles";

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = studioCss;
  document.head.appendChild(style);
}

export function CreatorStudio({ tool, onExit, youtubeUrl, onOpenProject, onOpenEditor }: { tool: CreatorStudioTool; onExit: () => void; youtubeUrl?: string; onOpenProject?: (projectId: string) => void; onOpenEditor?: (send: EditorSend) => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const exitRef = useRef(onExit);
  exitRef.current = onExit;
  const openRef = useRef(onOpenProject);
  openRef.current = onOpenProject;
  const editorRef = useRef(onOpenEditor);
  editorRef.current = onOpenEditor;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    ensureStyles();
    const studio = mountCreatorStudio(host, { tool, css: studioCss, youtubeUrl, onExit: () => exitRef.current(), openProject: (id: string) => openRef.current?.(id), openEditor: (send: EditorSend) => editorRef.current?.(send) });
    return () => studio.destroy();
  }, [tool, youtubeUrl]);

  return <div ref={hostRef} style={{ height: "100%", minHeight: 0 }} />;
}

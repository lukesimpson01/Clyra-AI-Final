import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Expand, HardDrive, RefreshCw } from "lucide-react";

// Run the graphics engine on the loopback alias opposite the app shell. The
// separate origin gives Chromium an out-of-process iframe, isolating the
// demanding WebGL/WebGPU canvas from the rest of Clyra's renderer. The server
// permits only the two loopback aliases to frame this vendor surface.
const editorHost = window.location.hostname === "localhost" ? "127.0.0.1" : "localhost";
const EDITOR_URL = `${window.location.protocol}//${editorHost}:${window.location.port}/vendor/clyra-video-editor/index.html?empty&nosw&frameworkers=1&nogpuworkers=1&parentOrigin=${encodeURIComponent(window.location.origin)}`;
const EDITOR_ORIGIN = new URL(EDITOR_URL).origin;

export function ShortsVideoEditor({ onBack }: { onBack: () => void }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [instance, setInstance] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin === EDITOR_ORIGIN && event.data?.type === "clyra-video-editor-ready") setReady(true);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const reload = () => {
    setReady(false);
    setInstance((value) => value + 1);
  };

  const enterFullscreen = async () => {
    await frameRef.current?.requestFullscreen?.().catch(() => undefined);
  };

  return (
    <section className="sh-video-editor" aria-label="Video Editor">
      <header className="sh-video-editor__bar">
        <div className="sh-video-editor__group">
          <button type="button" className="sh-video-editor__back" onClick={onBack}>
            <ArrowLeft size={16} strokeWidth={1.8} />
            Shorts home
          </button>
          <span className="sh-video-editor__divider" />
          <div>
            <div className="sh-video-editor__title">Video Editor</div>
            <div className="sh-video-editor__subtitle">Motion graphics, compositing and timeline editing</div>
          </div>
        </div>
        <div className="sh-video-editor__actions">
          <span className="sh-video-editor__local"><HardDrive size={13} strokeWidth={1.8} /> Local workspace</span>
          <button type="button" className="sh-icon-btn" onClick={reload} aria-label="Reload video editor" title="Reload editor">
            <RefreshCw size={15} strokeWidth={1.8} />
          </button>
          <button type="button" className="sh-icon-btn" onClick={() => void enterFullscreen()} aria-label="Open video editor fullscreen" title="Fullscreen">
            <Expand size={15} strokeWidth={1.8} />
          </button>
        </div>
      </header>

      <div className="sh-video-editor__surface">
        {!ready ? (
          <div className="sh-video-editor__loading" role="status">
            <span className="sh-video-editor__spinner" />
            <strong>Opening the editor</strong>
            <span>The local editing engine is starting…</span>
          </div>
        ) : null}
        <iframe
          key={instance}
          ref={frameRef}
          className={`sh-video-editor__frame${ready ? " is-ready" : ""}`}
          src={EDITOR_URL}
          title="Clyra Video Editor"
          onLoad={() => setReady(true)}
          allow="fullscreen; clipboard-read; clipboard-write"
          allowFullScreen
        />
      </div>
    </section>
  );
}

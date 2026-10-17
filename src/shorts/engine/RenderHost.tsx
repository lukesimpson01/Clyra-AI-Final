// Headless export page. The server's frame renderer opens
// /?shortsRender=<jobId>, waits for window.__shortsReady, then calls
// window.__shortsSetTime(ms) once per frame and screenshots the stage. It mounts
// the same ShortsCanvas the editor uses, so exported frames match the preview.

import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { ShortsCanvas } from "./ShortsCanvas";
import type { ShortsProject } from "../../../lib/shorts/schema";

type Spec = { project: ShortsProject; width: number; height: number; fps: number; durationMs: number; opaque: boolean };

declare global {
  interface Window {
    __shortsSetTime?: (timeMs: number) => Promise<void>;
    __shortsReady?: boolean;
  }
}

export function ShortsRenderHost({ jobId }: { jobId: string }) {
  const [spec, setSpec] = useState<Spec | null>(null);
  const [timeMs, setTimeMs] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // index.html paints a full-viewport #clyra-preboot-surface (z-index 10000,
  // opaque white) over React's first commit, normally cleared by App's own
  // boot sequence once the real UI is ready. This render page never mounts
  // App, so without this the overlay stays forever — invisible to clicks
  // (pointer-events: none) but fully opaque to the compositor, so every
  // captured frame was a blank white rectangle regardless of what the real
  // content underneath was doing.
  useEffect(() => {
    document.getElementById("clyra-preboot-surface")?.remove();
  }, []);

  useEffect(() => {
    let alive = true;
    fetch(`/api/shorts/renders/${encodeURIComponent(jobId)}/spec`)
      .then((response) => response.json())
      .then((body: { ok?: boolean; spec?: Spec; error?: string }) => {
        if (!alive) return;
        if (!body.ok || !body.spec) throw new Error(body.error || "Render spec missing");
        setSpec(body.spec);
      })
      .catch((cause: Error) => alive && setError(cause.message));
    return () => {
      alive = false;
    };
  }, [jobId]);

  useEffect(() => {
    window.__shortsSetTime = (value: number) =>
      new Promise<void>((resolve) => {
        // flushSync commits this frame's DOM before the screenshot is taken.
        flushSync(() => setTimeMs(value));
        requestAnimationFrame(() => resolve());
      });
    return () => {
      delete window.__shortsSetTime;
    };
  }, []);

  useEffect(() => {
    if (!spec) return;
    // Transparent pages for video backgrounds: FFmpeg supplies the picture underneath.
    const style = document.createElement("style");
    style.textContent = `html, body, #root { background: ${spec.opaque ? "#000" : "transparent"} !important; margin: 0; overflow: hidden; }`;
    document.head.appendChild(style);
    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (!cancelled) window.__shortsReady = true;
    });
    return () => {
      cancelled = true;
      style.remove();
    };
  }, [spec]);

  if (error) return <div style={{ color: "#b00", padding: 20, fontFamily: "sans-serif" }}>Render page error: {error}</div>;
  if (!spec) return null;
  return (
    <div style={{ width: spec.width, height: spec.height, overflow: "hidden", background: spec.opaque ? undefined : "transparent" }}>
      <ShortsCanvas project={spec.project} timeMs={timeMs} mode="export" pixelWidth={spec.width} />
    </div>
  );
}

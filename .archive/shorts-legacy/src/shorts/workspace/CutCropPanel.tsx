// Cut & Crop stage. The source plays in place of the canvas, the in and out
// range is set in the inspector, and the crop region is shown by dimming the
// area that will be removed. The export uses FFmpeg directly, so this stage
// only needs to show the source frame accurately.

import type { RefObject } from "react";
import { outputSize, type ShortsProject } from "../../../lib/shorts/schema";

export function CutCropPanel({ project, previewWidth, videoRef }: { project: ShortsProject; onCropChange?: (crop: ShortsProject["crop"]) => void; previewWidth: number; videoRef: RefObject<HTMLVideoElement | null> }) {
  const source = project.source;
  if (!source?.file) {
    return (
      <div className="sh-card" style={{ padding: 28, maxWidth: 420, textAlign: "center" }}>
        <p className="sh-muted" style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>Add a video from the left panel to start cutting. The original file is copied into this project and never changed.</p>
      </div>
    );
  }
  const sourceRatio = source.width / Math.max(1, source.height);
  const width = Math.round(Math.min(previewWidth, 760));
  const height = Math.round(width / sourceRatio);
  const crop = project.crop;
  const output = outputSize(project.aspect, 1080);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
      <div style={{ position: "relative", width, height, borderRadius: 14, overflow: "hidden", background: "#000", boxShadow: "var(--sh-shadow-lift)" }}>
        <video ref={videoRef} src={`/api/shorts/projects/${project.id}/${source.file}`} muted playsInline preload="auto" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
        {crop ? <CropShade crop={crop} /> : null}
      </div>
      <span className="sh-muted" style={{ fontSize: 12 }}>
        Output {output.width}×{output.height} · {project.aspect} · {crop ? "cropped region" : "full frame, centred cover-crop"}
      </span>
    </div>
  );
}

function CropShade({ crop }: { crop: NonNullable<ShortsProject["crop"]> }) {
  const shade = "rgba(0,0,0,0.55)";
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: `${crop.y * 100}%`, background: shade }} />
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: `${(1 - crop.y - crop.h) * 100}%`, background: shade }} />
      <div style={{ position: "absolute", left: 0, top: `${crop.y * 100}%`, width: `${crop.x * 100}%`, height: `${crop.h * 100}%`, background: shade }} />
      <div style={{ position: "absolute", right: 0, top: `${crop.y * 100}%`, width: `${(1 - crop.x - crop.w) * 100}%`, height: `${crop.h * 100}%`, background: shade }} />
      <div style={{ position: "absolute", left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%`, border: "2px solid #fff", boxSizing: "border-box" }} />
    </div>
  );
}

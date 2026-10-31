import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  AudioLines,
  Check,
  ChevronDown,
  CloudUpload,
  Copy,
  Download,
  Film,
  Flag,
  Group,
  ImagePlus,
  Keyboard,
  Layers,
  Maximize,
  Music2,
  Pause,
  Play,
  Plus,
  Redo2,
  Scissors,
  Search,
  Shapes,
  SlidersHorizontal,
  Subtitles,
  Trash2,
  Type,
  Ungroup,
  Undo2,
  Upload,
  Video,
  WandSparkles,
  X,
  ZoomIn,
  ZoomOut,
  Sparkles,
  LayoutTemplate,
  ChevronRight,
  GripVertical,
  Headphones,
  Mic,
  MessagesSquare,
  MessageSquare,
  Crop,
  Smile,
  Repeat2,
  Square,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Volume2,
  VolumeX,
  Link2,
  Unlink2,
  Magnet,
  ChartSpline,
  ClipboardPaste,
  FlipHorizontal2,
  ArrowLeftRight,
} from "lucide-react";
import { backgrounds } from "./StoryWizard.jsx";
import {
  sampleProperty, easingAt, PROPERTY_DEFS, clampToProperty, propertyDefault, upsertKeyframe, removeKeyframeById, keyframeAt,
  nextKeyframeTime, prevKeyframeTime, reverseKeyframes, duplicateAnimation, copyKeyframes, pasteKeyframes, bakeToKeyframes,
  EASING_OPTIONS, EASING_LABELS, migrateLayer, analyzeEnvelope, detectBeats, envelopeAt, moveKeyframes, stretchKeyframes, snapTime,
} from "./animationEngine.js";
import { PropertyRow, PositionRow, Section, AnimateGuide, AssistantsSection, ExpressionField } from "./MotionInspector.jsx";
import SubtitlePanel from "./SubtitlePanel.jsx";
import GraphEditor from "./GraphEditor.jsx";
import PropertiesPanel from "./PropertiesPanel.jsx";
import { SfxLibrary, SfxWave, pushRecentSfx, loadCombos, saveCombo, deleteCombo } from "./SfxPanel.jsx";
import { getAudioContext, scheduleSfx, clipSegments } from "./sfxPlayback.js";
import { sfxById, soundDuration } from "./sfxLibrary.js";
import { TRENDING_SOUNDS, TRENDING_AS_OF, TRENDING_SOURCES, soundSearchLinks } from "./trendingSounds.js";
import StoriesPanel from "./StoriesPanel.jsx";
import MusicBrowser from "./MusicBrowser.jsx";
import SoundEditor from "./SoundEditor.jsx";
import "./musicLibrary.js";
import { loadImportedSounds, importSoundFile, ensureLoaded,loadRecordingMetadata } from "./soundStore.js";
import { PresetGrid, AppliedPresets, TextAnimationControls, SavePreset } from "./AnimationLibrary.jsx";
import { ANIMATION_PRESETS, presetById, applyPreset, removePreset, saveCustomPreset, loadCustomPresets, applyCustomPreset } from "./animationPresets.js";
import "./advanced-editor.css";
import "./advanced-editor-timeline.css";
import "./motion-inspector.css";
import "./music-sfx.css";
import "./properties-panel.css";

const W = 720,
  H = 1280,
  DEFAULT_DURATION = 5;
const sections = [
  ["Media", CloudUpload],
  ["Effects", WandSparkles],
  ["Subtitles", Subtitles],
  ["Music", AudioLines],
  ["Sound FX", Volume2],
  ["Video", Video],
  ["Tools", WandSparkles],
  ["Objects", Shapes],
  ["Animations", Sparkles],
  ["Stories", MessagesSquare],
];
const captionStyles = [
  2, 215, 4, 5, 9, 18, 24, 39, 48, 54, 58, 72, 78, 108, 113, 143,
];
const lineStyles = [1, 7, 3, 6, 67, 8, 34, 37, 61, 66, 104, 114, 122, 131, 157, 208];
const featuredVideoIds = [
  ["00eieqe3-po4g-rh90-888c-zriwtgl77k", "3m 0s"],
  ["0864s7f0-u5v3-vrhb-lyef-n6lrc1oblvk", "1m 0s"],
  ["10xr2xpw-tode-8jnk-v1ke-zv3svbi4w3", "1m 0s"],
  ["25r3klxv-8xnh-bx9z-0v5e-l02oj4wq85p", "58s"],
];
const vfxSamples = [
  ["shut-up", "Reaction", "1s"], ["twelve-seconds", "Twelve seconds later", "2s"],
  ["explosion", "Explosion", "1s"], ["lying", "Why you always lying", "19s"],
];
const keyframeIdLocal = () => 'kf_' + Math.random().toString(36).slice(2, 10);
function StyleThumbnail({ mode, id }) {
  if (mode === "Lines") return <img src={`/images/subtitles/${id}.png`} alt={`Lines preset ${id}`} loading="lazy"/>;
  return <span className={`ae-style-word ae-style-word-${id}`} aria-label={`Word preset ${id}`} style={{ "--thumb-fill": captionPaint[id]?.[0] || "#fff", "--thumb-stroke": captionPaint[id]?.[1] || "#111" }}>WORD</span>;
}
const captionPaint = {
  2: ["#fff", "#000"],
  215: ["#4bd8f4", "#000"],
  4: ["#fff", "#111"],
  5: ["#fff", "#222"],
  9: ["#fff", "#000"],
  18: ["#fff", "#111"],
  24: ["#f7e44b", "#222"],
  39: ["#7cf66d", "#121212"],
  48: ["#fb73d4", "#111"],
  54: ["#fff", "#2966f2"],
  58: ["#fff", "#171717"],
  72: ["#ffdd00", "#000"],
  78: ["#fff", "#111"],
  108: ["#62d5ff", "#173248"],
  113: ["#fff", "#f4554e"],
  143: ["#fff", "#131313"],
  1: ["#fff", "#111"], 7: ["#fff", "#111"], 3: ["#fff", "#111"],
  6: ["#111", "#fff"], 67: ["#fff", "#111"], 8: ["#f5df56", "#333"],
};
const fonts = [
  "Arial",
  "Roboto",
  "Inter",
  "Montserrat",
  "Poppins",
  "Sora",
  "Georgia",
  "Impact",
  "DM Serif Display",
  "Secular One",
  "Staatliches",
  "Lilita One",
  "SF Pro Display",
];
const animations = [
  "None",
  "Fade",
  "Scale",
  "Slide",
  "Zoom",
  "Pop",
  "Jump",
  "Slide up",
  "Slide down",
  "Rise",
  "Blur in",
  "Spin in",
];
const subAnimations = ["None","Pop","Bounce","Fade","Slide up","Slide down","Zoom","Rise","Blur in","Spin in","Typewriter","Shake","Glow"];
const clipIcon = (o) => (o.kind === "video" ? <Video size={13} /> : o.kind === "image" ? <ImagePlus size={13} /> : o.kind === "shape" ? <Shapes size={13} /> : o.kind === "subtitle" ? <Subtitles size={13} /> : o.kind === "sfx" ? (o.music ? <Music2 size={13} /> : <Volume2 size={13} />) : <Type size={13} />);
const GAMEPLAY = [
  { id: "subway-01", name: "Subway Surfers", len: "0:40", src: "/media/fake-text-gameplay/subway-01.mp4", thumb: "/media/fake-text-gameplay/subway-01.jpg" },
  { id: "minecraft-01", name: "Minecraft", len: "0:40", src: "/media/fake-text-gameplay/minecraft-01.mp4", thumb: "/media/fake-text-gameplay/minecraft-01.jpg" },
  { id: "gta-01", name: "Driving", len: "0:40", src: "/media/fake-text-gameplay/gta-01.mp4", thumb: "/media/fake-text-gameplay/gta-01.jpg" },
  { id: "trackmania-01", name: "Trackmania", len: "1:00", src: "/media/fake-text-gameplay/trackmania-01.mp4", thumb: "/media/fake-text-gameplay/trackmania-01.jpg" },
];
const anchors = [
  "Free",
  "Top",
  "Upper third",
  "Center",
  "Lower third",
  "Bottom",
  "Above subject",
  "Below subject",
];
const applyCase = (word, mode) => mode === "upper" ? word.toUpperCase() : mode === "lower" ? word.toLowerCase() : mode === "title" ? word.charAt(0).toUpperCase() + word.slice(1) : word;
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const fmt = (n) =>
  `00:${Math.floor(n).toString().padStart(2, "0")}.${Math.floor((n % 1) * 100)
    .toString()
    .padStart(2, "0")}`;
const preset = (kind, extra = {}) => ({
  id: crypto.randomUUID(),
  kind,
  name:
    kind === "text"
      ? "Add text"
      : kind === "subtitle"
        ? "Subtitles"
        : kind === "shape"
          ? "Rectangle"
          : kind === "image"
            ? "Image"
            : "Video",
  text: kind === "subtitle" ? "Make every second count" : "Add text",
  src: "",
  start: 0,
  sourceOffset: 0,
  duration: DEFAULT_DURATION,
  x: 50,
  y: kind === "subtitle" ? 75 : 50,
  scale: 100,
  rotation: 0,
  opacity: 100,
  fit: "Cover",
  flipH: false,
  flipV: false,
  width: 55,
  height: 18,
  color: "#ffffff",
  font: "Arial",
  fontSize: 90,
  bold: false,
  align: "center",
  outline: 0,
  outlineColor: "#000000",
  shadow: 0,
  shadowColor: "#000000",
  styleId: 2,
  captionMode: "Word",
  customColors: false,
  appearedColor: "#ffffff",
  activeColor: "#ffffff",
  emphasisColor: "#f7e44b",
  preserveColor: false,
  animation: kind === "subtitle" ? "Pop" : "None",
  animationPhase: "In",
  animationSpeed: 0.5,
  anchor: "Free",
  keyframes: {},
  ...extra,
});
function subtitleFrame(layer, time) {
  const words = String(layer.text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return { words: [], active: 0, progress: 1 };
  const slot = Math.max(0.08, layer.duration / words.length),
    elapsed = clamp(time - layer.start, 0, Math.max(0, layer.duration - 0.001)),
    index = Math.min(words.length - 1, Math.floor(elapsed / slot)),
    start = layer.captionMode === "Lines" ? Math.floor(index / 4) * 4 : index;
  return {
    words: words.slice(
      start,
      layer.captionMode === "Lines" ? start + 4 : start + 1,
    ),
    active: index - start,
    progress: (elapsed - index * slot) / slot,
  };
}
let evalCtx = null;
export const setEvalCtx = (ctx) => { evalCtx = ctx; };
const valueAt = (layer, key, time) => sampleProperty(layer, key, time, evalCtx);
const NUMERIC_POSE = ["x", "y", "scale", "rotation", "opacity", "blur", "glow", "brightness", "contrast", "saturation", "hue", "reveal", "cornerRadius", "skewX", "strokeWidth", "shadowBlur", "letterSpacing", "anchorX", "anchorY", "vignette", "arc"];
/** Curved motion paths: a parabolic bend added between two consecutive position keyframes. */
function bendFrames(layer) {
  const fx = [...(layer.keyframes?.x || [])].sort((a, b) => a.time - b.time), fy = [...(layer.keyframes?.y || [])].sort((a, b) => a.time - b.time);
  return fx.length >= 2 ? fx : fy.length >= 2 ? fy : [];
}
function pathBendOffset(layer, time, size) {
  if (!layer.pathBend) return [0, 0];
  const frames = bendFrames(layer), i = frames.findIndex((f, n) => n < frames.length - 1 && time >= f.time && time < frames[n + 1].time);
  if (i < 0) return [0, 0];
  const bend = layer.pathBend[frames[i].id];
  if (!bend) return [0, 0];
  const a = frames[i].time, b = frames[i + 1].time, u = (time - a) / (b - a);
  const x0 = (sampleProperty(layer, "x", a, evalCtx) / 100) * size.width, y0 = (sampleProperty(layer, "y", a, evalCtx) / 100) * size.height;
  const x1 = (sampleProperty(layer, "x", b, evalCtx) / 100) * size.width, y1 = (sampleProperty(layer, "y", b, evalCtx) / 100) * size.height;
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1, amount = (bend / 100) * Math.min(size.width, size.height) * 4 * u * (1 - u);
  return [((-dy / len) * amount / size.width) * 100, ((dx / len) * amount / size.height) * 100];
}
const measureCtx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
function measureLayerBox(layer, time, size) {
  const lw = (valueAt(layer, "width", time) / 100) * size.width, lh = (valueAt(layer, "height", time) / 100) * size.height;
  if ((layer.kind !== "text" && layer.kind !== "subtitle") || !measureCtx) return { w: lw, h: lh };
  const fs = Number(valueAt(layer, "fontSize", time)) || layer.fontSize, ctx = measureCtx;
  ctx.font = `${layer.kind === "subtitle" ? "800" : layer.weight || (layer.bold ? "700" : "400")} ${fs}px ${layer.font || "Arial"}`;
  if (layer.kind === "subtitle" && layer.captionMode === "Lines") { const f = subtitleFrame(layer, time), st = LINE_STYLES[layer.styleId] || LINE_STYLES[1]; ctx.font = `${st.italic ? "italic " : ""}${st.weight} ${fs}px ${st.font}`; const w = f.words.reduce((n, x) => n + ctx.measureText(x).width, 0) + ctx.measureText(" ").width * Math.max(0, f.words.length - 1); return { w: w + fs * 0.9, h: fs * 1.5 }; }
  if (layer.kind === "subtitle") { const f = subtitleFrame(layer, time), gap = ctx.measureText(" ").width; return { w: f.words.reduce((n, x) => n + ctx.measureText(applyCase(x, layer.textCase)).width, 0) + gap * Math.max(0, f.words.length - 1) + fs * 0.4, h: fs * 1.3 }; }
  const lines = layoutLines(ctx, layer.text, size.width * 0.82);
  return { w: Math.max(fs * 0.5, ...lines.map((l) => ctx.measureText(l).width)) + fs * 0.3, h: lines.length * fs * 1.13 * (layer.lineHeight || 1) + fs * 0.15 };
}
function animated(layer, time, size = { width: 720, height: 1280 }) {
  const pose = {};
  for (const key of NUMERIC_POSE) pose[key] = Number(valueAt(layer, key, time));
  let { x, y, scale, rotation, opacity } = pose;
  const rel = time - layer.start,
    edge = Math.min(1, Math.max(0, layer.animationSpeed || 0.5));
  let p = 1;
  if (layer.animationPhase === "In") p = clamp(rel / edge, 0, 1);
  if (layer.animationPhase === "Out")
    p = clamp((layer.start + layer.duration - time) / edge, 0, 1);
  if (layer.animationPhase === "Loop")
    p = (Math.sin((rel * Math.PI * 2) / (edge * 2)) + 1) / 2;
  if (layer.animation !== "None") {
    if (layer.animation === "Fade" || layer.animation === "Blur in")
      opacity *= p;
    if (["Scale", "Pop", "Zoom", "Jump"].includes(layer.animation))
      scale *=
        layer.animation === "Pop"
          ? 0.65 + 0.35 * (1 - Math.pow(1 - p, 3))
          : 0.75 + 0.25 * p;
    if (["Slide", "Slide up", "Slide down", "Jump", "Rise"].includes(layer.animation))
      y += (layer.animation === "Slide down" ? -1 : 1) * (1 - p) * 15;
    if (layer.animation === "Spin in") rotation += (1 - p) * -90;
  }
  const [bx, by] = pathBendOffset(layer, time, size);
  return { ...pose, x: x + bx, y: y + by, scale, rotation, opacity };
}
/** Pose in canvas space including parent transforms (child x/y are offsets from the parent's centre). */
function worldPose(layer, time, byId, size, depth = 0) {
  const pose = animated(layer, time, size), parent = layer.parentId && depth < 6 ? byId?.get(layer.parentId) : null;
  if (!parent) return pose;
  const pp = worldPose(parent, time, byId, size, depth + 1), k = pp.scale / 100, rad = (pp.rotation * Math.PI) / 180;
  const ox = ((pose.x - 50) / 100) * size.width * k, oy = ((pose.y - 50) / 100) * size.height * k;
  const wx = (pp.x / 100) * size.width + ox * Math.cos(rad) - oy * Math.sin(rad), wy = (pp.y / 100) * size.height + ox * Math.sin(rad) + oy * Math.cos(rad);
  return { ...pose, x: (wx / size.width) * 100, y: (wy / size.height) * 100, scale: pose.scale * k, rotation: pose.rotation + pp.rotation, opacity: (pose.opacity * pp.opacity) / 100 };
}
function formatCounter(text, fraction) {
  const m = /-?\d[\d,]*\.?\d*/.exec(text);
  if (!m) return text;
  const raw = m[0], target = parseFloat(raw.replace(/,/g, "")), decimals = (raw.split(".")[1] || "").length;
  let out = (target * clamp(fraction, 0, 1)).toFixed(decimals);
  if (raw.includes(",")) { const [i, d] = out.split("."); out = i.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (d ? "." + d : ""); }
  return text.replace(raw, out);
}
function textUnitEffect(ctx, effect, p) {
  const e = easingAt(p, effect === "bounce" ? "Bounce" : effect === "pop" ? "Back" : "Ease out");
  if (effect === "pop") ctx.scale(Math.max(0, e), Math.max(0, e));
  else if (effect === "rise") ctx.translate(0, (1 - e) * 36);
  else if (effect === "drop") ctx.translate(0, -(1 - e) * 46);
  else if (effect === "bounce") ctx.translate(0, -(1 - e) * 60);
  else if (effect === "spin") ctx.rotate((1 - e) * -1.4);
  ctx.globalAlpha *= clamp(p * 1.6, 0, 1);
}
function drawImageCover(ctx, img, x, y, w, h, fit = "Cover") {
  if (!img?.naturalWidth && !img?.videoWidth) return;
  const iw = img.videoWidth || img.naturalWidth,
    ih = img.videoHeight || img.naturalHeight;
  if (fit === "Contain") {
    const ratio = Math.min(w / iw, h / ih);
    const dw = iw * ratio, dh = ih * ratio;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    return;
  }
  const ratio = Math.max(w / iw, h / ih),
    sw = w / ratio,
    sh = h / ratio;
  ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
}
function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  ctx.beginPath();
  if (rr > 0 && ctx.roundRect) ctx.roundRect(x, y, w, h, rr); else ctx.rect(x, y, w, h);
}
/* Crayo "Lines" presets: each has its own face, case, outline/box and active-word colour. No Word-mode motion is applied. */
const IMPACT = "Impact, 'Arial Narrow Bold', 'Haettenschweiler', sans-serif", BLACKF = "'Arial Black', 'Helvetica Neue', Arial, sans-serif", SOFT = "Sora, Poppins, 'Helvetica Neue', Arial, sans-serif", MARKER = "'Marker Felt', 'Chalkboard SE', 'Comic Sans MS', cursive", ROUND = "'Varela Round', 'Arial Rounded MT Bold', 'Trebuchet MS', sans-serif";
const LINE_STYLES = {
  1: { font: SOFT, weight: 700, fill: "#fff", active: "#fff", shadow: ["rgba(0,0,0,.85)", 18] },
  7: { font: SOFT, weight: 600, fill: "#fff", active: "#fff", stroke: "#b9bec8", strokeW: 0.05 },
  3: { font: IMPACT, weight: 400, italic: true, upper: true, fill: "#fff", active: "#1d5cff", stroke: "#000", strokeW: 0.09, drop: 4 },
  6: { font: SOFT, weight: 500, fill: "#0d0f14", active: "#0d0f14", box: ["#ececec", 0.28] },
  67: { font: MARKER, weight: 800, italic: true, upper: true, fill: "#fff", active: "#fff", stroke: "#000", strokeW: 0.14 },
  8: { font: SOFT, weight: 400, fill: "#ffff1a", active: "#ffff1a", glow: ["#ffff1a", 26] },
  34: { font: IMPACT, weight: 400, italic: true, upper: true, fill: "#fff", active: "#e0222a", stroke: "#000", strokeW: 0.1, drop: 4 },
  37: { font: BLACKF, weight: 900, upper: true, fill: "#fff", active: "#f2d31a", stroke: "#000", strokeW: 0.11 },
  61: { font: BLACKF, weight: 900, upper: true, fill: "#22e5e5", active: "#22e5e5" },
  66: { font: BLACKF, weight: 900, upper: true, fill: "#fff", active: "#a6f24a", stroke: "#000", strokeW: 0.13 },
  104: { font: ROUND, weight: 800, fill: "#fff", active: "#ffc872", stroke: "#e0596b", strokeW: 0.09 },
  114: { font: IMPACT, weight: 400, italic: true, upper: true, fill: "#fff", active: "#f0a3b8", stroke: "#d8d8e0", strokeW: 0.03 },
  122: { font: BLACKF, weight: 900, upper: true, fill: "#fff", active: "#fff", stroke: "#000", strokeW: 0.08 },
  131: { font: BLACKF, weight: 900, upper: true, fill: "#fff", active: "#fff", box: ["#1a7bf0", 0.22], shadow: ["rgba(0,0,0,.5)", 8] },
  157: { font: SOFT, weight: 700, fill: "#fff", active: "#fff", box: ["#000", 0.2] },
  208: { font: "Arial, sans-serif", weight: 700, upper: true, fill: "#fff", active: "#b9a8ff", glow: ["#ffffff", 14] },
};
export { LINE_STYLES };
function drawLineSubtitle(ctx, layer, frame, fontSize, px) {
  const st = LINE_STYLES[layer.styleId] || LINE_STYLES[1], custom = layer.customColors;
  const caseMode = layer.textCase === "upper" || layer.textCase === "lower" ? layer.textCase : st.upper ? "upper" : "none";
  const words = frame.words.map((w) => applyCase(w, caseMode));
  ctx.font = `${st.italic ? "italic " : ""}${st.weight} ${fontSize}px ${layer.font && layer.font !== "Arial" ? layer.font + ", " : ""}${st.font}`;
  ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
  const gap = ctx.measureText(" ").width, widths = words.map((w) => ctx.measureText(w).width), total = widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, words.length - 1);
  if (st.box) { const padX = fontSize * st.box[1] * 1.3, padY = fontSize * st.box[1]; ctx.save(); ctx.shadowColor = "transparent"; ctx.fillStyle = st.box[0]; roundRectPath(ctx, -total / 2 - padX, -fontSize * 0.62 - padY * 0.2, total + padX * 2, fontSize * 1.24 + padY * 0.4, fontSize * 0.2); ctx.fill(); ctx.restore(); }
  let cursor = -total / 2;
  words.forEach((word, i) => {
    const active = i === frame.active, fill = custom ? (active ? layer.activeColor : layer.appearedColor) : active ? st.active : st.fill;
    ctx.save();
    if (st.shadow) { ctx.shadowColor = st.shadow[0]; ctx.shadowBlur = st.shadow[1] * px; ctx.shadowOffsetY = 3 * px; }
    if (st.glow) { ctx.shadowColor = st.glow[0]; ctx.shadowBlur = st.glow[1] * px; ctx.shadowOffsetY = 0; }
    if (st.drop) { ctx.fillStyle = "#000"; ctx.fillText(word, cursor + st.drop * px, st.drop * px); }
    if (st.stroke) { ctx.lineWidth = fontSize * st.strokeW; ctx.strokeStyle = custom ? layer.outlineColor : st.stroke; ctx.strokeText(word, cursor, 0); }
    ctx.shadowColor = st.stroke || st.drop ? "transparent" : ctx.shadowColor;
    ctx.fillStyle = fill; ctx.fillText(word, cursor, 0);
    ctx.restore();
    cursor += widths[i] + gap;
  });
}
const LUT_LOOKS = { None: {}, Warm: { brightness: 104, contrast: 104, saturate: 118, hue: -8, sepia: 0.12 }, Cool: { brightness: 100, contrast: 104, saturate: 104, hue: 14 }, Vintage: { brightness: 98, contrast: 108, saturate: 72, sepia: 0.38, hue: -10 }, Noir: { contrast: 130, saturate: 0, brightness: 96 }, Vivid: { contrast: 114, saturate: 150, brightness: 102 }, Faded: { contrast: 86, saturate: 82, brightness: 112 }, "Teal & Orange": { contrast: 112, saturate: 130, hue: -14, sepia: 0.1 }, Cinematic: { contrast: 118, saturate: 92, brightness: 94, hue: 6, sepia: 0.08 } };
function lutParts(lut) {
  const look = LUT_LOOKS[lut?.name], k = Math.max(0, Math.min(1, (lut?.intensity ?? 100) / 100)), parts = [];
  if (!look) return parts;
  const mix = (v) => 100 + (v - 100) * k;
  if (look.brightness) parts.push(`brightness(${mix(look.brightness).toFixed(1)}%)`);
  if (look.contrast) parts.push(`contrast(${mix(look.contrast).toFixed(1)}%)`);
  if (look.saturate !== undefined) parts.push(`saturate(${mix(look.saturate).toFixed(1)}%)`);
  if (look.hue) parts.push(`hue-rotate(${(look.hue * k).toFixed(1)}deg)`);
  if (look.sepia) parts.push(`sepia(${(look.sepia * k).toFixed(2)})`);
  return parts;
}
const lutCss = (name, intensity) => lutParts({ name, intensity }).join(" ") || "none";
const BLEND = { normal: "source-over", multiply: "multiply", screen: "screen", overlay: "overlay", darken: "darken", lighten: "lighten", add: "lighter", difference: "difference" };
function shapePath(ctx, type, w, h, radius, sides) {
  ctx.beginPath();
  if (type === "ellipse") { ctx.ellipse(0, 0, Math.abs(w) / 2, Math.abs(h) / 2, 0, 0, Math.PI * 2); return; }
  if (type === "line" || type === "arrow") {
    ctx.moveTo(-w / 2, 0); ctx.lineTo(w / 2, 0);
    if (type === "arrow") { const hs = Math.min(Math.abs(w) * 0.2, 60); ctx.moveTo(w / 2 - hs, -hs * 0.7); ctx.lineTo(w / 2, 0); ctx.lineTo(w / 2 - hs, hs * 0.7); }
    return;
  }
  if (type === "polygon" || type === "star") {
    const n = type === "star" ? 5 : Math.max(3, Math.round(sides || 3)), pts = type === "star" ? n * 2 : n;
    for (let i = 0; i < pts; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / pts, k = type === "star" && i % 2 ? 0.45 : 1;
      const x = Math.cos(a) * (w / 2) * k, y = Math.sin(a) * (h / 2) * k;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
    return;
  }
  roundRectPath(ctx, -w / 2, -h / 2, w, h, radius);
}
function layoutLines(ctx, text, maxWidth) {
  const lines = [];
  for (const raw of String(text || "").split("\n")) {
    let line = "";
    for (const word of raw.split(" ")) {
      const next = line ? line + " " + word : word;
      if (ctx.measureText(next).width > maxWidth && line) { lines.push(line); line = word; } else line = next;
    }
    lines.push(line);
  }
  return lines;
}
/* Word / letter / line staggered text. Every unit's progress is a pure function of timeline time. */
function drawAnimatedText(ctx, layer, lines, lineH, time, fill, edge, p) {
  const ta = layer.textAnim, units = [];
  lines.forEach((line, li) => {
    const yy = (li - (lines.length - 1) / 2) * lineH, lw = ctx.measureText(line).width;
    if (ta.mode === "line") units.push({ text: line, x: -lw / 2, y: yy, li });
    else if (ta.mode === "word") { let cursor = 0; line.split(" ").forEach((w) => { units.push({ text: w, x: -lw / 2 + cursor, y: yy, li }); cursor += ctx.measureText(w + " ").width; }); }
    else for (let i = 0; i < line.length; i++) units.push({ text: line[i], x: -lw / 2 + ctx.measureText(line.slice(0, i)).width, y: yy, li });
  });
  const dur = Math.max(0.05, ta.duration ?? 0.35), n = units.length,
    stagger = ta.fit ? Math.max(0.01, (layer.duration * 0.85 - dur) / Math.max(1, n - 1)) : Math.max(0.005, ta.stagger ?? 0.08),
    begin = layer.start + (ta.delay || 0);
  let activeIndex = -1;
  units.forEach((u, i) => { if (time >= begin + i * stagger) activeIndex = i; });
  ctx.textAlign = "left";
  units.forEach((u, i) => {
    const prog = clamp((time - begin - i * stagger) / dur, 0, 1);
    if (prog <= 0) return;
    const w = ctx.measureText(u.text).width;
    ctx.save();
    ctx.translate(u.x + w / 2, u.y);
    textUnitEffect(ctx, ta.effect || "pop", prog);
    ctx.translate(-w / 2, 0);
    const hot = ta.highlight && i === activeIndex;
    if (layer.outline) { ctx.lineWidth = layer.outline; ctx.strokeStyle = edge; ctx.strokeText(u.text, 0, 0); }
    if (hot) { ctx.shadowColor = ta.highlightColor || "#ffe14d"; ctx.shadowBlur = 24; ctx.shadowOffsetY = 0; }
    ctx.fillStyle = hot ? ta.highlightColor || "#ffe14d" : fill;
    ctx.fillText(u.text, 0, 0);
    ctx.restore();
  });
}
let maskCanvas = null;
function applyChroma(o, size, chroma) {
  const img = o.getImageData(0, 0, size.width, size.height), d = img.data, k = parseInt(String(chroma.color || "#00ff00").slice(1), 16);
  const kr = (k >> 16) & 255, kg = (k >> 8) & 255, kb = k & 255, tol = chroma.tolerance ?? 0.35, soft = Math.max(0.001, chroma.softness ?? 0.12);
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const dist = Math.hypot(d[i] - kr, d[i + 1] - kg, d[i + 2] - kb) / 441.67, f = dist <= tol ? 0 : Math.min(1, (dist - tol) / soft);
    d[i + 3] *= f;
    if (f > 0 && f < 1 && kg > kr && kg > kb) d[i + 1] = Math.min(d[i + 1], (d[i] + d[i + 2]) / 2 + 8);
  }
  o.putImageData(img, 0, 0);
}
function drawMasked(ctx, layer, time, media, size, byId) {
  if (!maskCanvas || maskCanvas.width !== size.width || maskCanvas.height !== size.height) { maskCanvas = document.createElement("canvas"); maskCanvas.width = size.width; maskCanvas.height = size.height; }
  const o = maskCanvas.getContext("2d", { willReadFrequently: true });
  o.setTransform(1, 0, 0, 1, 0, 0); o.globalCompositeOperation = "source-over"; o.globalAlpha = 1; o.filter = "none"; o.clearRect(0, 0, size.width, size.height);
  drawLayer(o, { ...layer, mask: null, chroma: null }, time, media, size, byId);
  if (layer.chroma?.on) applyChroma(o, size, layer.chroma);
  if (layer.mask && layer.mask.type && layer.mask.type !== "none") {
    const p = worldPose(layer, time, byId, size), box = measureLayerBox(layer, time, size), px = size.width / 720;
    o.save();
    o.translate((p.x / 100) * size.width, (p.y / 100) * size.height); o.rotate((p.rotation * Math.PI) / 180); o.scale(p.scale / 100, p.scale / 100); o.translate(-(p.anchorX / 100) * box.w, -(p.anchorY / 100) * box.h);
    const mw = (box.w * valueAt(layer, "maskW", time)) / 100, mh = (box.h * valueAt(layer, "maskH", time)) / 100, mx = (box.w * valueAt(layer, "maskX", time)) / 100, my = (box.h * valueAt(layer, "maskY", time)) / 100, feather = valueAt(layer, "maskFeather", time);
    o.globalCompositeOperation = layer.mask.invert ? "destination-out" : "destination-in";
    if (feather > 0.2) o.filter = `blur(${(feather * px).toFixed(1)}px)`;
    o.fillStyle = "#000";
    o.beginPath();
    if (layer.mask.type === "ellipse") o.ellipse(mx, my, Math.abs(mw) / 2, Math.abs(mh) / 2, 0, 0, Math.PI * 2); else o.rect(mx - mw / 2, my - mh / 2, mw, mh);
    o.fill();
    o.restore();
  }
  ctx.drawImage(maskCanvas, 0, 0);
}
function drawLayer(ctx, layer, time, media, size, byId) {
  if (layer.kind === "sfx" || layer.hidden) return;
  if (time < layer.start || time > layer.start + layer.duration) return;
  if ((layer.mask && layer.mask.type && layer.mask.type !== "none") || layer.chroma?.on) { drawMasked(ctx, layer, time, media, size, byId); return; }
  const { width: W, height: H } = size,
    p = worldPose(layer, time, byId, size),
    px = W / 720;
  ctx.save();
  ctx.globalAlpha = clamp(p.opacity / 100, 0, 1);
  if (layer.blend && BLEND[layer.blend]) ctx.globalCompositeOperation = BLEND[layer.blend];
  const filters = [];
  if (p.blur > 0.05) filters.push(`blur(${(p.blur * px).toFixed(2)}px)`);
  if (Math.abs(p.brightness - 100) > 0.5) filters.push(`brightness(${p.brightness}%)`);
  if (Math.abs(p.contrast - 100) > 0.5) filters.push(`contrast(${p.contrast}%)`);
  if (Math.abs(p.saturation - 100) > 0.5) filters.push(`saturate(${p.saturation}%)`);
  if (Math.abs(p.hue) > 0.5) filters.push(`hue-rotate(${p.hue}deg)`);
  filters.push(...lutParts(layer.lut));
  if (filters.length) ctx.filter = filters.join(" ");
  ctx.translate((p.x / 100) * W, (p.y / 100) * H);
  ctx.rotate((p.rotation * Math.PI) / 180);
  if (p.skewX) ctx.transform(1, 0, Math.tan((p.skewX * Math.PI) / 180), 1, 0, 0);
  ctx.scale((p.scale / 100) * (layer.flipH ? -1 : 1), (p.scale / 100) * (layer.flipV ? -1 : 1));
  if (p.anchorX || p.anchorY) { const ab = measureLayerBox(layer, time, size); ctx.translate(-(p.anchorX / 100) * ab.w, -(p.anchorY / 100) * ab.h); }
  const lw = (valueAt(layer, "width", time) / 100) * W,
    lh = (valueAt(layer, "height", time) / 100) * H,
    radius = (p.cornerRadius / 100) * Math.min(lw, lh) / 2,
    glowColor = layer.glowColor || (layer.kind === "shape" ? valueAt(layer, "color", time) : "#ffffff");
  const reveal = clamp(p.reveal, 0, 100) / 100;
  if (p.glow > 0.5) { ctx.shadowColor = glowColor; ctx.shadowBlur = p.glow * px; ctx.shadowOffsetY = 0; }
  else if (p.shadowBlur > 0.5) { ctx.shadowColor = layer.shadowColor || "#000000"; ctx.shadowBlur = p.shadowBlur * px; ctx.shadowOffsetY = 6 * px; }
  if (reveal < 1 && layer.kind !== "text" && layer.kind !== "subtitle") { ctx.beginPath(); ctx.rect(-lw / 2, -lh / 2, lw * reveal, lh); ctx.clip(); }
  if (layer.kind === "shape") {
    const type = layer.shapeType || "rect", lineLike = type === "line" || type === "arrow", main = valueAt(layer, "color", time);
    shapePath(ctx, type, lw, lh, radius, layer.sides);
    if (layer.dash > 0) ctx.setLineDash([layer.dash * px * 2, layer.dash * px * 1.5]);
    if (lineLike) { ctx.lineWidth = Math.max(2, p.strokeWidth || 8) * px; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = main; ctx.stroke(); }
    else {
      if (layer.gradient) { const g = ctx.createLinearGradient(-lw / 2, -lh / 2, lw / 2, lh / 2); g.addColorStop(0, main); g.addColorStop(1, valueAt(layer, "color2", time) || "#8b5cf6"); ctx.fillStyle = g; }
      else ctx.fillStyle = main;
      ctx.fill();
      if (p.strokeWidth > 0.2) { ctx.shadowColor = "transparent"; ctx.lineWidth = p.strokeWidth * px; ctx.strokeStyle = valueAt(layer, "strokeColor", time) || "#000"; ctx.stroke(); }
    }
    ctx.setLineDash([]);
  }
  if (layer.kind === "image" || layer.kind === "video") {
    const asset = media.get(layer.id) || media.get(layer.src);
    if (asset) {
      if (radius > 0) { roundRectPath(ctx, -lw / 2, -lh / 2, lw, lh, radius); ctx.save(); ctx.clip(); }
      drawImageCover(ctx, asset, -lw / 2, -lh / 2, lw, lh, layer.fit);
      if (p.vignette > 0.5) { ctx.save(); ctx.shadowColor = "transparent"; const g = ctx.createRadialGradient(0, 0, Math.min(lw, lh) * 0.2, 0, 0, Math.hypot(lw, lh) / 2); g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, `rgba(0,0,0,${Math.min(0.95, p.vignette / 100)})`); ctx.fillStyle = g; ctx.fillRect(-lw / 2, -lh / 2, lw, lh); ctx.restore(); }
      if (radius > 0) ctx.restore();
    }
  }
  if (layer.kind === "text" || layer.kind === "subtitle") {
    const [presetFill, presetEdge] =
        layer.kind === "subtitle"
          ? captionPaint[layer.styleId] || captionPaint[2]
          : [valueAt(layer, "color", time), layer.outlineColor],
      fill =
        layer.kind === "subtitle" && layer.customColors
          ? layer.activeColor
          : presetFill,
      edge =
        layer.kind === "subtitle" && layer.customColors
          ? layer.outlineColor
          : presetEdge;
    ctx.textAlign = layer.align || "center";
    ctx.textBaseline = "middle";
    const fontSize = Number(valueAt(layer, "fontSize", time)) || layer.fontSize;
    ctx.font = `${layer.kind === "subtitle" ? "800" : layer.weight || (layer.bold ? "700" : "400")} ${fontSize}px ${layer.font || "Arial"}`;
    if ("letterSpacing" in ctx) ctx.letterSpacing = `${p.letterSpacing * px}px`;
    if (!(p.glow > 0.5) && !(p.shadowBlur > 0.5)) {
      ctx.shadowColor = layer.shadow ? layer.shadowColor : "#000000";
      ctx.shadowBlur = layer.shadow || 0;
      ctx.shadowOffsetY = layer.shadow ? 7 : 0;
    }
    ctx.lineJoin = "round";
    if (layer.kind === "subtitle" && layer.captionMode === "Lines") {
      drawLineSubtitle(ctx, layer, subtitleFrame(layer, time), fontSize, px);
    } else if (layer.kind === "subtitle") {
      const frame = subtitleFrame(layer, time),
        parts = frame.words,
        gap = ctx.measureText(" ").width,
        total =
          parts.reduce((n, word) => n + ctx.measureText(applyCase(word, layer.textCase)).width, 0) +
          gap * Math.max(0, parts.length - 1);
      let cursor = -total / 2;
      ctx.textAlign = "center";
      parts.forEach((rawWord, i) => {
        let word = applyCase(rawWord, layer.textCase);
        const width = ctx.measureText(word).width,
          active = i === frame.active;
        ctx.save();
        ctx.translate(cursor + width / 2, 0);
        if (active) {
          const entry = clamp(
            frame.progress / Math.max(0.08, layer.animationSpeed),
            0,
            1,
          );
          if (
            layer.animation === "Pop" ||
            layer.animation === "Scale" ||
            layer.animation === "Zoom"
          )
            ctx.scale(0.82 + 0.18 * entry, 0.82 + 0.18 * entry);
          if (layer.animation === "Jump" || layer.animation === "Slide up" || layer.animation === "Rise")
            ctx.translate(0, (1 - entry) * 18);
          if (layer.animation === "Slide down")
            ctx.translate(0, -(1 - entry) * 18);
          if (layer.animation === "Fade" || layer.animation === "Blur in")
            ctx.globalAlpha *= entry;
          if (layer.animation === "Spin in") ctx.rotate((1 - entry) * -0.16);
          if (layer.animation === "Bounce") { const k = easingAt(entry, "Bounce"); ctx.translate(0, -(1 - k) * 46); ctx.scale(0.9 + 0.1 * k, 1.12 - 0.12 * k); }
          if (layer.animation === "Shake") ctx.translate(Math.sin(frame.progress * 60) * 6 * (1 - entry * 0.5), 0);
          if (layer.animation === "Glow") { ctx.shadowColor = fill; ctx.shadowBlur = 28 * (0.6 + 0.4 * Math.sin(frame.progress * Math.PI)); ctx.shadowOffsetY = 0; }
          if (layer.animation === "Typewriter") word = word.slice(0, Math.max(1, Math.ceil(word.length * entry)));
        }
        if (layer.outline !== -1) {
          ctx.lineWidth =
            layer.outline > 0
              ? layer.outline
              : Math.max(4, layer.fontSize * 0.09);
          ctx.strokeStyle = edge;
          ctx.strokeText(word, 0, 0);
        }
        ctx.fillStyle = active
          ? layer.customColors && frame.progress < 0.22
            ? layer.emphasisColor
            : layer.captionMode === "Lines" && !layer.customColors
              ? "#4d7aff"
              : fill
          : layer.preserveColor
            ? fill
            : layer.customColors
              ? layer.appearedColor
              : presetFill;
        ctx.fillText(word, 0, 0);
        ctx.restore();
        cursor += width + gap;
      });
    } else {
      let content = layer.kind === "text" && layer.textCase === "upper" ? String(layer.text || "").toUpperCase() : layer.kind === "text" && layer.textCase === "lower" ? String(layer.text || "").toLowerCase() : layer.text;
      if (layer.keyframes?.counter?.length) content = formatCounter(String(layer.text || ""), valueAt(layer, "counter", time) / 100);
      const lines = layoutLines(ctx, content, W * 0.82), lineH = fontSize * 1.13 * (layer.lineHeight || 1);
      if (reveal < 1) {
        let allowed = Math.round(lines.join("").length * reveal);
        for (let i = 0; i < lines.length; i++) { const keep = Math.max(0, Math.min(lines[i].length, allowed)); allowed -= lines[i].length; lines[i] = lines[i].slice(0, keep); }
      }
      if (layer.textAnim && layer.textAnim.mode && layer.textAnim.mode !== "none") drawAnimatedText(ctx, layer, lines, lineH, time, fill, edge, p);
      else if (Math.abs(p.arc) > 0.5) lines.forEach((line, i) => {
        const yy = (i - (lines.length - 1) / 2) * lineH, w = ctx.measureText(line).width, theta = (p.arc * Math.PI) / 180, r = w / theta;
        ctx.textAlign = "center";
        for (let c = 0; c < line.length; c++) {
          const s = ctx.measureText(line.slice(0, c)).width, cw = ctx.measureText(line[c]).width, ang = (s + cw / 2 - w / 2) / r;
          ctx.save(); ctx.translate(Math.sin(ang) * r, yy + r - Math.cos(ang) * r); ctx.rotate(ang);
          if (layer.outline) { ctx.lineWidth = layer.outline; ctx.strokeStyle = edge; ctx.strokeText(line[c], 0, 0); }
          ctx.fillStyle = fill; ctx.fillText(line[c], 0, 0); ctx.restore();
        }
      });
      else lines.forEach((line, i) => {
        const yy = (i - (lines.length - 1) / 2) * lineH;
        if (layer.outline) {
          ctx.lineWidth = layer.outline;
          ctx.strokeStyle = edge;
          ctx.strokeText(line, 0, yy);
        }
        ctx.fillStyle = fill;
        ctx.fillText(line, 0, yy);
        if (layer.underline || layer.strike) {
          const w = ctx.measureText(line).width, lx = layer.align === "left" ? 0 : layer.align === "right" ? -w : -w / 2;
          ctx.save(); ctx.shadowColor = "transparent"; ctx.fillStyle = fill;
          if (layer.underline) ctx.fillRect(lx, yy + fontSize * 0.5, w, Math.max(2, fontSize / 18));
          if (layer.strike) ctx.fillRect(lx, yy - fontSize * 0.04, w, Math.max(2, fontSize / 18));
          ctx.restore();
        }
      });
    }
  }
  ctx.restore();
}
function loadEditorProject(projectId) {
  try { return JSON.parse(localStorage.getItem(`frame-editor-${projectId || 'scratch'}`) || 'null'); }
  catch { return null; }
}
function useProjectHistory(initialLayers = []) {
  const [layers, setLayers] = useState(() => initialLayers),
    past = useRef([]),
    future = useRef([]),
    [revision, setRevision] = useState(0);
  const change = useCallback((fn) => {
    setLayers((old) => {
      past.current.push(old);
      if (past.current.length > 80) past.current.shift();
      future.current = [];
      setRevision((r) => r + 1);
      return typeof fn === "function" ? fn(old) : fn;
    });
  }, []);
  const preview = useCallback((fn) => setLayers((old) => typeof fn === "function" ? fn(old) : fn), []);
  const commitPreview = useCallback((before) => {
    past.current.push(before);
    if (past.current.length > 80) past.current.shift();
    future.current = [];
    setRevision((r) => r + 1);
  }, []);
  const undo = () =>
    setLayers((old) => {
      if (!past.current.length) return old;
      future.current.push(old);
      setRevision((r) => r + 1);
      return past.current.pop();
    });
  const redo = () =>
    setLayers((old) => {
      if (!future.current.length) return old;
      past.current.push(old);
      setRevision((r) => r + 1);
      return future.current.pop();
    });
  return { layers, change, preview, commitPreview, undo, redo, revision };
}
export default function AdvancedEditor({ go, projectId, initialName, onTitleChange }) {
  const saved = useMemo(() => loadEditorProject(projectId), [projectId]);
  const { layers, change, preview, commitPreview, undo, redo } = useProjectHistory((saved?.layers || []).map(migrateLayer));
  const [section, setSection] = useState("Media"),
    [selected, setSelected] = useState(null),
    [multiSelected, setMultiSelected] = useState([]),
    [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false),
    [duration, setDuration] = useState(saved?.duration || DEFAULT_DURATION),
    [aspect, setAspect] = useState(saved?.aspect || "9:16"),
    [title, setTitle] = useState(saved?.title || initialName || "Untitled Video"),
    [subTab, setSubTab] = useState("Edit"),
    [subtitleEntry, setSubtitleEntry] = useState(true),
    [subtitleChoice, setSubtitleChoice] = useState("manual"),
    [subStyle, setSubStyle] = useState(() => saved?.subStyle || { font: "Arial", fontSize: 90, outline: 0, shadow: 0, textCase: "title", styleId: 2, captionMode: "Word", customColors: false, appearedColor: "#ffffff", activeColor: "#ffffff", emphasisColor: "#f7e44b", outlineColor: "#000000", preserveColor: false, animation: "Pop", animationSpeed: 0.5, x: 50, y: 50, anchor: "Center" }),
    [styleMode, setStyleMode] = useState("Word"),
    [inspectorTab, setInspectorTab] = useState("Style"),
    [effectsTab, setEffectsTab] = useState("LUTs"),
    [category, setCategory] = useState("All"),
    [videoBrowse, setVideoBrowse] = useState(false),
    [search, setSearch] = useState(""),
    [zoom, setZoom] = useState(50),
    [showSafe, setShowSafe] = useState(false),
    [autoKey, setAutoKey] = useState(false),
    [modal, setModal] = useState(""),
    [exportStatus, setExportStatus] = useState(""),
    [exportProgress, setExportProgress] = useState(0),
    [audioSrc, setAudioSrc] = useState(""),
    [markers, setMarkers] = useState(() => (saved?.markers || []).map(marker => typeof marker === 'number' ? {id:crypto.randomUUID(),time:marker,name:'',color:'#4e70ef'} : marker)),
    [selectedMarker, setSelectedMarker] = useState(null),
    [missingMedia] = useState(saved?.missingMedia || 0),
    [isDragging, setIsDragging] = useState(false),
    [uiMode, setUiMode] = useState(() => { try { return localStorage.getItem("frame-editor-mode") || "basic"; } catch { return "basic"; } }),
    [fps, setFps] = useState(saved?.fps || 30),
    [hasClip, setHasClip] = useState(false),
    [animGuide, setAnimGuide] = useState(null),
    [expanded, setExpanded] = useState({}),
    [selKf, setSelKf] = useState([]),
    [graphOpen, setGraphOpen] = useState(false),
    [snapOn, setSnapOn] = useState(true),
    [guides, setGuides] = useState([]),
    [kfMenu, setKfMenu] = useState(null),
    [dragId, setDragId] = useState(null),
    [marquee, setMarquee] = useState(null),
    [animClip, setAnimClip] = useState(null),
    [toast, setToast] = useState(""),
    [, setPresetRev] = useState(0),
    [sfxSyncFor, setSfxSyncFor] = useState(null),
    [lutOpen, setLutOpen] = useState(false),
    [lutDraft, setLutDraft] = useState({ name: "Warm", intensity: 80, all: false }),
    [showPath, setShowPath] = useState(true),
    [soundRev, setSoundRev] = useState(0),
    [importMsg, setImportMsg] = useState(""),
    [uploadName, setUploadName] = useState(""),
    [soundEditorFor, setSoundEditorFor] = useState(null),
    [duck, setDuck] = useState(() => saved?.duck || { on: false, level: 0.3 });
  const canvas = useRef(null),
    blurCanvas = useRef(null),
    stage = useRef(null),
    fileInput = useRef(null),
    audioInput = useRef(null),
    audioEl = useRef(null),
    media = useRef(new Map()),
    objectUrls = useRef([]),
    videoElements = useRef(new Map()),
    clock = useRef(time),
    layersRef = useRef(layers),
    exporting = useRef(false),
    exportFrame = useRef(0),
    evalCtxRef = useRef(null),
    byIdCache = useRef({}),
    kfClip = useRef(null),
    kfMulti = useRef(null),
    splitSelectedRef = useRef(null),
    reframeInput = useRef(null),
    tracksRef = useRef(null),
    drag = useRef(null),
    timelineDrag = useRef(null),
    markerDrag = useRef(null),
    markerJustMoved = useRef(false);
  const canvasSize =
    aspect === "16:9"
      ? { width: 1280, height: 720 }
      : aspect === "1:1"
        ? { width: 1080, height: 1080 }
        : { width: 720, height: 1280 };
  const layer = layers.find((x) => x.id === selected) || null;
  const timelineSpan = Math.max(duration, (40 * 50) / Math.max(10, zoom));
  layersRef.current = layers;
  clock.current = time;
  const [audioPcm, setAudioPcm] = useState(null);
  const envCache = useRef(new Map());
  useEffect(() => {
    envCache.current.clear();
    setAudioPcm(null);
    if (!audioSrc) return;
    let dead = false;
    (async () => {
      try {
        const data = await (await fetch(audioSrc)).arrayBuffer(), ac = new (window.AudioContext || window.webkitAudioContext)();
        const buf = await ac.decodeAudioData(data); ac.close();
        if (!dead) setAudioPcm({ samples: buf.getChannelData(0), sr: buf.sampleRate });
      } catch { /* undecodable audio simply disables audio-reactive motion */ }
    })();
    return () => { dead = true; };
  }, [audioSrc]);
  evalCtxRef.current = useMemo(() => {
    if (!audioPcm) return null;
    const envFor = (smoothing) => { const k = `${smoothing}|${fps}`; if (!envCache.current.has(k)) envCache.current.set(k, analyzeEnvelope(audioPcm.samples, audioPcm.sr, fps, { smoothing })); return envCache.current.get(k); };
    return {
      envelope: (t, spec) => {
        const env = envFor(spec.smoothing ?? 0.35), sens = spec.sensitivity ?? 0.55;
        if (spec.mode === "beat") {
          const key = `beats|${sens}|${fps}`; if (!envCache.current.has(key)) envCache.current.set(key, detectBeats(env, fps, sens));
          let v = 0; for (const b of envCache.current.get(key)) { if (b > t) break; v = Math.max(v, Math.exp(-(t - b) * 9)); }
          return v;
        }
        const e = envelopeAt(env, fps, t), floor = (1 - sens) * 0.6;
        return Math.max(0, (e - floor) / (1 - floor));
      },
    };
  }, [audioPcm, fps]);
  useEffect(() => {
    const persistent = layers.filter(item => !item.src?.startsWith('blob:'));
    const transientCount = layers.length - persistent.length;
    try { localStorage.setItem(`frame-editor-${projectId || 'scratch'}`, JSON.stringify({title, aspect, duration, fps, duck, markers, subStyle, layers:persistent, missingMedia:transientCount})); }
    catch { /* Full local storage must not interrupt the active editing session. */ }
  }, [projectId, title, aspect, duration, fps, duck, markers, layers, subStyle]);
  useEffect(() => { if (projectId && onTitleChange) onTitleChange(title); }, [projectId, title]);
  const add = (extra) => {
    const item = preset(extra.kind, extra);
    change((v) => (item.kind === "video" || item.kind === "image" ? [item, ...v] : [...v, item]));
    setSelected(item.id);
    return item;
  };
  const splitSelected = () => {
    if (!selected) return;
    const at = clock.current;
    change((items) => items.flatMap((item) =>
      item.id === selected && at > item.start && at < item.start + item.duration
        ? [{ ...item, duration: at - item.start }, { ...item, id: crypto.randomUUID(), start: at, sourceOffset: (item.sourceOffset || 0) + at - item.start, duration: item.start + item.duration - at }]
        : [item],
    ));
  };
  splitSelectedRef.current = splitSelected;
  const duplicateSelected = () => {
    const item = layersRef.current.find((entry) => entry.id === selected);
    if (!item) return;
    const duplicate = { ...structuredClone(item), id: crypto.randomUUID(), name: `${item.name} copy`, start: Math.min(duration, item.start + .15) };
    change((items) => [...items, duplicate]);
    setSelected(duplicate.id);
  };
  const groupSelected = () => {
    const ids = [...new Set(multiSelected.length ? multiSelected : [selected].filter(Boolean))];
    if (ids.length < 2) return;
    const groupId = crypto.randomUUID();
    change(items => items.map(item => ids.includes(item.id) ? {...item, groupId} : item));
  };
  const ungroupSelected = () => {
    const groupId = layersRef.current.find(item => item.id === selected)?.groupId;
    if (!groupId) return;
    change(items => items.map(item => item.groupId === groupId ? {...item, groupId:null} : item));
    setMultiSelected([]);
  };
  const addMarker = () => {
    const existing = markers.find(marker => Math.abs(marker.time - clock.current) < .04);
    if (existing) { setSelectedMarker(existing.id); setModal('marker'); return; }
    setMarkers(items => [...items, {id:crypto.randomUUID(),time:clock.current,name:'',color:'#4e70ef'}]);
  };
  const scrubBefore = useRef(null);
  const eps = 0.5 / fps;
  const applyEdit = (x, prop, value) => {
    const def = PROPERTY_DEFS[prop], v = def ? clampToProperty(prop, value) : value;
    const animatedProp = def && x.animationEnabled?.[prop] !== false && (autoKey || x.keyframes?.[prop]?.length);
    if (animatedProp) return { ...x, [prop]: v, keyframes: { ...x.keyframes, [prop]: upsertKeyframe(x.keyframes?.[prop] || [], { time: clock.current, value: v }, fps) } };
    return { ...x, [prop]: v };
  };
  /* phase: "commit" (default) = one undo step; "start"/"move"/"end" = live scrubbing that commits once. */
  const edit = (prop, value, phase = "commit") => {
    if (!layer) return;
    if (phase === "start") { scrubBefore.current = layersRef.current; return; }
    if (phase === "end") { if (scrubBefore.current && scrubBefore.current !== layersRef.current) commitPreview(scrubBefore.current); scrubBefore.current = null; return; }
    const sizeLinked = (prop === "width" || prop === "height") && (layer.linkSize ?? layer.kind !== "shape");
    const apply = (items) => items.map((x) => {
      if (x.id !== layer.id) return x;
      let out = applyEdit(x, prop, value);
      if (sizeLinked) { const other = prop === "width" ? "height" : "width", cur = Number(valueAt(x, prop, clock.current)) || 1, ratio = Number(valueAt(x, other, clock.current)) / cur; out = applyEdit(out, other, Number(value) * ratio); }
      return out;
    });
    if (phase === "move" && scrubBefore.current) preview(apply); else change(apply);
  };
  const mutate = (id, fn) => change((items) => items.map((x) => (x.id === id ? fn(x) : x)));
  const sampleLive = (x, prop) => sampleProperty(x, prop, clock.current, evalCtxRef.current);
  const toggleKeys = (props) => {
    if (!layer) return;
    mutate(layer.id, (x) => {
      const hereAll = props.every((p) => keyframeAt(x.keyframes?.[p], clock.current, fps));
      let out = x;
      for (const p of props) {
        const frames = out.keyframes?.[p] || [], here = keyframeAt(frames, clock.current, fps), value = sampleLive(out, p);
        if (hereAll) { const rest = removeKeyframeById(frames, here.id), keyframes = { ...out.keyframes }; if (rest.length) keyframes[p] = rest; else delete keyframes[p]; out = { ...out, [p]: value, keyframes }; }
        else out = { ...out, animationEnabled: { ...out.animationEnabled, [p]: true }, keyframes: { ...out.keyframes, [p]: upsertKeyframe(frames, { time: clock.current, value }, fps) } };
      }
      return out;
    });
  };
  const toggleKey = (prop) => toggleKeys([prop]);
  const jumpKey = (prop, dir, framesOverride) => {
    const frames = framesOverride || layer?.keyframes?.[prop] || [], t = dir > 0 ? nextKeyframeTime(frames, clock.current, fps) : prevKeyframeTime(frames, clock.current, fps);
    if (t !== null) { setPlaying(false); setTime(clamp(t, 0, duration)); }
  };
  const setEase = (prop, ease, scope = "segment") => {
    if (!layer) return;
    mutate(layer.id, (x) => {
      const frames = [...(x.keyframes?.[prop] || [])].sort((a, b) => a.time - b.time);
      if (frames.length < 2) return x;
      const target = frames.find((f) => f.time > clock.current + eps) || frames.at(-1);
      return { ...x, keyframes: { ...x.keyframes, [prop]: frames.map((f) => (scope === "all" || f.id === target.id ? { ...f, ease } : f)) } };
    });
  };
  const patchProp = (prop, fn) => layer && mutate(layer.id, (x) => ({ ...x, keyframes: { ...x.keyframes, [prop]: fn(x.keyframes?.[prop] || [], x) } }));
  const motionApi = {
    sample: (prop) => (layer ? sampleLive(layer, prop) : 0), edit, toggleKey, toggleKeys, jump: jumpKey, setEase,
    setEnabled: (prop, on) => layer && mutate(layer.id, (x) => ({ ...x, animationEnabled: { ...x.animationEnabled, [prop]: on } })),
    setLoop: (prop, mode) => layer && mutate(layer.id, (x) => ({ ...x, keyframeLoop: { ...x.keyframeLoop, [prop]: mode } })),
    reverse: (prop) => patchProp(prop, (f) => reverseKeyframes(f)),
    duplicate: (prop) => patchProp(prop, (f) => duplicateAnimation(f, fps)),
    copy: (prop) => { kfClip.current = copyKeyframes(layer.keyframes?.[prop] || [], (layer.keyframes?.[prop] || []).map((f) => f.id)); setHasClip(!!kfClip.current); },
    paste: (prop) => kfClip.current && patchProp(prop, (f) => pasteKeyframes(f, kfClip.current, clock.current, fps)),
    reset: (prop) => layer && mutate(layer.id, (x) => { const keyframes = { ...x.keyframes }, procedural = { ...x.procedural }, expressions = { ...x.expressions }; delete keyframes[prop]; delete procedural[prop]; delete expressions[prop]; return { ...x, [prop]: layer.kind === "shape" || prop !== "width" ? propertyDefault(prop) ?? x[prop] : x[prop], keyframes, procedural, expressions }; }),
    clearKeys: (prop) => layer && mutate(layer.id, (x) => { const v = sampleProperty(x, prop, clock.current, evalCtxRef.current), keyframes = { ...x.keyframes }; delete keyframes[prop]; return { ...x, [prop]: v, keyframes }; }),
    hasClipboard: hasClip,
    setProcedural: (prop, spec) => layer && mutate(layer.id, (x) => { const procedural = { ...x.procedural }; if (spec) procedural[prop] = spec; else delete procedural[prop]; return { ...x, procedural }; }),
    setExpression: (prop, src) => layer && mutate(layer.id, (x) => { const expressions = { ...x.expressions }; if (src) expressions[prop] = src; else delete expressions[prop]; return { ...x, expressions }; }),
    bake: (prop) => layer && mutate(layer.id, (x) => {
      const frames = bakeToKeyframes((t) => sampleProperty(x, prop, t, evalCtxRef.current), x.start, x.start + x.duration, fps, { step: 1, tolerance: 0.002 });
      const procedural = { ...x.procedural }, expressions = { ...x.expressions }; delete procedural[prop]; delete expressions[prop];
      return { ...x, animationEnabled: { ...x.animationEnabled, [prop]: true }, keyframes: { ...x.keyframes, [prop]: frames.map((f) => ({ ...f, value: clampToProperty(prop, f.value) })) }, procedural, expressions };
    }),
  };
  const graphApi = {
    begin: () => { scrubBefore.current = layersRef.current; },
    end: () => { if (scrubBefore.current && scrubBefore.current !== layersRef.current) commitPreview(scrubBefore.current); scrubBefore.current = null; },
    setEase: (prop, ids, ease, live) => {
      if (!layer) return;
      const fn = (items) => items.map((x) => (x.id !== layer.id ? x : { ...x, keyframes: { ...x.keyframes, [prop]: (x.keyframes?.[prop] || []).map((f) => (ids.includes(f.id) ? { ...f, ease } : f)) } }));
      if (live && scrubBefore.current) preview(fn); else change(fn);
    },
    moveKey: (prop, id, t, v, live) => {
      if (!layer) return;
      const fn = (items) => items.map((x) => (x.id !== layer.id ? x : { ...x, keyframes: { ...x.keyframes, [prop]: (x.keyframes?.[prop] || []).map((f) => (f.id === id ? { ...f, time: t, ...(v !== undefined ? { value: v } : {}) } : f)).sort((a, b) => a.time - b.time) } }));
      if (live && scrubBefore.current) preview(fn); else change(fn);
    },
  };
  const applyPresetToLayer = (layerId, presetId, opts = {}) => {
    const preset = presetById(presetId);
    if (preset) { mutate(layerId, (x) => applyPreset(x, preset, opts)); return; }
    const custom = loadCustomPresets().find((c) => c.id === presetId);
    if (custom) mutate(layerId, (x) => applyCustomPreset(x, custom));
  };
  const copyAnimation = () => { if (layer) setAnimClip({ from: layer.start, keyframes: layer.keyframes, procedural: layer.procedural, keyframeLoop: layer.keyframeLoop, textAnim: layer.textAnim, applied: layer.appliedPresets }); };
  const pasteAnimation = () => {
    if (!layer || !animClip) return;
    mutate(layer.id, (x) => ({
      ...x,
      keyframes: Object.fromEntries(Object.entries(animClip.keyframes || {}).map(([k, fr]) => [k, fr.map((f) => ({ ...f, id: undefined, time: f.time - animClip.from + x.start })).map((f) => ({ ...f, id: keyframeIdLocal() }))])),
      procedural: { ...(animClip.procedural || {}) }, keyframeLoop: { ...(animClip.keyframeLoop || {}) },
      ...(animClip.textAnim ? { textAnim: animClip.textAnim } : {}), appliedPresets: { ...(animClip.applied || {}) },
    }));
  };
  /* ---- zooms, cuts & transitions (Crayo's Effects panel) ---- */
  const mediaLayers = layers.filter((l) => l.kind === "video" || l.kind === "image");
  const clipUnderPlayhead = () => [...mediaLayers].reverse().find((l) => clock.current >= l.start && clock.current <= l.start + l.duration) || mediaLayers[0];
  const lutTarget = clipUnderPlayhead(), reframeTarget = (layer && (layer.kind === "video" || layer.kind === "image") ? layer : null) || clipUnderPlayhead();
  const lutLayers = layers.filter((l) => l.lut && l.lut.name !== "None"), zoomCount = mediaLayers.reduce((n, m) => n + (m.zooms?.length || 0), 0);
  const applyLut = () => {
    const ids = lutDraft.all ? mediaLayers.map((m) => m.id) : lutTarget ? [lutTarget.id] : [];
    change((items) => items.map((x) => (ids.includes(x.id) ? { ...x, lut: lutDraft.name === "None" ? undefined : { name: lutDraft.name, intensity: lutDraft.intensity } } : x)));
    setLutOpen(false); setToast(lutDraft.name === "None" ? "LUT removed." : `Applied ${lutDraft.name} to ${ids.length} clip${ids.length === 1 ? "" : "s"}.`);
  };
  const cameraKeys = (m) => new Set(["scale", "x", "y"].flatMap((k) => (m.keyframes?.[k] || []).map((f) => f.time.toFixed(3)))).size;
  const addCamera = (id) => {
    const m = mediaLayers.find((l) => l.id === id) || reframeTarget;
    if (!m) return;
    const at0 = clamp(clock.current, m.start, m.start + m.duration);
    mutate(m.id, (x) => { let out = { ...x, camera: true }; for (const k of ["scale", "x", "y"]) out = { ...out, animationEnabled: { ...out.animationEnabled, [k]: true }, keyframes: { ...out.keyframes, [k]: upsertKeyframe(out.keyframes?.[k] || [], { time: at0, value: sampleProperty(out, k, at0, evalCtxRef.current), ease: "Smooth" }, fps) } }; return out; });
    setSelected(m.id); setEffectsTab("Reframe"); setToast("Camera added. Drag the blue box on the preview to frame the shot.");
  };
  const removeCamera = (id) => mutate(id, (x) => { const keyframes = { ...x.keyframes }; for (const k of ["scale", "x", "y"]) delete keyframes[k]; const { camera, ...rest } = x; return { ...rest, keyframes }; });
  const importReframe = async (file) => {
    const m = reframeTarget;
    if (!file || !m) return;
    try {
      const data = JSON.parse(await file.text()), list = Array.isArray(data) ? data : data.keyframes || data.camera || [];
      if (!Array.isArray(list) || !list.length) throw new Error("empty");
      mutate(m.id, (x) => { let out = { ...x, camera: true }; for (const f of list) { const t0 = m.start + Number(f.time ?? f.t ?? 0), vals = { scale: f.scale ?? (f.zoom ? f.zoom * 100 : undefined), x: f.x, y: f.y }; for (const [k, v] of Object.entries(vals)) if (Number.isFinite(Number(v))) out = { ...out, animationEnabled: { ...out.animationEnabled, [k]: true }, keyframes: { ...out.keyframes, [k]: upsertKeyframe(out.keyframes?.[k] || [], { time: t0, value: clampToProperty(k, Number(v)), ease: "Smooth" }, fps) } }; } return out; });
      setToast(`Imported ${list.length} camera keyframes.`);
    } catch { setToast("That file isn't a reframe JSON ([{ time, zoom, x, y }, …])."); }
  };
  const addZoom = () => {
    const m = [...mediaLayers].reverse().find((l) => clock.current >= l.start && clock.current <= l.start + l.duration) || mediaLayers[0];
    if (!m) return;
    const id = keyframeIdLocal(), at0 = clamp(clock.current, m.start, m.start + m.duration - 0.2), dur = 0.6, amount = 35;
    mutate(m.id, (x) => {
      const base = { scale: sampleProperty(x, "scale", at0, evalCtxRef.current), x: sampleProperty(x, "x", at0, evalCtxRef.current), y: sampleProperty(x, "y", at0, evalCtxRef.current) };
      const keyframes = { ...x.keyframes };
      const tag = { zoom: id };
      keyframes.scale = [...(keyframes.scale || []), { id: keyframeIdLocal(), time: at0, value: base.scale, ease: "Linear", ...tag }, { id: keyframeIdLocal(), time: snapToFrameT(at0 + dur), value: base.scale * (1 + amount / 100), ease: "Smooth", ...tag }].sort((a, b) => a.time - b.time);
      for (const k of ["x", "y"]) keyframes[k] = upsertKeyframe(keyframes[k] || [], { time: snapToFrameT(at0 + dur), value: base[k], ease: "Smooth" }, fps);
      return { ...x, animationEnabled: { ...x.animationEnabled, scale: true, x: true, y: true }, keyframes, zooms: [...(x.zooms || []), { id, time: at0, dur, amount }] };
    });
    setSelected(m.id); setPlaying(false); setTime(snapToFrameT(at0 + dur));
    setToast("Zoom added — drag the clip in the preview to frame what it zooms into.");
  };
  const updateZoom = (layerId, zoomId, patch) => mutate(layerId, (x) => {
    const zooms = (x.zooms || []).map((z) => (z.id === zoomId ? { ...z, ...patch } : z)), z = zooms.find((q) => q.id === zoomId);
    const frames = [...(x.keyframes?.scale || [])].sort((a, b) => a.time - b.time), start = frames.find((f) => f.zoom === zoomId), endIdx = frames.findIndex((f) => f.zoom === zoomId && f !== start);
    const next = frames.map((f, i) => (i === endIdx ? { ...f, time: snapToFrameT(z.time + z.dur), value: start.value * (1 + z.amount / 100) } : f)).sort((a, b) => a.time - b.time);
    return { ...x, zooms, keyframes: { ...x.keyframes, scale: next } };
  });
  const removeZoom = (layerId, zoomId) => mutate(layerId, (x) => { const scale = (x.keyframes?.scale || []).filter((f) => f.zoom !== zoomId), keyframes = { ...x.keyframes }; if (scale.length) keyframes.scale = scale; else delete keyframes.scale; return { ...x, zooms: (x.zooms || []).filter((z) => z.id !== zoomId), keyframes }; });
  const cuts = mediaLayers.flatMap((a) => mediaLayers.filter((b) => b.id !== a.id && b.name === a.name && Math.abs(b.start - (a.start + a.duration)) < 0.05 && (b.sourceOffset || 0) > 0).map((b) => [a, b])).sort((p, q) => p[1].start - q[1].start);
  const splitAtPlayhead = () => {
    const m = [...mediaLayers].reverse().find((l) => clock.current > l.start + 0.05 && clock.current < l.start + l.duration - 0.05);
    if (!m) { setToast("Move the playhead over a clip to split it."); return; }
    setSelected(m.id); setTimeout(() => splitSelectedRef.current?.(), 0);
  };
  const setTransition = (aId, bId, kind) => {
    change((items) => items.map((x) => {
      if (x.id === aId) return kind === "Fade" ? applyPreset(x, presetById("fade-out"), { duration: 0.4 }) : removePreset(x, "out");
      if (x.id !== bId) return x;
      let out = removePreset({ ...x, transition: kind }, "in");
      const map = { Fade: ["fade-in", { duration: 0.4 }], Flash: ["quick-flash", { duration: 0.3, intensity: 1.2 }], Punch: ["punch-zoom", { duration: 0.35 }], Slide: ["slide-in", { duration: 0.4, direction: "Right" }] }[kind];
      return map ? applyPreset(out, presetById(map[0]), map[1]) : out;
    }));
  };
  const sfxTargets = () => {
    const times = [0, duration];
    for (const l of layersRef.current) { times.push(l.start, l.start + l.duration); for (const frames of Object.values(l.keyframes || {})) for (const f of frames) times.push(f.time); }
    for (const m of markers) times.push(m.time);
    return times;
  };
  const addSfx = async (sfxId, at, { snap = false } = {}) => {
    if(!await ensureLoaded(sfxId)){setToast('This recording could not be loaded. Please retry.');return null;}
    const entry = sfxById(sfxId);
    if (!entry) return null;
    let when = at ?? clock.current;
    if (sfxSyncFor) {
      const target = layersRef.current.find((l) => l.id === sfxSyncFor), first = Object.values(target?.keyframes || {}).flat().map((f) => f.time).sort((a, b) => a - b)[0];
      when = first ?? target?.start ?? when;
      setToast(`Placed "${entry.name}" at ${when.toFixed(2)}s on ${target?.name || "the animation"}.`);
      setSfxSyncFor(null);
    } else if (snap) when = snapTime(when, { fps, targets: sfxTargets(), threshold: 0.12 });
    if (entry.needsFile) { setToast(`Import a file for "${entry.name}" first.`); return null; }
    const dur = soundDuration(entry);
    const item = add({ kind: "sfx", sfxId, music: !!entry.music, name: entry.name, start: Math.max(0, snapToFrameT(when)), duration: dur, volume: entry.music ? 75 : 100, pan: 0, fadeIn: 0, fadeOut: 0, speed: 1, filter: { type: "none", freq: 1200 }, eqLow: 0, eqHigh: 0, echo: 0, reverb: 0 });
    pushRecentSfx(sfxId);
    setDuration((d) => Math.max(d, Math.ceil(item.start + dur)));
    return item;
  };
  useEffect(() => {
    const ids = [...new Set(layers.filter((l) => l.kind === "sfx").map((l) => l.sfxId))];
    ids.forEach((id) => { const e = sfxById(id); if (e && !e.samples) ensureLoaded(id).then((ok) => ok && setSoundRev((r) => r + 1)); });
  }, [layers]);
  useEffect(() => { loadImportedSounds().then((n) => { if (n) setSoundRev((r) => r + 1); }); }, []);
  useEffect(()=>{loadRecordingMetadata().then(n=>{if(n)setSoundRev(r=>r+1);}).catch(()=>{});},[]);
  const importSoundFiles = async (files, slotId) => {
    const done = [];
    for (const f of files) { try { const r = await importSoundFile(f, files.length === 1 ? slotId : null); done.push(r.slot ? r.name : `${r.name} (My sounds)`); } catch { /* skip undecodable */ } }
    setSoundRev((r) => r + 1);
    setImportMsg(done.length ? `Imported ${done.length} of ${files.length}: ${done.slice(0, 3).join(", ")}${done.length > 3 ? "…" : ""}` : "Couldn't read those files — try mp3, wav or ogg.");
  };
  const insertStory = (label, built) => {
    const base = clock.current, gid = crypto.randomUUID();
    const items = built.specs.map((spec) => {
      let item = preset(spec.kind, { ...spec.props, name: spec.name, start: base + (spec.at || 0), duration: spec.dur || built.duration, groupId: gid });
      for (const [id, opts] of spec.presets || []) item = applyPreset(item, presetById(id), opts || {});
      return item;
    });
    change((v) => [...v, ...items]);
    setDuration((d) => Math.max(d, Math.ceil(base + built.duration)));
    setSelected(null); setMultiSelected([]);
    setToast(`Added "${label}" — ${items.length} editable layers, grouped.`);
  };
  const editFromLibrary = async (id) => { const item = await addSfx(id); if (item) setSoundEditorFor(item.id); };
  const insertCombo = (combo) => {
    const base = clock.current;
    combo.clips.forEach((c) => { const entry = sfxById(c.sfxId); if (entry) add({ ...c, kind: "sfx", name: entry.name, start: base + c.offset }); });
    setToast(`Inserted "${combo.name}".`);
  };
  const [combos, setCombos] = useState(loadCombos);
  const selectedSfx = layers.filter((l) => l.kind === "sfx" && (multiSelected.includes(l.id) || l.id === selected));
  const saveSelectedCombo = (name) => {
    const origin = Math.min(...selectedSfx.map((l) => l.start));
    saveCombo(name, selectedSfx.map((l) => { const { id, start, groupId, ...rest } = l; return { ...rest, offset: start - origin }; }));
    setCombos(loadCombos());
  };
  /* One button for everything: keyframe (or un-keyframe) every property of the selected layer at the playhead. */
  const allKeyProps = (l) => !l ? [] : l.kind === "sfx" ? ["volume", "pan"] : ["anchorX", "anchorY", "x", "y", "scale", "rotation", "opacity", ...(l.kind === "shape" ? ["width", "height", "cornerRadius", "color", "strokeColor", "strokeWidth"] : l.kind === "text" ? ["color", "fontSize", "letterSpacing"] : l.kind === "image" || l.kind === "video" ? ["width", "height", "cornerRadius"] : []), "blur", "glow", "shadowBlur"];
  const keyframeAll = () => { if (!layer) { setToast("Select a layer first."); return; } toggleKeys(allKeyProps(layer)); };
  const patchLayer = (patch) => layer && mutate(layer.id, (x) => ({ ...x, ...patch }));
  const startAnimate = () => {
    if (!layer) return;
    const end = layer.start + layer.duration;
    mutate(layer.id, (x) => {
      let out = x;
      for (const p of ["x", "y"]) out = { ...out, animationEnabled: { ...out.animationEnabled, [p]: true }, keyframes: { ...out.keyframes, [p]: upsertKeyframe(out.keyframes?.[p] || [], { time: clock.current, value: sampleLive(out, p) }, fps) } };
      return out;
    });
    setAnimGuide({ layerId: layer.id, step: 1 });
    setPlaying(false);
    setTimeout(() => { setTime((t) => clamp(Math.min(end - 1 / fps, t + 2), 0, duration)); setAnimGuide({ layerId: layer.id, step: 2 }); }, 220);
  };
  /* ---- timeline keyframe selection, dragging, clipboard ---- */
  /* drag a track up/down to change layer (stacking) order — top row = in front */
  const restack = (arr, id, clientY) => {
    if (!tracksRef.current) return arr;
    const rows = [...tracksRef.current.querySelectorAll(":scope > .ae-layer")].filter((r) => r.dataset.layerId !== id);
    const insertAt = rows.filter((r) => { const b = r.getBoundingClientRect(); return clientY > b.top + b.height / 2; }).length;
    const displayOrder = [...arr].reverse().filter((l) => l.id !== id), moving = arr.find((l) => l.id === id);
    if (!moving) return arr;
    displayOrder.splice(insertAt, 0, moving);
    return displayOrder.reverse();
  };
  const reorderRef = useRef(null);
  const startReorder = (e, id) => { e.preventDefault(); e.stopPropagation(); reorderRef.current = { id, before: layersRef.current, moved: false }; setDragId(id); setSelected(id); e.currentTarget.setPointerCapture(e.pointerId); };
  const moveReorder = (e) => {
    const s = reorderRef.current;
    if (!s) return;
    const next = restack(s.before, s.id, e.clientY);
    if (next.some((l, i) => l !== layersRef.current[i])) { s.moved = true; preview(next); }
  };
  const endReorder = (e) => {
    const s = reorderRef.current;
    reorderRef.current = null; setDragId(null);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* released */ }
    if (s?.moved) commitPreview(s.before);
  };
  const kfKey = (layerId, prop, id) => `${layerId}|${prop}|${id}`;
  const parseKf = (s) => { const [l, p, i] = s.split("|"); return { l, p, i }; };
  const snapToFrameT = (t) => Math.round(t * fps) / fps;
  const kfDrag = useRef(null);
  const startKfDrag = (e, layerId, prop, kf) => {
    if (e.button !== 0 && e.button !== 2) return;
    e.stopPropagation(); e.preventDefault();
    const id = kfKey(layerId, prop, kf.id), multi = e.shiftKey || e.metaKey || e.ctrlKey;
    let sel = selKf;
    if (multi) sel = selKf.includes(id) ? selKf.filter((x) => x !== id) : [...selKf, id];
    else if (!selKf.includes(id)) sel = [id];
    setSelKf(sel); setSelected(layerId);
    kfDrag.current = { x: e.clientX, width: e.currentTarget.parentElement.getBoundingClientRect().width, before: layersRef.current, sel, primary: kf.time, moved: false, kf, layerId, multi, right: e.button === 2 };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const moveKfDrag = (e) => {
    const s = kfDrag.current;
    if (!s) return;
    const raw = ((e.clientX - s.x) / s.width) * timelineSpan;
    if (!s.moved && Math.abs(e.clientX - s.x) < 3) return;
    s.moved = true;
    let target = s.primary + raw;
    if (snapOn) {
      const picked = new Set(s.sel);
      const others = s.before.flatMap((x) => Object.entries(x.keyframes || {}).flatMap(([p, frames]) => frames.filter((f) => !picked.has(kfKey(x.id, p, f.id))).map((f) => f.time)));
      target = snapTime(target, { fps, targets: [clock.current, ...markers.map((m) => m.time), ...others], threshold: (7 / s.width) * timelineSpan });
    } else target = snapToFrameT(target);
    const delta = Math.max(-s.primary, target - s.primary), groups = new Map();
    for (const k of s.sel) { const { l, p, i } = parseKf(k); const key = l + "|" + p; if (!groups.has(key)) groups.set(key, { l, p, ids: [] }); groups.get(key).ids.push(i); }
    preview(s.before.map((x) => {
      let out = x;
      for (const g of groups.values()) if (g.l === x.id) out = { ...out, keyframes: { ...out.keyframes, [g.p]: moveKeyframes(out.keyframes[g.p], g.ids, delta, fps, 0) } };
      return out;
    }));
  };
  const endKfDrag = (e) => {
    const s = kfDrag.current;
    if (!s) return;
    kfDrag.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    if (s.moved) commitPreview(s.before);
    else if (s.right) setKfMenu({ x: e.clientX, y: e.clientY });
    else if (!s.multi) { setPlaying(false); setTime(clamp(s.kf.time, 0, duration)); }
  };
  const forSelectedKf = (fn) => change((items) => items.map((x) => {
    let out = x, touched = false;
    const groups = new Map();
    for (const k of selKf) { const { l, p, i } = parseKf(k); if (l !== x.id) continue; (groups.get(p) || groups.set(p, []).get(p)).push(i); }
    for (const [p, ids] of groups) { const next = fn(out.keyframes?.[p] || [], ids, p); out = { ...out, keyframes: { ...out.keyframes, [p]: next } }; touched = true; }
    if (touched) for (const p of groups.keys()) if (!out.keyframes[p].length) { const kf = { ...out.keyframes }; delete kf[p]; out = { ...out, keyframes: kf }; }
    return touched ? out : x;
  }));
  const deleteSelectedKf = () => { forSelectedKf((frames, ids) => frames.filter((f) => !ids.includes(f.id))); setSelKf([]); };
  const copySelectedKf = () => {
    const picks = selKf.map(parseKf), all = [];
    for (const { l, p, i } of picks) { const f = layersRef.current.find((x) => x.id === l)?.keyframes?.[p]?.find((k) => k.id === i); if (f) all.push({ p, f }); }
    if (!all.length) return;
    const origin = Math.min(...all.map((a) => a.f.time));
    kfMulti.current = all.map(({ p, f }) => ({ prop: p, offset: f.time - origin, value: f.value, ease: f.ease }));
    setHasClip(true);
  };
  const pasteKf = () => {
    if (!kfMulti.current?.length || !layer) return;
    mutate(layer.id, (x) => { let out = x; for (const c of kfMulti.current) out = { ...out, animationEnabled: { ...out.animationEnabled, [c.prop]: true }, keyframes: { ...out.keyframes, [c.prop]: upsertKeyframe(out.keyframes?.[c.prop] || [], { time: clock.current + c.offset, value: c.value, ease: c.ease }, fps) } }; return out; });
  };
  const setEaseSelectedKf = (ease) => forSelectedKf((frames, ids) => frames.map((f) => (ids.includes(f.id) ? { ...f, ease } : f)));
  const duplicateSelectedKf = () => { copySelectedKf(); const origin = Math.max(...selKf.map(parseKf).map(({ l, p, i }) => layersRef.current.find((x) => x.id === l)?.keyframes?.[p]?.find((k) => k.id === i)?.time ?? 0)); if (kfMulti.current?.length && layer) mutate(layer.id, (x) => { let out = x; for (const c of kfMulti.current) out = { ...out, keyframes: { ...out.keyframes, [c.prop]: upsertKeyframe(out.keyframes?.[c.prop] || [], { time: origin + 0.25 + c.offset, value: c.value, ease: c.ease }, fps) } }; return out; }); };
  const jumpToSelectedKf = () => { const { l, p, i } = parseKf(selKf[0]); const f = layersRef.current.find((x) => x.id === l)?.keyframes?.[p]?.find((k) => k.id === i); if (f) { setPlaying(false); setTime(clamp(f.time, 0, duration)); } };
  const marqueeStart = (e) => {
    if (e.button !== 0 || e.target !== e.currentTarget && !e.target.classList.contains("ae-proptrack")) return;
    if (!e.target.closest(".ae-proptrack")) return;
    const host = tracksRef.current, r = host.getBoundingClientRect(), add = e.shiftKey || e.metaKey || e.ctrlKey, base = add ? selKf : [];
    const s = { x: e.clientX, y: e.clientY, moved: false };
    const move = (ev) => {
      if (!s.moved && Math.hypot(ev.clientX - s.x, ev.clientY - s.y) < 4) return;
      s.moved = true;
      const box = { l: Math.min(s.x, ev.clientX), r: Math.max(s.x, ev.clientX), t: Math.min(s.y, ev.clientY), b: Math.max(s.y, ev.clientY) };
      setMarquee({ left: box.l - r.left + host.scrollLeft, top: box.t - r.top + host.scrollTop, width: box.r - box.l, height: box.b - box.t });
      const hit = [...host.querySelectorAll(".ae-kf")].filter((el) => { const k = el.getBoundingClientRect(); return k.right >= box.l && k.left <= box.r && k.bottom >= box.t && k.top <= box.b; }).map((el) => el.dataset.kf);
      setSelKf([...new Set([...base, ...hit])]);
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); setMarquee(null); if (!s.moved && !add) setSelKf([]); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  const stretchSelectedKf = (factor) => forSelectedKf((frames, ids) => stretchKeyframes(frames, ids, factor, fps));
  const reverseSelectedKf = () => forSelectedKf((frames, ids) => { const picked = frames.filter((f) => ids.includes(f.id)); const rev = reverseKeyframes(picked); return [...frames.filter((f) => !ids.includes(f.id)), ...rev].sort((a, b) => a.time - b.time); });
  const importFiles = (files) => {
    for (const file of files) {
      const src = URL.createObjectURL(file);
      objectUrls.current.push(src);
      if (file.type.startsWith("audio/")) {
        setAudioSrc(src); setUploadName(file.name);
        continue;
      }
      const kind = file.type.startsWith("video/") ? "video" : "image";
      const item = add({
        kind,
        src,
        name: file.name,
        width: kind === "video" ? 100 : 70,
        height: kind === "video" ? 100 : 45,
        start: time,
        duration: Math.max(1, duration - time),
      });
      if (kind === "video") {
        const v = document.createElement("video");
        v.src = src;
        v.muted = true;
        v.playsInline = true;
        v.preload = "auto";
        videoElements.current.set(item.id, v);
        media.current.set(item.id, v);
        v.onloadedmetadata = () => {
          if (v.duration && Number.isFinite(v.duration)) {
            setDuration((n) => Math.max(n, Math.ceil(v.duration)));
            change((items) =>
              items.map((x) =>
                x.id === item.id ? { ...x, duration: v.duration } : x,
              ),
            );
          }
        };
        v.load();
      } else {
        const img = new Image();
        img.src = src;
        img.onload = () => media.current.set(src, img);
      }
      setSelected(item.id);
    }
  };
  const addGameplayVideo = (g) => {
    const src = g.src, item = add({ kind: "video", src, name: g.name, width: 100, height: 100, start: 0, duration: 30, fit: "Cover" });
    const video = document.createElement("video");
    video.src = src; video.muted = true; video.playsInline = true; video.preload = "auto";
    media.current.set(item.id, video); videoElements.current.set(item.id, video);
    video.onloadedmetadata = () => { if (Number.isFinite(video.duration)) { setDuration((d) => Math.max(d, Math.ceil(video.duration))); change((items) => items.map((l) => (l.id === item.id ? { ...l, duration: video.duration } : l))); } };
    video.load();
    setSelected(null);
  };
  const addVfx = ([id, name]) => {
    const src = `/media/vfx/${id}.mp4`;
    const item = add({kind: "video", src, name, width: 100, height: 100, start: time, duration: 2});
    const video = document.createElement("video");
    video.src = src;
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    media.current.set(item.id, video);
    videoElements.current.set(item.id, video);
    video.onloadedmetadata = () => {
      if (Number.isFinite(video.duration)) {
        setDuration(current => Math.max(current, Math.ceil(time + video.duration)));
        change(items => items.map(layer => layer.id === item.id ? {...layer, duration: video.duration} : layer));
      }
    };
    video.load();
  };
  useEffect(() => {
    for (const item of layers) {
      if (item.kind !== 'video' || videoElements.current.has(item.id)) continue;
      const video = document.createElement('video');
      video.src = item.src;
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      videoElements.current.set(item.id, video);
      media.current.set(item.id, video);
      video.load();
    }
    for (const [id, video] of videoElements.current) {
      if (layers.some(item => item.id === id)) continue;
      video.pause();
      videoElements.current.delete(id);
      media.current.delete(id);
    }
  }, [layers]);
  const syncVideos = (at, shouldPlay) => {
    for (const [id, video] of videoElements.current) {
      const item = layersRef.current.find(layer => layer.id === id);
      if (!item) continue;
      const active = at >= item.start && at < item.start + item.duration;
      const local = Math.max(0, at - item.start + (item.sourceOffset || 0));
      if (!active) { video.pause(); continue; }
      const target = Math.min(local, Number.isFinite(video.duration) ? Math.max(0, video.duration - .01) : local);
      if (Math.abs(video.currentTime - target) > (shouldPlay ? .35 : .06)) video.currentTime = target;
      if (shouldPlay) video.play().catch(() => {});
      else video.pause();
    }
  };
  const musicGraph = useRef(null);
  const ensureMusicGraph = () => {
    if (musicGraph.current || !audioEl.current) return musicGraph.current;
    const ctx = getAudioContext(), node = ctx.createMediaElementSource(audioEl.current), gain = ctx.createGain();
    node.connect(gain); gain.connect(ctx.destination);
    musicGraph.current = { ctx, node, gain };
    return musicGraph.current;
  };
  useEffect(() => { if (audioSrc) ensureMusicGraph(); }, [audioSrc]);
  /* Duck the music under speech: any subtitle cue that is on screen counts as narration. */
  useEffect(() => {
    const g = musicGraph.current;
    if (!g) return;
    const speaking = duck.on && layersRef.current.some((l) => l.kind === "subtitle" && time >= l.start && time <= l.start + l.duration);
    g.gain.gain.setTargetAtTime(speaking ? duck.level : 1, g.ctx.currentTime, 0.08);
  }, [time, duck, audioSrc]);
  const duckOptions = () => ({ duckRanges: duck.on ? layersRef.current.filter((l) => l.kind === "subtitle").map((l) => [l.start, l.start + l.duration]) : [], duckLevel: duck.level });
  const sfxRun = useRef(null);
  const sfxSig = useMemo(() => JSON.stringify(layers.filter((l) => l.kind === "sfx").map((l) => [l.id, l.sfxId, l.start, l.duration, l.sourceOffset, l.fadeIn, l.fadeOut, l.speed, l.filter, l.eqLow, l.eqHigh, l.echo, l.reverb, l.muted, l.keyframes, l.volume, l.pan, l.segments, l.music]).concat([[duck], layers.filter((l) => l.kind === "subtitle").map((l) => [l.start, l.duration])])), [layers, duck]);
  useEffect(() => {
    const stopAll = () => { sfxRun.current?.handle.stop(); sfxRun.current = null; };
    if (!playing || exporting.current) { stopAll(); return; }
    const ctx = getAudioContext();
    ctx.resume?.();
    const cur = sfxRun.current, expected = cur ? cur.tl + (ctx.currentTime - cur.ctxTime) : null;
    if (cur && cur.sig === sfxSig && Math.abs(time - expected) < 0.3) return;
    stopAll();
    const when = ctx.currentTime + 0.02;
    sfxRun.current = { handle: scheduleSfx(ctx, ctx.destination, layersRef.current, clock.current, when, duckOptions()), ctxTime: when, tl: clock.current, sig: sfxSig };
  }, [playing, time, sfxSig]);
  useEffect(() => () => sfxRun.current?.handle.stop(), []);
  useEffect(() => () => objectUrls.current.forEach(URL.revokeObjectURL), []);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(""), 2600); return () => clearTimeout(id); }, [toast]);
  useEffect(() => {
    const key = (e) => {
      const target = document.activeElement, tag = target?.tagName;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(tag) || target?.isContentEditable) return;
      if (e.code === "Space") {
        e.preventDefault();
        setPlaying((v) => !v);
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault(); setPlaying(false);
        const step = e.shiftKey ? .5 : e.altKey ? 1 / 60 : 1 / 30;
        setTime(t => clamp(t + (e.key === 'ArrowRight' ? step : -step), 0, duration));
      }
      if (e.key === 'Home') { e.preventDefault(); setPlaying(false); setTime(0); }
      if (e.key === 'End') { e.preventDefault(); setPlaying(false); setTime(duration); }
      if (e.key === 'Escape') { setKfMenu(null); setModal(''); setSelected(null); setMultiSelected([]); setSelKf([]); }
      if (e.key.toLowerCase() === 'c' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); splitSelected(); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelected(); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'g') { e.preventDefault(); e.shiftKey ? ungroupSelected() : groupSelected(); }
      if (e.key === '[' || e.key === ']') {
        e.preventDefault();
        setTime(current => {
          const sorted = markers.map(marker => marker.time).sort((a,b)=>a-b);
          return e.key === '[' ? [...sorted].reverse().find(mark => mark < current - .01) ?? current : sorted.find(mark => mark > current + .01) ?? current;
        });
      }
      if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom(v => clamp(v + 5, 10, 100)); }
      if (e.key === '-') { e.preventDefault(); setZoom(v => clamp(v - 5, 10, 100)); }
      if (e.key.toLowerCase() === 'm' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); addMarker(); }
      if (e.key.toLowerCase() === 'f' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); stage.current?.requestFullscreen?.(); }
      if (e.key === '?' || (e.shiftKey && e.key === '/')) { e.preventDefault(); setModal('shortcuts'); }
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      }
      if (selKf.length && (e.key === "Delete" || e.key === "Backspace")) { e.preventDefault(); deleteSelectedKf(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c" && selKf.length) { e.preventDefault(); copySelectedKf(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "v" && kfMulti.current?.length) { e.preventDefault(); pasteKf(); return; }
      if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        change((v) => v.filter((x) => x.id !== selected));
        setSelected(null);
        setMultiSelected([]);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [selected, multiSelected, duration, markers, selKf, hasClip, fps, layer]);
  useEffect(() => {
    if (!playing || exporting.current) return;
    let id,
      last = performance.now();
    const tick = (now) => {
      const dt = (now - last) / 1000;
      last = now;
      setTime((t) => {
        const next = t + dt;
        if (next >= duration) {
          setPlaying(false);
          return 0;
        }
        return next;
      });
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [playing, duration]);
  useEffect(() => {
    if (!exporting.current) syncVideos(time, playing);
    if (audioEl.current && !exporting.current) {
      if (playing) {
        if (Math.abs(audioEl.current.currentTime - time) > 0.5)
          audioEl.current.currentTime = time;
        audioEl.current.play().catch(() => {});
      } else {
        audioEl.current.pause();
        if (
          audioEl.current.duration &&
          time < audioEl.current.duration &&
          Math.abs(audioEl.current.currentTime - time) > 0.1
        )
          audioEl.current.currentTime = time;
      }
    }
  }, [time, playing, audioSrc]);
  useEffect(() => {
    let id;
    const render = () => {
      const c = canvas.current;
      if (c) {
        const W = c.width,
          H = c.height,
          ctx = c.getContext("2d");
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, W, H);
        const order = { image: 0, video: 0, shape: 1, text: 2, subtitle: 3 };
        if (byIdCache.current.src !== layersRef.current) byIdCache.current = { src: layersRef.current, map: new Map(layersRef.current.map((x) => [x.id, x])), sorted: (layersRef.current.some((l) => l.solo) ? layersRef.current.filter((l) => l.solo) : layersRef.current).slice() };
        const byId = byIdCache.current.map;
        setEvalCtx(evalCtxRef.current);
        for (const item of byIdCache.current.sorted)
          drawLayer(ctx, item, clock.current, media.current, {
            width: W,
            height: H,
          }, byId);
        if (showSafe) {
          ctx.strokeStyle = "#ffffff88";
          ctx.setLineDash([9, 8]);
          ctx.lineWidth = 2;
          ctx.strokeRect(W * 0.1, H * 0.1, W * 0.8, H * 0.8);
          ctx.setLineDash([]);
        }
        // A static black canvas can produce a header-only recording in Chrome.
        // Keep one imperceptible edge pixel changing while recording so the
        // capture track has frames even for an otherwise empty composition.
        if (exporting.current) {
          exportFrame.current += 1;
          ctx.fillStyle = exportFrame.current % 2 ? "#010101" : "#020202";
          ctx.fillRect(W - 1, H - 1, 1, 1);
        }
        if (document.fullscreenElement === stage.current && blurCanvas.current) blurCanvas.current.getContext('2d').drawImage(c,0,0,320,180);
      }
      id = requestAnimationFrame(render);
    };
    render();
    return () => cancelAnimationFrame(id);
  }, [showSafe, aspect]);
  const startDrag = (e) => {
    if (!layer || layer.locked || e.target !== e.currentTarget) return;
    const box = canvas.current.getBoundingClientRect();
    drag.current = {
      before: layersRef.current,
      x: e.clientX,
      y: e.clientY,
      baseX: layer.x,
      baseY: layer.y,
      w: box.width,
      h: box.height,
    };
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const moveDrag = (e) => {
    if (!drag.current || !layer) return;
    const d = drag.current;
    let dxp = ((e.clientX - d.x) / d.w) * 100, dyp = ((e.clientY - d.y) / d.h) * 100;
    if (layer.parentId) {
      const parent = layersRef.current.find((l) => l.id === layer.parentId);
      if (parent) { const pp = worldPoseOf(parent), rad = (-pp.rotation * Math.PI) / 180, k = Math.max(0.001, pp.scale / 100), px = (dxp / 100) * canvasSize.width, py = (dyp / 100) * canvasSize.height; dxp = (((px * Math.cos(rad) - py * Math.sin(rad)) / k) / canvasSize.width) * 100; dyp = (((px * Math.sin(rad) + py * Math.cos(rad)) / k) / canvasSize.height) * 100; }
    }
    let x = clamp(d.baseX + dxp, -50, 150), y = clamp(d.baseY + dyp, -50, 150);
    if (snapOn && !e.altKey) { const g = []; if (Math.abs(x - 50) < 1.4) { x = 50; g.push("v"); } if (Math.abs(y - 50) < 1.4) { y = 50; g.push("h"); } setGuides(g); }
    const fn = (items) => items.map((o) => (o.id === selected ? applyEdit(applyEdit(o, "x", x), "y", y) : o));
    if (drag.current.before) preview(fn); else change(fn);
  };
  const layersById = useMemo(() => new Map(layers.map((x) => [x.id, x])), [layers]);
  const worldPoseOf = (l, at = clock.current) => worldPose(l, at, layersById, canvasSize);
  const layerAt = (xPct, yPct) => {
    setEvalCtx(evalCtxRef.current);
    for (const o of [...layersRef.current].reverse()) {
      if (o.kind === "sfx" || o.hidden || time < o.start || time > o.start + o.duration) continue;
      const pose = worldPoseOf(o, time), box = measureLayerBox(o, time, canvasSize), rad = (-pose.rotation * Math.PI) / 180;
      const dx = ((xPct - pose.x) / 100) * canvasSize.width, dy = ((yPct - pose.y) / 100) * canvasSize.height, k = Math.max(0.001, pose.scale / 100);
      const lx = (dx * Math.cos(rad) - dy * Math.sin(rad)) / k + (pose.anchorX / 100) * box.w, ly = (dx * Math.sin(rad) + dy * Math.cos(rad)) / k + (pose.anchorY / 100) * box.h;
      if (Math.abs(lx) <= box.w / 2 + 4 && Math.abs(ly) <= box.h / 2 + 4) return o;
    }
    return null;
  };
  const onStageClick = (e) => {
    if (isDragging) {
      setIsDragging(false);
      return;
    }
    const b = canvas.current.getBoundingClientRect(),
      x = ((e.clientX - b.left) / b.width) * 100,
      y = ((e.clientY - b.top) / b.height) * 100;
    const hit = layerAt(x, y);
    setSelected(hit?.id || null);
  };
  /* ---- scale / rotate handles, motion path nodes and curve handles ---- */
  const setEvalNow = () => setEvalCtx(evalCtxRef.current);
  setEvalNow();
  const selPose = layer && layer.kind !== "sfx" ? worldPoseOf(layer, time) : null;
  const selBox = layer && layer.kind !== "sfx" ? measureLayerBox(layer, time, canvasSize) : null;
  const selCenter = (() => {
    if (!selPose || !selBox) return { x: 0, y: 0 };
    const k = selPose.scale / 100, rad = (selPose.rotation * Math.PI) / 180, ox = -(selPose.anchorX / 100) * selBox.w * k, oy = -(selPose.anchorY / 100) * selBox.h * k;
    const wx = (selPose.x / 100) * canvasSize.width + ox * Math.cos(rad) - oy * Math.sin(rad), wy = (selPose.y / 100) * canvasSize.height + ox * Math.sin(rad) + oy * Math.cos(rad);
    return { x: (wx / canvasSize.width) * 100, y: (wy / canvasSize.height) * 100 };
  })();
  const xform = useRef(null);
  const centerClient = () => { const b = canvas.current.getBoundingClientRect(); return [b.left + (selCenter.x / 100) * b.width, b.top + (selCenter.y / 100) * b.height]; };
  const startScale = (e) => {
    e.stopPropagation(); e.preventDefault();
    if (layer?.locked) return;
    const [cx, cy] = centerClient();
    xform.current = { mode: "scale", before: layersRef.current, cx, cy, d0: Math.max(8, Math.hypot(e.clientX - cx, e.clientY - cy)), base: Number(valueAt(layer, "scale", time)) };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const startRotate = (e) => {
    e.stopPropagation(); e.preventDefault();
    if (layer?.locked) return;
    const [cx, cy] = centerClient();
    xform.current = { mode: "rotate", before: layersRef.current, cx, cy, a0: Math.atan2(e.clientY - cy, e.clientX - cx), base: Number(valueAt(layer, "rotation", time)) };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const moveXform = (e) => {
    const s = xform.current;
    if (!s || !layer) return;
    let prop, value;
    if (s.mode === "scale") { prop = "scale"; value = s.base * (Math.hypot(e.clientX - s.cx, e.clientY - s.cy) / s.d0); }
    else { prop = "rotation"; let d = ((Math.atan2(e.clientY - s.cy, e.clientX - s.cx) - s.a0) * 180) / Math.PI; if (e.shiftKey) d = Math.round(d / 15) * 15; value = s.base + d; }
    preview((items) => items.map((o) => (o.id === layer.id ? applyEdit(o, prop, value) : o)));
  };
  const endXform = (e) => {
    const s = xform.current;
    xform.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* released */ }
    if (s && s.before !== layersRef.current) commitPreview(s.before);
  };
  const pathInfo = (() => {
    if (!showPath || !layer || layer.kind === "sfx" || exporting.current) return null;
    const times = [...new Set([...(layer.keyframes?.x || []), ...(layer.keyframes?.y || [])].map((f) => +f.time.toFixed(4)))].sort((a, b) => a - b);
    if (times.length < 2 || layer.animationEnabled?.x === false && layer.animationEnabled?.y === false) return null;
    const W = canvasSize.width, H = canvasSize.height, at = (tt) => { const p = worldPoseOf(layer, tt); return [(p.x / 100) * W, (p.y / 100) * H]; };
    const pts = [], span = times.at(-1) - times[0], step = Math.max(1 / fps, span / 60);
    for (let tt = times[0]; tt < times.at(-1); tt += step) pts.push(at(tt));
    pts.push(at(times.at(-1)));
    const nodes = times.map((tt) => { const [x, y] = at(tt); return { t: tt, x, y }; });
    const arrows = [];
    for (let i = 0; i < nodes.length - 1; i++) { const a = at((nodes[i].t + nodes[i + 1].t) / 2 - 0.02), b = at((nodes[i].t + nodes[i + 1].t) / 2 + 0.02), m = at((nodes[i].t + nodes[i + 1].t) / 2); if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 2) arrows.push({ x: m[0], y: m[1], deg: (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI }); }
    const bf = bendFrames(layer), handles = [];
    for (let i = 0; i < bf.length - 1; i++) {
      const p0 = [(sampleProperty(layer, "x", bf[i].time, evalCtxRef.current) / 100) * W, (sampleProperty(layer, "y", bf[i].time, evalCtxRef.current) / 100) * H], p1 = [(sampleProperty(layer, "x", bf[i + 1].time, evalCtxRef.current) / 100) * W, (sampleProperty(layer, "y", bf[i + 1].time, evalCtxRef.current) / 100) * H];
      const dx = p1[0] - p0[0], dy = p1[1] - p0[1], len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len, bend = layer.pathBend?.[bf[i].id] || 0, amt = (bend / 100) * Math.min(W, H), mx = (p0[0] + p1[0]) / 2 + nx * amt, my = (p0[1] + p1[1]) / 2 + ny * amt;
      handles.push({ id: bf[i].id, x: mx, y: my, mx: (p0[0] + p1[0]) / 2, my: (p0[1] + p1[1]) / 2, nx, ny });
    }
    return { pts, nodes, arrows, handles };
  })();
  const nodeDrag = useRef(null);
  const canvasPoint = (e) => { const b = canvas.current.getBoundingClientRect(); return [((e.clientX - b.left) / b.width) * 100, ((e.clientY - b.top) / b.height) * 100]; };
  const startNode = (e, n) => { e.stopPropagation(); e.preventDefault(); nodeDrag.current = { n, before: layersRef.current, moved: false }; e.currentTarget.setPointerCapture(e.pointerId); };
  const moveNode = (e) => {
    const s = nodeDrag.current;
    if (!s || !layer) return;
    s.moved = true;
    let [x, y] = canvasPoint(e);
    if (snapOn && !e.altKey) { const g = []; if (Math.abs(x - 50) < 1.4) { x = 50; g.push("v"); } if (Math.abs(y - 50) < 1.4) { y = 50; g.push("h"); } setGuides(g); }
    if (layer.parentId) { const parent = layersRef.current.find((l) => l.id === layer.parentId); if (parent) { const pp = worldPoseOf(parent, s.n.t), rad = (-pp.rotation * Math.PI) / 180, k = Math.max(0.001, pp.scale / 100), px = ((x - pp.x) / 100) * canvasSize.width, py = ((y - pp.y) / 100) * canvasSize.height; x = 50 + (((px * Math.cos(rad) - py * Math.sin(rad)) / k) / canvasSize.width) * 100; y = 50 + (((px * Math.sin(rad) + py * Math.cos(rad)) / k) / canvasSize.height) * 100; } }
    preview(s.before.map((o) => (o.id !== layer.id ? o : { ...o, keyframes: { ...o.keyframes, x: upsertKeyframe(o.keyframes?.x || [], { time: s.n.t, value: clampToProperty("x", x) }, fps), y: upsertKeyframe(o.keyframes?.y || [], { time: s.n.t, value: clampToProperty("y", y) }, fps) } })));
  };
  const endNode = (e) => {
    const s = nodeDrag.current;
    nodeDrag.current = null;
    setGuides([]);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* released */ }
    if (s?.moved) commitPreview(s.before); else if (s) { setPlaying(false); setTime(s.n.t); }
  };
  const bendDrag = useRef(null);
  const startBend = (e, h) => { e.stopPropagation(); e.preventDefault(); bendDrag.current = { h, before: layersRef.current }; e.currentTarget.setPointerCapture(e.pointerId); };
  const moveBend = (e) => {
    const s = bendDrag.current;
    if (!s || !layer) return;
    const b = canvas.current.getBoundingClientRect(), px = ((e.clientX - b.left) / b.width) * canvasSize.width, py = ((e.clientY - b.top) / b.height) * canvasSize.height;
    const amt = (px - s.h.mx) * s.h.nx + (py - s.h.my) * s.h.ny, bend = clamp((amt / Math.min(canvasSize.width, canvasSize.height)) * 100, -100, 100);
    preview(s.before.map((o) => (o.id === layer.id ? { ...o, pathBend: { ...(o.pathBend || {}), [s.h.id]: Math.abs(bend) < 1 ? 0 : +bend.toFixed(2) } } : o)));
  };
  const endBend = (e) => { const s = bendDrag.current; bendDrag.current = null; try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* released */ } if (s && s.before !== layersRef.current) commitPreview(s.before); };
  const addPathNode = (e) => {
    if (!layer || !pathInfo) return;
    const [px, py] = canvasPoint(e); let best = null, bestD = Infinity;
    const times = pathInfo.nodes.map((n) => n.t), span = times.at(-1) - times[0], steps = 160;
    for (let i = 0; i <= steps; i++) { const tt = times[0] + (span * i) / steps, p = worldPoseOf(layer, tt), d = Math.hypot(p.x - px, p.y - py); if (d < bestD) { bestD = d; best = tt; } }
    if (best === null) return;
    mutate(layer.id, (o) => ({ ...o, keyframes: { ...o.keyframes, x: upsertKeyframe(o.keyframes?.x || [], { time: best, value: sampleProperty(o, "x", best, evalCtxRef.current) }, fps), y: upsertKeyframe(o.keyframes?.y || [], { time: best, value: sampleProperty(o, "y", best, evalCtxRef.current) }, fps) } }));
  };
  const startTimelineDrag = (event, item) => {
    if (event.button !== 0) return;
    if (item.locked) { setSelected(item.id); return; }
    const track = event.currentTarget.parentElement.getBoundingClientRect();
    timelineDrag.current = {
      id: item.id,
      mode: event.target.dataset.trim || 'move',
      x: event.clientX,
      y: event.clientY,
      width: track.width,
      item,
      before: layersRef.current,
      moved: false,
    };
    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      setMultiSelected(current => [...new Set([...current, selected, item.id].filter(Boolean))]);
    } else {
      setMultiSelected([item.id]);
    }
    setSelected(item.id);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const moveTimelineDrag = (event) => {
    const state = timelineDrag.current;
    if (!state) return;
    const shift = ((event.clientX - state.x) / state.width) * timelineSpan;
    if (Math.abs(shift) < .015 && Math.abs(event.clientY - state.y) < 10 && !state.moved) return;
    state.moved = true;
    const original = state.item;
    const end = original.start + original.duration;
    let patch;
    if (state.mode === 'start') {
      const start = clamp(original.start + shift, 0, end - .2);
      patch = { start, duration: end - start, sourceOffset: (original.sourceOffset || 0) + start - original.start };
    } else if (state.mode === 'end') {
      patch = { duration: clamp(original.duration + shift, .2, Math.max(.2, duration - original.start)) };
    } else {
      const members = original.groupId ? state.before.filter(item => item.groupId === original.groupId) : [original];
      const earliest = Math.min(...members.map(item => item.start));
      const latest = Math.max(...members.map(item => item.start + item.duration));
      const delta = clamp(Math.abs(shift) < .015 ? 0 : shift, -earliest, Math.max(0, duration - latest));
      let moved = state.before.map(item => {
        const base = members.find(member => member.id === item.id);
        if (!base || delta === 0) return item;
        const keyframes = Object.fromEntries(Object.entries(base.keyframes || {}).map(([name, frames]) => [name, frames.map(frame => ({ ...frame, time: frame.time + delta }))]));
        return { ...item, start:base.start + delta, keyframes };
      });
      if (Math.abs(event.clientY - state.y) > 10) moved = restack(moved, original.id, event.clientY);   // drag up/down to change layer order
      preview(moved);
      return;
    }
    preview(items => items.map(item => item.id === state.id ? { ...item, ...patch } : item));
  };
  const stopTimelineDrag = () => {
    const state = timelineDrag.current;
    if (state?.moved) commitPreview(state.before);
    timelineDrag.current = null;
  };
  const startMarkerDrag = (event, marker) => {
    event.stopPropagation();
    markerJustMoved.current = false;
    markerDrag.current = {id:marker.id,x:event.clientX,time:marker.time,width:event.currentTarget.parentElement.getBoundingClientRect().width};
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveMarkerDrag = (event) => {
    const state = markerDrag.current;
    if (!state) return;
    const delta = ((event.clientX - state.x) / state.width) * timelineSpan;
    if (Math.abs(delta) < .025) return;
    markerJustMoved.current = true;
    const next = clamp(state.time + delta,0,duration);
    setMarkers(items => items.map(marker => marker.id === state.id ? {...marker,time:next} : marker));
    setTime(next);
  };
  const exportVideo = async () => {
    if (!layers.length) {
      setModal("export");
      setExportProgress(0);
      setExportStatus("Add text, media, or another layer before exporting a video.");
      return;
    }
    if (!canvas.current?.captureStream || !window.MediaRecorder) {
      setExportStatus("This browser cannot record a canvas video.");
      return;
    }
    setModal("export");
    setExportStatus("Loading audio…");
    const recordingsReady=await Promise.all([...new Set(layersRef.current.filter((l) => l.kind === "sfx").map((l) => l.sfxId))].map((id) => ensureLoaded(id)));
    if(recordingsReady.some(ready=>!ready)){setToast('One of the source recordings is unavailable. Reload it before exporting.');return;}
    setExportStatus("Rendering frames locally…");
    setExportProgress(0);
    exporting.current = true;
    exportFrame.current = 0;
    setPlaying(false);
    const videoTrack = canvas.current.captureStream(60);
    let audioContext = null, sfxHandle = null, mixDest = null,
      stream = videoTrack;
    const hasSfx = layersRef.current.some((l) => l.kind === "sfx" && !l.muted);
    try {
      if ((audioSrc && audioEl.current) || hasSfx) {
        audioContext = getAudioContext();
        await Promise.race([audioContext.resume?.(), new Promise((r) => setTimeout(r, 250))]);
        if (audioContext.state !== "running") { audioContext = null; throw new Error("Audio is blocked until you interact with the page"); }
        mixDest = audioContext.createMediaStreamDestination();
        const graph = audioSrc ? ensureMusicGraph() : null;
        graph?.gain.connect(mixDest);
        stream = new MediaStream([
          ...videoTrack.getVideoTracks(),
          ...mixDest.stream.getAudioTracks(),
        ]);
        if (audioSrc && audioEl.current) { audioEl.current.currentTime = 0; audioEl.current.play().catch(() => {}); }
      }
    } catch {
      stream = videoTrack;
    }
    const cleanupAudio = () => {
      sfxHandle?.stop();
      if (mixDest) { try { musicGraph.current?.gain.disconnect(mixDest); } catch { /* not connected */ } }
      if (musicGraph.current && audioContext) { try { musicGraph.current.gain.connect(audioContext.destination); } catch { /* already */ } }
    };
    const type =
      [
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm",
      ].find(MediaRecorder.isTypeSupported) || "video/webm";
    let recorder;
    try {
      recorder = new MediaRecorder(stream, {
        mimeType: type,
        videoBitsPerSecond: 4500000,
      });
    } catch {
      setExportStatus("Video recording is unavailable in this browser.");
      exporting.current = false;
      cleanupAudio();
      return;
    }
    const chunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recorder.onstop = async () => {
      const blob = new Blob(chunks, { type: "video/webm" });
      if (blob.size < 1024) {
        setExportStatus("The browser did not render video frames. Try adding a visible layer and exporting again.");
        videoTrack.getTracks().forEach((t) => t.stop());
        cleanupAudio();
        audioEl.current?.pause();
        exporting.current = false;
        setTime(0);
        return;
      }
      try {
        setExportStatus('Finalizing MP4 locally…');
        const form = new FormData();
        form.append('tool', 'MP4 Converter');
        form.append('file', blob, 'recording.webm');
        const response = await fetch('/api/media/process', { method: 'POST', body: form });
        if (!response.ok) {
          const detail = await response.json().catch(() => ({}));
          throw new Error(detail.error || 'Could not encode the MP4.');
        }
        const mp4 = await response.blob();
        if (!mp4.size) throw new Error('The MP4 export was empty.');
        const url = URL.createObjectURL(mp4), a = document.createElement('a');
        a.href = url;
        a.download = (title.trim() || 'frame-video').replace(/[^a-z0-9-_ ]/gi, '') + '.mp4';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        setExportStatus(`Export ready — ${Math.max(1, Math.round(mp4.size / 1024))} KB MP4 downloaded.`);
      } catch (error) {
        setExportStatus(`MP4 export failed: ${error.message}`);
      }
      videoTrack.getTracks().forEach((t) => t.stop());
      cleanupAudio();
      audioEl.current?.pause();
      exporting.current = false;
      setTime(0);
    };
    if (audioContext && mixDest) sfxHandle = scheduleSfx(audioContext, [audioContext.destination, mixDest], layersRef.current, 0, audioContext.currentTime + 0.15, duckOptions());
    recorder.start();
    syncVideos(0, true);
    let started = performance.now() + 150;
    const tick = (now) => {
      const elapsed = Math.max(0, (now - started) / 1000);
      clock.current = Math.min(duration, elapsed);
      setTime(clock.current);
      syncVideos(clock.current, true);
      setExportProgress(Math.min(100, Math.round((elapsed / duration) * 100)));
      if (elapsed < duration && exporting.current) requestAnimationFrame(tick);
      else {
        for (const v of videoElements.current.values()) v.pause();
        sfxHandle?.stop();
        recorder.stop();
      }
    };
    requestAnimationFrame(tick);
  };
  const visibleGameplay = backgrounds.filter(
    (item) =>
      (category === "All" || item.name === category) &&
      item.name.toLowerCase().includes(search.toLowerCase()),
  );
  const sfxRow = (key, label) => <PropertyRow key={key} layer={layer} propKey={key} label={label} time={time} fps={fps} api={motionApi} />;
  const sfxInspector = layer?.kind === "sfx" ? (
    <div className="sx-inspector">
      <div className="ae-layer-head"><button className="ae-back" onClick={() => { setSelected(null); setMultiSelected([]); }}>‹　{layer.music ? "Music" : "Sound FX"}</button><span className="ae-layer-actions"><button className={layer.muted ? "on" : ""} aria-pressed={!!layer.muted} onClick={() => patchLayer({ muted: !layer.muted })} title={layer.muted ? "Unmute" : "Mute this sound"}>{layer.muted ? <VolumeX size={15} /> : <Volume2 size={15} />}</button><button className={layer.locked ? "on" : ""} aria-pressed={!!layer.locked} onClick={() => patchLayer({ locked: !layer.locked })} title={layer.locked ? "Unlock" : "Lock"}>{layer.locked ? <Lock size={15} /> : <Unlock size={15} />}</button></span></div>
      <h2>{layer.name}</h2>
      <small className="ae-help">{sfxById(layer.sfxId) ? `${sfxById(layer.sfxId).category} · original Shorts synthesis (CC0)` : "This sound is missing from the library."}</small>
      {!sfxById(layer.sfxId) && <div className="sx-missing" role="alert">Missing sound. Pick a replacement in the library, then drag it here.<button onClick={() => setSection(layer.music ? "Music" : "Sound FX")}>Open library</button></div>}
      <button className="se-open" onClick={() => setSoundEditorFor(layer.id)} disabled={!sfxById(layer.sfxId)}>
        <SfxWave id={layer.sfxId} segments={layer.segments || null} className="se-open-wave" buckets={48} />
        <span><strong>Edit sound</strong><small>Cut, slow down, speed up — this clip only</small></span>
      </button>
      <div className="mi-group" style={{ marginTop: 10 }}>{sfxRow("volume", "Volume")}{sfxRow("pan", "Pan")}</div>
      <div className="sx-sliders">
        <label>Fade in · {(layer.fadeIn || 0).toFixed(2)}s<input type="range" min="0" max={Math.max(0.1, layer.duration / 2).toFixed(2)} step="0.01" value={layer.fadeIn || 0} onChange={(e) => edit("fadeIn", Number(e.target.value))} /></label>
        <label>Fade out · {(layer.fadeOut || 0).toFixed(2)}s<input type="range" min="0" max={Math.max(0.1, layer.duration / 2).toFixed(2)} step="0.01" value={layer.fadeOut || 0} onChange={(e) => edit("fadeOut", Number(e.target.value))} /></label>
      </div>
      <Section title="Effects" defaultOpen={false}>
        <div className="sx-sliders">
          <label>Filter<select value={layer.filter?.type || "none"} onChange={(e) => patchLayer({ filter: { ...(layer.filter || { freq: 1200 }), type: e.target.value } })}><option value="none">None</option><option value="lowpass">Low-pass (muffled)</option><option value="highpass">High-pass (thin)</option></select></label>
          {layer.filter?.type && layer.filter.type !== "none" && <label>Cutoff · {Math.round(layer.filter.freq || 1200)} Hz<input type="range" min="200" max="9000" step="50" value={layer.filter.freq || 1200} onChange={(e) => patchLayer({ filter: { ...layer.filter, freq: Number(e.target.value) } })} /></label>}
          <label>EQ low · {layer.eqLow || 0} dB<input type="range" min="-12" max="12" value={layer.eqLow || 0} onChange={(e) => patchLayer({ eqLow: Number(e.target.value) })} /></label>
          <label>EQ high · {layer.eqHigh || 0} dB<input type="range" min="-12" max="12" value={layer.eqHigh || 0} onChange={(e) => patchLayer({ eqHigh: Number(e.target.value) })} /></label>
          <label>Delay · {Math.round((layer.echo || 0) * 100)}%<input type="range" min="0" max="0.8" step="0.05" value={layer.echo || 0} onChange={(e) => patchLayer({ echo: Number(e.target.value) })} /></label>
          <label>Reverb · {Math.round((layer.reverb || 0) * 100)}%<input type="range" min="0" max="1" step="0.05" value={layer.reverb || 0} onChange={(e) => patchLayer({ reverb: Number(e.target.value) })} /></label>
        </div>
      </Section>
      <Section title="Timing">
        <div className="ae-row"><label>Start<input type="number" min="0" step={1 / fps} value={+layer.start.toFixed(3)} onChange={(e) => edit("start", Math.max(0, Number(e.target.value)))} /></label><label>Length<input type="number" min="0.05" step={1 / fps} value={+layer.duration.toFixed(3)} onChange={(e) => edit("duration", Math.max(0.05, Number(e.target.value)))} /></label></div>
      </Section>
      <div className="sx-actions"><button onClick={duplicateSelected}><Copy size={13} /> Duplicate</button><button onClick={splitSelected}><Scissors size={13} /> Split at playhead</button><button className="danger" onClick={() => { change((v) => v.filter((x) => x.id !== selected)); setSelected(null); }}><Trash2 size={13} /> Delete</button></div>
    </div>
  ) : null;
  const inspector = layer ? (
    <>
      <div className="ae-layer-head">
        <button className="ae-back" onClick={() => {setSelected(null);setMultiSelected([])}}>
          ‹　{section}
        </button>
        <span className="ae-layer-actions">
          <button className={layer.hidden ? "on" : ""} aria-pressed={!!layer.hidden} onClick={() => patchLayer({ hidden: !layer.hidden })} title={layer.hidden ? "Show layer" : "Hide layer"}>{layer.hidden ? <EyeOff size={15} /> : <Eye size={15} />}</button>
          <button className={layer.solo ? "on" : ""} aria-pressed={!!layer.solo} onClick={() => patchLayer({ solo: !layer.solo })} title="Solo — show only soloed layers"><Headphones size={15} /></button>
          <button className={layer.locked ? "on" : ""} aria-pressed={!!layer.locked} onClick={() => patchLayer({ locked: !layer.locked })} title={layer.locked ? "Unlock layer" : "Lock layer (no dragging)"}>{layer.locked ? <Lock size={15} /> : <Unlock size={15} />}</button>
        </span>
      </div>
      <h2>
        {layer.kind === "text"
          ? "Edit Text"
          : layer.kind === "subtitle"
            ? "Edit Subtitles"
            : `Edit ${layer.kind}`}
      </h2>
      <div className="ae-inspector-tabs" role="tablist" aria-label="Layer controls">
        {['Style','Animation'].map(tab=><button key={tab} role="tab" aria-selected={inspectorTab===tab} className={inspectorTab===tab?'active':''} onClick={()=>setInspectorTab(tab)}>{tab}</button>)}
      </div>
      {inspectorTab === 'Style' && <>
      {layer.kind === "text" && (
        <div className="ts-root">
          <textarea aria-label="Layer text" value={layer.text} onChange={(e) => edit("text", e.target.value)} />
          <h3>Style</h3>
          <select aria-label="Font" className="ts-font" value={layer.font} onChange={(e) => edit("font", e.target.value)}>{fonts.map((f) => <option key={f}>{f}</option>)}</select>
          <div className="ts-row">
            <select aria-label="Weight" value={layer.weight || (layer.bold ? 700 : 400)} onChange={(e) => patchLayer({ weight: Number(e.target.value), bold: Number(e.target.value) >= 700 })}>{[[300, "Light"], [400, "Regular"], [500, "Medium"], [700, "Bold"], [900, "Black"]].map(([w, n]) => <option key={w} value={w}>{n}</option>)}</select>
            <label className="ts-size"><input type="number" aria-label="Font size" min="12" max="400" value={Math.round(Number(valueAt(layer, "fontSize", time)))} onChange={(e) => edit("fontSize", Number(e.target.value))} /></label>
            <input type="color" aria-label="Text color" value={String(valueAt(layer, "color", time)).slice(0, 7)} onChange={(e) => edit("color", e.target.value)} />
          </div>
          <div className="ts-row ts-tools">
            <span className="ts-group"><button className={layer.underline ? "on" : ""} aria-pressed={!!layer.underline} onClick={() => patchLayer({ underline: !layer.underline })} title="Underline"><u>U</u></button><button className={layer.strike ? "on" : ""} aria-pressed={!!layer.strike} onClick={() => patchLayer({ strike: !layer.strike })} title="Strikethrough"><s>S</s></button></span>
            <span className="ts-group">{[["AA", "upper"], ["aa", "lower"], ["Aa", "none"]].map(([label, v]) => <button key={v} className={(layer.textCase || "none") === v ? "on" : ""} aria-pressed={(layer.textCase || "none") === v} onClick={() => patchLayer({ textCase: v })} title={{ upper: "UPPERCASE", lower: "lowercase", none: "As typed" }[v]}>{label}</button>)}</span>
            <span className="ts-group">{["left", "center", "right"].map((a) => <button key={a} className={(layer.align || "center") === a ? "on" : ""} onClick={() => edit("align", a)} title={`Align ${a}`}>{{ left: "⇤", center: "↔", right: "⇥" }[a]}</button>)}</span>
          </div>
          <div className="ts-card"><PropertyRow layer={layer} propKey="opacity" label="Opacity" time={time} fps={fps} api={motionApi} /></div>
          <div className="ts-card ts-toggle"><label><span>Text outline</span><input type="checkbox" checked={layer.outline > 0} onChange={(e) => patchLayer({ outline: e.target.checked ? 6 : 0 })} /></label>{layer.outline > 0 && <div className="ts-sub"><input type="range" min="1" max="24" value={layer.outline} onChange={(e) => edit("outline", Number(e.target.value))} aria-label="Outline width" /><input type="color" aria-label="Outline color" value={layer.outlineColor} onChange={(e) => edit("outlineColor", e.target.value)} /></div>}</div>
          <div className="ts-card ts-toggle"><label><span>Text shadow</span><input type="checkbox" checked={layer.shadow > 0} onChange={(e) => patchLayer({ shadow: e.target.checked ? 14 : 0 })} /></label>{layer.shadow > 0 && <div className="ts-sub"><input type="range" min="1" max="35" value={layer.shadow} onChange={(e) => edit("shadow", Number(e.target.value))} aria-label="Shadow blur" /><input type="color" aria-label="Shadow color" value={layer.shadowColor} onChange={(e) => edit("shadowColor", e.target.value)} /></div>}</div>
        </div>
      )}
      {layer.kind === "subtitle" && (
        <>
          <textarea
            aria-label="Layer text"
            value={layer.text}
            onChange={(e) => edit("text", e.target.value)}
          />
          <h3>Style</h3>
          <label>
            Font
            <select
              value={layer.font}
              onChange={(e) => edit("font", e.target.value)}
            >
              {fonts.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </label>
          <div className="ae-row">
            <label>
              Size
              <input
                type="number"
                min="12"
                max="300"
                value={layer.fontSize}
                onChange={(e) => edit("fontSize", Number(e.target.value))}
              />
            </label>
            <label>
              Color
              <input
                type="color"
                value={layer.color}
                onChange={(e) => edit("color", e.target.value)}
              />
            </label>
          </div>
          <div className="ae-row">
            <button
              className={layer.bold ? "active" : ""}
              onClick={() => edit("bold", !layer.bold)}
            >
              Bold
            </button>
            <button
              onClick={() =>
                edit("align", layer.align === "center" ? "left" : "center")
              }
            >
              Align {layer.align}
            </button>
          </div>
          <label>
            Text outline
            <input
              type="range"
              min="0"
              max="24"
              value={layer.outline}
              onChange={(e) => edit("outline", Number(e.target.value))}
            />
          </label>
          <label>
            Text shadow
            <input
              type="range"
              min="0"
              max="35"
              value={layer.shadow}
              onChange={(e) => edit("shadow", Number(e.target.value))}
            />
          </label>
          {layer.kind === "subtitle" && (
            <>
              <h3>Subtitle styles</h3>
              <div className="ae-phase" aria-label="Subtitle display mode">{['Word','Lines'].map(mode=><button key={mode} className={layer.captionMode===mode?'active':''} onClick={()=>edit('captionMode',mode)}>{mode}</button>)}</div>
              <div className="ae-styles">
                {(layer.captionMode==='Lines'?lineStyles:captionStyles).map((id) => (
                  <button
                    key={id}
                    className={layer.styleId === id ? "active" : ""}
                    onClick={() => edit("styleId", id)}
                  >
                    <StyleThumbnail mode={layer.captionMode} id={id}/>
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}
      {layer.kind === "shape" && (
        <div className="ap-pointer"><strong>Shape properties</strong><p>Position, size, roundness, fill, stroke and every other property live in the <b>Properties</b> panel on the right — each with a stopwatch and keyframe button, like After Effects.</p></div>
      )}
      {(layer.kind === "image" || layer.kind === "video") && <div className="ae-media-style"><h3>Frame</h3><div className="ae-phase">{["Cover","Contain"].map(fit=><button key={fit} className={layer.fit===fit?'active':''} onClick={()=>edit('fit',fit)}>{fit}</button>)}</div><div className="ae-phase"><button className={layer.flipH?'active':''} onClick={()=>edit('flipH',!layer.flipH)}>Flip horizontal</button><button className={layer.flipV?'active':''} onClick={()=>edit('flipV',!layer.flipV)}>Flip vertical</button></div><label>Opacity <input type="range" min="0" max="100" value={layer.opacity} onChange={event=>edit('opacity',Number(event.target.value))}/></label><p className="ae-help">Move, scale, rotate and keyframe this layer in Motion.</p></div>}
      {layer?.kind === "subtitle" && (
        <div className="ae-caption-options">
          <h3>Caption timing</h3>
          <div className="ae-phase">
            {["Word", "Lines"].map((mode) => (
              <button
                key={mode}
                className={layer.captionMode === mode ? "active" : ""}
                onClick={() => edit("captionMode", mode)}
              >
                {mode}
              </button>
            ))}
          </div>
          <p className="ae-help">
            Words follow the playhead in preview and export. Lines show up to
            four words, highlighting the active word.
          </p>
          <h3>Caption colors</h3>
          {[
            ["Appeared", "appearedColor"],
            ["Active", "activeColor"],
            ["Emphasis", "emphasisColor"],
            ["Outline", "outlineColor"],
          ].map(([label, key]) => (
            <label key={key}>
              {label}
              <input
                type="color"
                value={layer[key]}
                onChange={(e) =>
                  change((v) =>
                    v.map((x) =>
                      x.id === selected
                        ? { ...x, [key]: e.target.value, customColors: true }
                        : x,
                    ),
                  )
                }
              />
            </label>
          ))}
          <label className="ae-check">
            <input
              type="checkbox"
              checked={layer.preserveColor}
              onChange={(e) => edit("preserveColor", e.target.checked)}
            />{" "}
            Preserve active color after each word
          </label>
        </div>
      )}
      </>}
      {inspectorTab === 'Animation' && <div className="ae-animation-panel">
      <div className="al-actions"><button onClick={copyAnimation} title="Copy every keyframe and preset of this layer"><Copy size={13}/> Copy animation</button><button onClick={pasteAnimation} disabled={!animClip} title="Paste onto the selected layer, relative to its start"><ClipboardPaste size={13}/> Paste animation</button></div>
      <AppliedPresets layer={layer} onChange={(preset, opts) => applyPresetToLayer(layer.id, preset.id, opts)} onRemove={(phase) => mutate(layer.id, (x) => removePreset(x, phase))}/>
      <Section title="Animation presets" count={ANIMATION_PRESETS.length}>
        <PresetGrid onApply={(p) => applyPresetToLayer(layer.id, p.id)} textLayer={layer.kind === "text" || layer.kind === "subtitle"} shapeLayer={layer.kind === "shape"}/>
      </Section>
      {layer.kind === "text" && <Section title="Text animation"><TextAnimationControls layer={layer} onChange={(textAnim) => patchLayer({ textAnim })}/></Section>}
      {layer.kind !== "sfx" && <Section title="Sound FX" defaultOpen={false}>
        <button className="ae-ghost" style={{width:"100%"}} onClick={() => { setSection("Sound FX"); setSelected(null); setSfxSyncFor(layer.id); }}>Sync a sound to this animation…</button>
        <small className="ae-help">Pick a sound in the library — it is placed at this layer's first keyframe or animation start.</small>
      </Section>}
      <Section title="Save as preset" defaultOpen={false}><SavePreset onSave={(name) => { saveCustomPreset(name, layer); setPresetRev((n) => n + 1); }}/></Section>
      <Section title="Quick styles & anchor" defaultOpen={false}>
      <h3>Animation</h3>
      <div className="ae-phase">
        {["In", "Out", "Loop"].map((p) => (
          <button
            className={layer.animationPhase === p ? "active" : ""}
            onClick={() => edit("animationPhase", p)}
            key={p}
          >
            {p}
          </button>
        ))}
      </div>
      <div className="ae-anim">
        {animations.map((a) => (
          <button
            key={a}
            className={layer.animation === a ? "active" : ""}
            onClick={() => edit("animation", a)}
          >
            {a}
          </button>
        ))}
      </div>
      <label>
        Speed
        <select
          value={layer.animationSpeed}
          onChange={(e) => edit("animationSpeed", Number(e.target.value))}
        >
          <option value={0.3}>Fast · 0.3s</option>
          <option value={0.5}>Normal · 0.5s</option>
          <option value={0.8}>Slow · 0.8s</option>
        </select>
      </label>
      <h3>Anchor</h3>
      <div className="ae-anim">
        {anchors.map((a) => (
          <button
            key={a}
            className={layer.anchor === a ? "active" : ""}
            onClick={() => {
              change((v) =>
                v.map((o) =>
                  o.id === selected
                    ? {
                        ...o,
                        anchor: a,
                        y:
                          {
                            Top: 12,
                            "Upper third": 30,
                            Center: 50,
                            "Lower third": 68,
                            Bottom: 88,
                            "Above subject": 36,
                            "Below subject": 64,
                          }[a] ?? o.y,
                      }
                    : o,
                ),
              );
            }}
          >
            {a}
          </button>
        ))}
      </div>
      <label className="ae-check">
        <input
          type="checkbox"
          checked={showSafe}
          onChange={(e) => setShowSafe(e.target.checked)}
        />{" "}
        Show safe areas
      </label>
      <p className="ae-help">Rise, slide, pop and fade are sampled at the playhead in both preview and export.</p>
      </Section>
      </div>}
      {inspectorTab === 'Motion' && (() => {
        const kind = layer.kind, isShape = kind === "shape", isText = kind === "text" || kind === "subtitle", hasColor = isShape || kind === "text";
        const twoKeys = ["x", "y"].some((k) => new Set((layer.keyframes?.[k] || []).map((f) => f.time.toFixed(3))).size > 1);
        const row = (key, label) => <PropertyRow key={key} layer={layer} propKey={key} label={label || PROPERTY_DEFS[key].label} time={time} fps={fps} api={motionApi}/>;
        const guide = animGuide && animGuide.layerId === layer.id ? animGuide : null;
        return <div className="mi-root" data-mode={uiMode}>
          <div className="mi-mode" role="group" aria-label="Editing mode"><i style={{transform: uiMode === "advanced" ? "translateX(100%)" : "none"}}/>{[["basic","Basic"],["advanced","Advanced"]].map(([id,label])=><button key={id} className={uiMode===id?"on":""} aria-pressed={uiMode===id} onClick={()=>{setUiMode(id);try{localStorage.setItem("frame-editor-mode",id)}catch{}}}>{label}</button>)}</div>
          <AnimateGuide guide={guide} onAnimate={startAnimate} onDone={() => setAnimGuide(null)} hasKeys={Object.keys(layer.keyframes || {}).length > 0} twoKeys={twoKeys} onPlay={() => { setTime(layer.start); setPlaying(true); }}/>
          {uiMode === "basic" ? <>
            <div className="mi-group">
              <PositionRow layer={layer} time={time} fps={fps} api={motionApi}/>
              {row("scale", "Size")}
              {row("rotation")}
              {row("opacity")}
              {hasColor && row("color")}
            </div>
            <Section title="Effects" defaultOpen={false}>{row("blur")}{row("glow")}</Section>
          </> : <>
            <Section title="Transform">
              {row("x")}{row("y")}{row("scale")}
              {(isShape || kind === "image" || kind === "video") && <>{row("width")}{row("height")}<button className={"mi-link"+((layer.linkSize ?? !isShape)?" on":"")} onClick={()=>patchLayer({linkSize: !(layer.linkSize ?? !isShape)})} aria-pressed={layer.linkSize ?? !isShape}>{(layer.linkSize ?? !isShape) ? <Link2 size={13}/> : <Unlink2 size={13}/>} Width & height {(layer.linkSize ?? !isShape) ? "linked" : "separate"}</button></>}
              {row("rotation")}{row("skewX")}{row("anchorX")}{row("anchorY")}
              <div className="mi-flips"><button className={layer.flipH?"on":""} onClick={()=>patchLayer({flipH:!layer.flipH})}>Flip horizontal</button><button className={layer.flipV?"on":""} onClick={()=>patchLayer({flipV:!layer.flipV})}>Flip vertical</button></div>
            </Section>
            <Section title="Appearance">
              {row("opacity")}{hasColor && row("color")}{isShape && <>{row("strokeColor")}{row("strokeWidth")}{row("cornerRadius")}</>}
              {kind !== "text" && kind !== "subtitle" && !isShape && row("cornerRadius")}
              {row("shadowBlur")}{row("glow")}
              <label className="mi-parent" style={{ marginTop: 8 }}>Blend mode<select value={layer.blend || "normal"} onChange={(e) => patchLayer({ blend: e.target.value })}>{["normal", "multiply", "screen", "overlay", "darken", "lighten", "add", "difference"].map((m) => <option key={m} value={m}>{m[0].toUpperCase() + m.slice(1)}</option>)}</select></label>
            </Section>
            <Section title="Effects" defaultOpen={false}>{row("blur")}{row("brightness")}{row("contrast")}{row("saturation")}{row("hue")}{row("reveal")}{(kind === "image" || kind === "video") && row("vignette")}</Section>
            {(kind === "image" || kind === "video") && <Section title="Chroma key" defaultOpen={false}>
              <label className="ae-switch"><input type="checkbox" checked={!!layer.chroma?.on} onChange={(e) => patchLayer({ chroma: { color: "#00ff00", tolerance: 0.35, softness: 0.12, ...(layer.chroma || {}), on: e.target.checked } })} /><span>Remove a background colour</span></label>
              {layer.chroma?.on && <div className="sx-sliders"><label>Key colour<input type="color" value={layer.chroma.color || "#00ff00"} onChange={(e) => patchLayer({ chroma: { ...layer.chroma, color: e.target.value } })} /></label><label>Tolerance · {Math.round((layer.chroma.tolerance ?? 0.35) * 100)}%<input type="range" min="0.02" max="0.9" step="0.01" value={layer.chroma.tolerance ?? 0.35} onChange={(e) => patchLayer({ chroma: { ...layer.chroma, tolerance: Number(e.target.value) } })} /></label><label>Softness · {Math.round((layer.chroma.softness ?? 0.12) * 100)}%<input type="range" min="0.01" max="0.5" step="0.01" value={layer.chroma.softness ?? 0.12} onChange={(e) => patchLayer({ chroma: { ...layer.chroma, softness: Number(e.target.value) } })} /></label></div>}
            </Section>}
            {isText && <Section title="Text" defaultOpen={false}>{row("fontSize")}{row("letterSpacing")}{kind === "text" && row("arc")}</Section>}
            <Section title="Mask" defaultOpen={false}>
              <div className="ae-seg">{[["none", "None"], ["rect", "Rectangle"], ["ellipse", "Ellipse"]].map(([v, n]) => <button key={v} className={(layer.mask?.type || "none") === v ? "active" : ""} onClick={() => patchLayer({ mask: { ...(layer.mask || {}), type: v } })}>{n}</button>)}</div>
              {layer.mask?.type && layer.mask.type !== "none" && <>
                {row("maskW")}{row("maskH")}{row("maskX")}{row("maskY")}{row("maskFeather")}
                <label className="ae-switch" style={{ marginTop: 6 }}><input type="checkbox" checked={!!layer.mask.invert} onChange={(e) => patchLayer({ mask: { ...layer.mask, invert: e.target.checked } })} /><span>Invert mask</span></label>
                <small className="ae-help">Mask size, position and feather are animatable with the ◆ buttons.</small>
              </>}
            </Section>
            <Section title="Assistants" defaultOpen={false}><AssistantsSection layer={layer} api={motionApi} hasAudio={!!audioPcm}/></Section>
            <Section title="Expression" defaultOpen={false}><ExpressionField layer={layer} api={motionApi}/></Section>
            <Section title="Parenting" defaultOpen={false}>
              <label className="mi-parent">Follow layer<select value={layer.parentId || ""} onChange={(e)=>patchLayer({parentId:e.target.value||null})}><option value="">None</option>{layers.filter(o=>o.id!==layer.id&&o.kind!=="sfx"&&o.parentId!==layer.id).map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
              <small>Child position is relative to the parent's centre and inherits its movement, scale and rotation.</small>
            </Section>
            <button className="mi-graph-toggle" onClick={()=>setGraphOpen(v=>!v)} aria-pressed={graphOpen}>{graphOpen ? "Hide" : "Open"} graph editor</button>
          </>}
          <Section title="Timing">
            <div className="ae-row">
              <label>Start<input type="number" min="0" max={duration} step={1 / fps} value={+layer.start.toFixed(3)} onChange={(e) => edit("start", Math.max(0, Number(e.target.value)))}/></label>
              <label>Length<input type="number" min="0.1" max="600" step={1 / fps} value={+layer.duration.toFixed(3)} onChange={(e) => edit("duration", Math.max(0.1, Number(e.target.value)))}/></label>
            </div>
          </Section>
        </div>;
      })()}
      <button
        className="ae-danger"
        onClick={() => {
          change((v) => v.filter((o) => o.id !== selected));
          setSelected(null);
        }}
      >
        <Trash2 size={15} /> Delete layer
      </button>
    </>
  ) : null;
  const sidebar = layer?.kind === "sfx" ? sfxInspector : layer && !(section === "Subtitles" && layer.kind === "subtitle") && !(section === "Effects" && (effectsTab === "Zooms" || effectsTab === "Transitions" || effectsTab === "Reframe" || effectsTab === "LUTs")) ? (
    inspector
  ) : section === "Media" ? (
    <>
      <div className="ae-tabs">
        <button className="active">Project uploads</button>
        <button onClick={() => setModal("cloud")}>Cloud uploads</button>
      </div>
      <button className="ae-upload" onClick={() => fileInput.current?.click()}>
        <CloudUpload size={36} />
        <span>
          There's nothing yet.
          <br />
          Click here to upload a file.
        </span>
      </button>
      <p className="ae-help">
        Image and video imports become movable layers on the timeline.
      </p>
      {missingMedia > 0 && <p role="status" className="ae-help">{missingMedia} imported file layer{missingMedia === 1 ? '' : 's'} could not be restored after reopening. Re-import your local media.</p>}
    </>
  ) : section === "Text" ? (
    <>
      <h2>Add text</h2>
      {["Add Heading", "Add Paragraph", "Add Quote"].map((s, i) => (
        <button
          className="ae-menuitem"
          key={s}
          onClick={() => {
            add({
              kind: "text",
              text:
                i === 0
                  ? "Add text"
                  : i === 1
                    ? "Your paragraph"
                    : "“Your quote”",
              fontSize: i === 0 ? 124 : 60,
              bold: false,
              name: s,
              start: time,
            });
            setSelected(null);
            setMultiSelected([]);
          }}
        >
          {s}
        </button>
      ))}
    </>
  ) : section === "Subtitles" ? (
    <>
      {subtitleEntry ? <><h2>Select subtitles</h2><div className="ae-subtitle-choices"><button onClick={() => { setSubtitleChoice('ai'); setSubtitleEntry(false); }}><span><WandSparkles size={21}/></span><strong>AI subtitles</strong><small>Automatically recognize speech and add subtitles</small></button><button onClick={() => { setSubtitleChoice('manual'); setSubtitleEntry(false); }}><span><Subtitles size={21}/></span><strong>Manual subtitles</strong><small>Add subtitles manually with custom timing</small></button></div></> : <>
        <SubtitlePanel onBack={() => setSubtitleEntry(true)} cfg={{StyleThumbnail,captionStyles,lineStyles,fonts,subAnimations,captionPaint}} layers={layers} change={change} add={add} time={time} duration={duration} selected={selected} setSelected={setSelected} style={subStyle} setStyle={setSubStyle} fileInput={fileInput} choice={subtitleChoice} setChoice={setSubtitleChoice}/>
      </>}
    </>
  ) : section === "Stories" ? (
    <StoriesPanel onInsert={insertStory} />
  ) : section === "Animations" ? (
    <>
      <h2>Animations</h2>
      <p className="ae-help">Select an object, then press Apply — or drag a preset straight onto an object in the preview or timeline.</p>
      <PresetGrid onApply={(p) => { if (selected) applyPresetToLayer(selected, p.id); else setToast("Select an object first, or drag the preset onto one."); }} textLayer shapeLayer/>
    </>
  ) : section === "Video" ? (
    <>
      <h2>Background video</h2>
      <p className="ae-help">Gameplay backgrounds for your stories. Pick one and it goes on the timeline and exports with your video.</p>
      <div className="vg-grid">
        {GAMEPLAY.map((g) => (
          <button key={g.id} className="vg-card" onClick={() => addGameplayVideo(g)} aria-label={`Add ${g.name} background`}>
            <img src={g.thumb} alt="" loading="lazy" />
            <span className="vg-label"><strong>{g.name}</strong><small>{g.len}</small></span>
          </button>
        ))}
      </div>
    </>
  ) : section === "Objects" ? (
    <>
      <h2>Add objects</h2>
      <div className="ob-grid">
        {[["Rectangle", "rect", { width: 55, height: 16, color: "#486cf1" }], ["Rounded", "rect", { width: 55, height: 16, color: "#486cf1", cornerRadius: 30 }], ["Circle", "ellipse", { width: 26, height: 14.6, color: "#486cf1" }], ["Triangle", "polygon", { sides: 3, width: 26, height: 22, color: "#f7c948" }], ["Hexagon", "polygon", { sides: 6, width: 26, height: 22, color: "#2fae75" }], ["Star", "star", { width: 28, height: 24, color: "#f7c948" }], ["Line", "line", { width: 50, height: 4, color: "#ffffff", strokeWidth: 8 }], ["Arrow", "arrow", { width: 50, height: 10, color: "#ffffff", strokeWidth: 8 }]].map(([name, shapeType, props]) => (
          <button key={name} className="ob-card" onClick={() => add({ kind: "shape", shapeType, name, start: time, ...props })}>
            <svg viewBox="-20 -16 40 32" width="34" height="28" aria-hidden="true"><path d={{ rect: "M-15 -9H15V9H-15Z", ellipse: "M-14 0a14 9 0 1 0 28 0a14 9 0 1 0 -28 0", polygon: name === "Triangle" ? "M0 -11L14 10H-14Z" : "M-7 -11H7L14 0L7 11H-7L-14 0Z", star: "M0 -12L3.5 -3.5L12.5 -3L5.5 3L8 12L0 7L-8 12L-5.5 3L-12.5 -3L-3.5 -3.5Z", line: "M-15 0H15", arrow: "M-15 0H14M7 -6L14 0L7 6" }[shapeType]} transform={name === "Rounded" ? "" : ""} fill={shapeType === "line" || shapeType === "arrow" ? "none" : "currentColor"} stroke="currentColor" strokeWidth={shapeType === "line" || shapeType === "arrow" ? 2.4 : 0} strokeLinecap="round" strokeLinejoin="round" rx={name === "Rounded" ? 6 : 0} /></svg>
            <span>{name}</span>
          </button>
        ))}
      </div>
      <button className="ae-menuitem" onClick={() => add({ kind: "text", text: "Add text", fontSize: 96, name: "Text", start: time })}>+ Text</button>
      <button className="ae-menuitem" onClick={() => add({ kind: "shape", color: "#ffffff", width: 20, height: 20, start: time, name: "Square" })}>+ Square</button>
      <button className="ae-menuitem" onClick={() => fileInput.current?.click()}>+ Import image</button>
      <p className="ae-help">Every shape supports fill, gradient, stroke, dashes, corner radius, glow and keyframes.</p>
    </>
  ) : section === "Music" ? (
    <>
      <MusicBrowser rev={soundRev} onImportFile={(f, id) => importSoundFiles([f], id)} onAdd={(id) => addSfx(id)} onUpload={() => audioInput.current?.click()} uploaded={audioSrc ? uploadName || "Your track" : ""} onRemoveUpload={() => { setAudioSrc(""); setUploadName(""); }} />
      {(audioSrc || layers.some((l) => l.music)) && <label className="ae-switch sx-duck"><input type="checkbox" checked={duck.on} onChange={(e) => setDuck((d) => ({ ...d, on: e.target.checked }))} /><span>Lower the music while subtitles (speech) are on screen</span></label>}
    </>
  ) : section === "Sound FX" ? (
    <>
      <h2>Sound FX</h2>
      <SfxLibrary onEdit={editFromLibrary} rev={soundRev} importMsg={importMsg} onImportFiles={importSoundFiles} onAdd={(id) => addSfx(id)} syncHint={sfxSyncFor ? layers.find((l) => l.id === sfxSyncFor)?.name : ""} combos={combos} onInsertCombo={insertCombo} onDeleteCombo={(id) => { deleteCombo(id); setCombos(loadCombos()); }} onSaveCombo={saveSelectedCombo} canSaveCombo={selectedSfx.length > 0} />
    </>
  ) : section === "Tools" ? (
    <>
      <h2>AI tools</h2>
      <div className="tl-list">
        {[
          [Mic, "Create voiceover", "Generate voiceovers"],
          [MessageSquare, "Create Reddit post", "Generate Reddit post screenshots"],
          [Crop, "Magic Crop", "Auto-edit with smart cropping & zoom"],
          [Smile, "Emoji picker", "Browse and copy emojis with search"],
          [Repeat2, "Remix Shorts", "Remix TikTok shorts with AI"],
          [LayoutTemplate, "Format", "Change the canvas ratio"],
          [Square, "Add backdrop", "Solid background behind everything"],
          [Layers, "Add adjustment layer", "A tint layer that affects the look"],
        ].map(([Icon, x, sub]) => (
          <button className="tl-item" key={x} onClick={() => {
            if (x === "Format") setModal("format");
            else if (x === "Emoji picker") setModal("emoji");
            else if (x === "Add backdrop") add({ kind: "shape", color: "#101827", width: 100, height: 100, cornerRadius: 0, name: "Backdrop", start: time });
            else if (x === "Add adjustment layer") add({ kind: "shape", color: "#ffffff", opacity: 15, width: 100, height: 100, cornerRadius: 0, name: "Adjustment layer", start: time });
            else setModal(x);
          }}>
            <span className="tl-icon"><Icon size={17} /></span><span className="tl-text"><strong>{x}</strong><small>{sub}</small></span>
          </button>
        ))}
      </div>
    </>
  ) : (
    <>
      <h2>Effects</h2>
      <div className="ae-effect-grid">
        {[["LUTs", SlidersHorizontal], ["Zooms", ZoomIn], ["Transitions", Layers], ["Reframe", Maximize]].map(([x, Icon]) => (
          <button key={x} className={effectsTab === x ? "active" : ""} onClick={() => setEffectsTab(x)}><Icon size={16} />{x}</button>
        ))}
      </div>
      {effectsTab === "LUTs" ? <>
        <button className="fx-primary" disabled={!mediaLayers.length} onClick={() => setLutOpen((o) => !o)}><Plus size={14} /> Add a LUT</button>
        <p className="ae-help">Opens the clip under the playhead so you can pick a LUT, set its intensity, and apply it to every clip.</p>
        {!mediaLayers.length ? <div className="ae-effect-empty"><SlidersHorizontal size={20} /><strong>Nothing to grade yet.</strong><span>Add a video or image to the timeline first.</span></div> : <>
          {lutOpen && <div className="fx-card lut-picker">
            <header><strong>Pick a LUT</strong><small>{lutTarget?.name}</small></header>
            <div className="lut-grid">{Object.keys(LUT_LOOKS).map((n) => <button key={n} className={lutDraft.name === n ? "on" : ""} onClick={() => setLutDraft((d) => ({ ...d, name: n }))}><i style={{ filter: lutCss(n, lutDraft.intensity) }} /><span>{n}</span></button>)}</div>
            <label>Intensity · {lutDraft.intensity}%<input type="range" min="10" max="100" value={lutDraft.intensity} onChange={(e) => setLutDraft((d) => ({ ...d, intensity: Number(e.target.value) }))} /></label>
            <label className="ae-switch"><input type="checkbox" checked={lutDraft.all} onChange={(e) => setLutDraft((d) => ({ ...d, all: e.target.checked }))} /><span>Apply to every clip</span></label>
            <div className="fx-actions"><button onClick={() => setLutOpen(false)}>Cancel</button><button className="primary" onClick={applyLut}>Apply</button></div>
          </div>}
          <details className="fx-manage" open={lutLayers.length > 0}><summary><SlidersHorizontal size={14} /> Manage LUTs <b>{lutLayers.length}</b></summary>
            {lutLayers.map((l) => <div className="fx-card" key={l.id}><header><button onClick={() => { setSelected(l.id); }}><strong>{l.lut.name}</strong><small>{l.name}</small></button><button aria-label="Remove LUT" onClick={() => mutate(l.id, (x) => { const { lut, ...rest } = x; return rest; })}><Trash2 size={13} /></button></header><label>Intensity · {l.lut.intensity}%<input type="range" min="10" max="100" value={l.lut.intensity} onChange={(e) => mutate(l.id, (x) => ({ ...x, lut: { ...x.lut, intensity: Number(e.target.value) } }))} /></label></div>)}
            {!lutLayers.length && <p className="ae-help">No LUTs applied yet.</p>}
          </details>
        </>}
      </> : effectsTab === "Zooms" ? <>
        <button className="fx-primary" disabled={!mediaLayers.length} onClick={addZoom}><Plus size={14} /> Add a Zoom</button>
        <p className="ae-help">Adds a zoom where the playhead is, then lets you frame what it zooms into.</p>
        {!mediaLayers.length ? <div className="ae-effect-empty"><ZoomIn size={20} /><span>Add a video or image first</span></div> :
          <details className="fx-manage" open={zoomCount > 0}><summary><ZoomIn size={14} /> Manage zooms <b>{zoomCount}</b></summary>
            {mediaLayers.flatMap((m) => (m.zooms || []).map((z) => (
              <div className="fx-card" key={z.id}>
                <header><button onClick={() => { setPlaying(false); setSelected(m.id); setTime(z.time); }}><strong>Zoom at {z.time.toFixed(2)}s</strong><small>{m.name}</small></button><button aria-label="Remove zoom" onClick={() => removeZoom(m.id, z.id)}><Trash2 size={13} /></button></header>
                <label>Amount · {z.amount}%<input type="range" min="5" max="200" value={z.amount} onChange={(e) => updateZoom(m.id, z.id, { amount: Number(e.target.value) })} /></label>
                <label>Length · {z.dur.toFixed(2)}s<input type="range" min="0.2" max="3" step="0.05" value={z.dur} onChange={(e) => updateZoom(m.id, z.id, { dur: Number(e.target.value) })} /></label>
              </div>
            )))}
            {!zoomCount && <p className="ae-help">No zooms yet.</p>}
          </details>}
      </> : effectsTab === "Transitions" ? <>
        <button className="fx-primary" disabled={!mediaLayers.length} onClick={splitAtPlayhead}><Scissors size={14} /> Split at playhead</button>
        <p className="ae-help">Splits the clip under the playhead, then opens the new cut so you can pick a transition.</p>
        {!cuts.length ? <div className="ae-effect-empty"><Scissors size={20} /><strong>No cuts yet</strong><span>Split a clip to create a cut. Every cut can carry a flash, a punch or a fade.</span><span>Move the playhead over a clip to split it.</span></div> : <div className="fx-cards">
          {cuts.map(([a, b]) => (
            <div className="fx-card" key={b.id}>
              <header><button onClick={() => { setPlaying(false); setTime(b.start); }}><strong>Cut at {b.start.toFixed(2)}s</strong><small>{a.name}</small></button></header>
              <div className="fx-seg">{["None", "Fade", "Flash", "Punch", "Slide"].map((k) => <button key={k} className={(b.transition || "None") === k ? "on" : ""} onClick={() => setTransition(a.id, b.id, k)}>{k}</button>)}</div>
            </div>
          ))}
        </div>}
      </> : <>
        <input ref={reframeInput} type="file" accept="application/json,.json" hidden onChange={(e) => { importReframe(e.target.files?.[0]); e.target.value = ""; }} />
        <button className="fx-primary" disabled={!mediaLayers.length} onClick={() => addCamera(reframeTarget?.id)}><Plus size={14} /> Add camera</button>
        <p className="ae-help">Adds an editable camera to the clip under the playhead, starting from its current framing.</p>
        <button className="fx-row" disabled={!mediaLayers.length} onClick={() => reframeInput.current?.click()}><Upload size={14} /> Import reframe JSON</button>
        {!mediaLayers.length ? <div className="ae-effect-empty"><Maximize size={20} /><span>Add a video or image first</span></div> : <>
          {reframeTarget?.camera && <div className="fx-card cam-card">
            <header><strong><Maximize size={13} /> Camera &amp; reframe</strong><small>{cameraKeys(reframeTarget)} keyframe{cameraKeys(reframeTarget) === 1 ? "" : "s"}</small></header>
            <p className="ae-help" style={{ margin: 0 }}>Move the playhead, then drag the blue box on the preview to frame that moment, or pull the corner to zoom.</p>
            <label className="ae-switch"><input type="checkbox" checked={showPath} onChange={(e) => setShowPath(e.target.checked)} /><span>Show camera path</span></label>
            <label>Zoom · {(Number(valueAt(reframeTarget, "scale", time)) / 100).toFixed(2)}×<input type="range" min="50" max="400" value={Number(valueAt(reframeTarget, "scale", time))} onChange={(e) => { if (selected !== reframeTarget.id) setSelected(reframeTarget.id); mutate(reframeTarget.id, (x) => applyEdit(x, "scale", Number(e.target.value))); }} /></label>
            <div className="fx-actions"><button onClick={() => addCamera(reframeTarget.id)}>Add keyframe here</button><button onClick={() => removeCamera(reframeTarget.id)}>Remove camera</button></div>
          </div>}
          <h4 className="fx-sub">Video clips <small>{mediaLayers.filter((m) => m.camera).length} with a camera</small></h4>
          <div className="fx-cards">{mediaLayers.map((m) => <div className={"fx-card clip" + (reframeTarget?.id === m.id ? " cur" : "")} key={m.id}><header><button onClick={() => { setSelected(m.id); setPlaying(false); setTime(clamp(clock.current, m.start, m.start + m.duration)); }}><strong>{m.name}</strong><small>{m.start.toFixed(1)}s to {(m.start + m.duration).toFixed(1)}s · {m.camera ? "Camera on" : "No camera"}</small></button></header>{!m.camera && <button className="fx-link" onClick={() => addCamera(m.id)}><Plus size={13} /> Add camera</button>}</div>)}</div>
        </>}
      </>}
    </>
  );

  /* Timeline rows only depend on structure, not on the playhead — keeps scrubbing cheap with dozens of layers. */
  const trackRows = useMemo(() => (
    <>
          {layers.length ? (
            [...layers].reverse().map((o, i) => {
              const open = !!expanded[o.id], animatedKeys = Object.keys(o.keyframes || {}).filter((k) => o.keyframes[k]?.length);
              const rows = uiMode === "advanced" ? [...new Set(["x", "y", "scale", "rotation", "opacity", ...animatedKeys])] : animatedKeys;
              const distinct = [...new Set(Object.values(o.keyframes || {}).flat().map((f) => f.time.toFixed(3)))].map(Number);
              return (
              <div className={"ae-layer" + (open ? " open" : "") + (dragId === o.id ? " dragging" : "")} key={o.id} data-layer-id={o.id}>
              <div className="ae-track">
                <button className="ae-grip" aria-label={`Drag to reorder ${o.name}`} title="Drag up or down to change layer order" onPointerDown={(e) => startReorder(e, o.id)} onPointerMove={moveReorder} onPointerUp={endReorder} onPointerCancel={endReorder}><GripVertical size={13} /></button>
                <button className={"ae-expand" + (open ? " open" : "")} aria-label={open ? "Hide animated properties" : "Show animated properties"} aria-expanded={open} title={animatedKeys.length ? "Show animated properties" : "No animated properties yet"} onClick={() => setExpanded((v) => ({ ...v, [o.id]: !v[o.id] }))}><ChevronRight size={14} /></button>
                <span className="ae-tracklabel">
                  {o.name}
                </span>
                <button
                  className={"ae-clip " + (multiSelected.includes(o.id) ? "active" : "") + (o.kind === "sfx" ? " ae-clip-sfx" : "") + (o.hidden || o.muted ? " dim" : "") + (o.locked ? " locked" : "")}
                  style={{
                    left: `${(o.start / timelineSpan) * 100}%`,
                    width: `${Math.max(3, (o.duration / timelineSpan) * 100)}%`,
                  }}
                  onClick={() => {
                    setSelected(o.id);
                    setSection(
                      o.kind === "subtitle"
                        ? "Subtitles"
                        : o.kind === "text"
                          ? "Text"
                          : o.kind === "shape"
                            ? "Objects"
                            : o.kind === "sfx" ? (o.music ? "Music" : "Sound FX") : "Video",
                    );
                  }}
                  onDragOver={(e) => { if (e.dataTransfer.types.includes("application/x-frame-preset")) e.preventDefault(); }}
                  onDrop={(e) => { const id = e.dataTransfer.getData("application/x-frame-preset"); if (id) { e.preventDefault(); applyPresetToLayer(o.id, id); setSelected(o.id); } }}
                  onPointerDown={event => startTimelineDrag(event, o)}
                  onPointerMove={moveTimelineDrag}
                  onPointerUp={stopTimelineDrag}
                  onPointerCancel={stopTimelineDrag}
                >
                  <span className="ae-trim-handle ae-trim-start" data-trim="start" aria-hidden="true" />
                  <span className="ae-clip-icon" aria-hidden="true">{clipIcon(o)}</span><span className="ae-clip-name">{o.name}</span>
                  {o.kind === "sfx" && <SfxWave id={o.sfxId} segments={o.segments || null} rev={soundRev} />}
                  {!open && distinct.map((tm, j) => (
                      <span
                        className="ae-diamond"
                        key={j}
                        style={{ left: `${((tm - o.start) / o.duration) * 100}%` }}
                      >
                        ◆
                      </span>
                    ))}
                  <span className="ae-trim-handle ae-trim-end" data-trim="end" aria-hidden="true" />
                </button>
              </div>
              {open && rows.map((prop) => {
                const frames = o.keyframes?.[prop] || [], def = PROPERTY_DEFS[prop], sorted = [...frames].sort((a, b) => a.time - b.time);
                return (
                  <div className={"ae-proptrack" + (frames.length ? "" : " idle")} key={prop} onPointerDown={(e) => { if (e.target === e.currentTarget) { setSelKf([]); } }} onDoubleClick={(e) => { if (e.target !== e.currentTarget) return; const r = e.currentTarget.getBoundingClientRect(), at = clamp(((e.clientX - r.left) / r.width) * timelineSpan, 0, duration); setSelected(o.id); setTime(snapToFrameT(at)); mutate(o.id, (x) => ({ ...x, animationEnabled: { ...x.animationEnabled, [prop]: true }, keyframes: { ...x.keyframes, [prop]: upsertKeyframe(x.keyframes?.[prop] || [], { time: at, value: sampleProperty(x, prop, at, evalCtxRef.current) }, fps) } })); }}>
                    <span className="ae-proplabel">{def?.label || prop}</span>
                    {sorted.length > 1 && <i className="ae-propbar" style={{ left: `${(sorted[0].time / timelineSpan) * 100}%`, width: `${((sorted.at(-1).time - sorted[0].time) / timelineSpan) * 100}%` }} />}
                    {sorted.map((f) => {
                      const id = kfKey(o.id, prop, f.id), on = selKf.includes(id);
                      return (
                        <button key={f.id} className={"ae-kf" + (on ? " on" : "") + (f.ease === "Hold" ? " hold" : "")}
                          style={{ left: `${(f.time / timelineSpan) * 100}%` }}
                          title={`${def?.label || prop} · ${f.time.toFixed(2)}s · ${typeof f.value === "number" ? Math.round(f.value * 100) / 100 : f.value}`}
                          aria-label={`${def?.label || prop} keyframe at ${f.time.toFixed(2)} seconds`}
                          data-kf={kfKey(o.id, prop, f.id)} onContextMenu={(e) => e.preventDefault()} onPointerDown={(e) => startKfDrag(e, o.id, prop, f)} onPointerMove={moveKfDrag} onPointerUp={endKfDrag} onPointerCancel={endKfDrag}
                          onDoubleClick={(e) => { e.stopPropagation(); setGraphOpen(true); }}>
                          <svg width="14" height="14" viewBox="0 0 14 14"><path d="M7 .8 13.2 7 7 13.2.8 7Z" /></svg>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
              </div>
              );
            })
          ) : (
            <button
              className="ae-dropzone"
              onClick={() => fileInput.current?.click()}
            >
              ◉　Drag and drop media, or click to add
            </button>
          )}
    </>
  ), [layers, expanded, selKf, multiSelected, selected, timelineSpan, duration, uiMode, fps, snapOn, markers, hasClip, soundRev, dragId]);

  return (
    <div className="ae-root">
      <input
        ref={fileInput}
        hidden
        multiple
        type="file"
        accept="video/*,image/*,audio/*"
        onChange={(e) => {
          importFiles([...e.target.files]);
          e.target.value = "";
        }}
      />
      <input
        ref={audioInput}
        hidden
        type="file"
        accept="audio/*"
        onChange={(e) => {
          importFiles([...e.target.files]);
          e.target.value = "";
        }}
      />
      <audio ref={audioEl} src={audioSrc || undefined} hidden />
      <div className="ae-top">
        <div className="ae-left">
          <nav className="ae-rail">
            <button
              className="ae-exit"
              onClick={() => go("/dashboard")}
              aria-label="Back to dashboard"
            >
              <ArrowLeft size={18} />
            </button>
            {sections.map(([s, I]) => (
              <button
                key={s}
                className={section === s ? "active" : ""}
                onClick={() => {
                  setSection(s);
                  setSelected(null);
                }}
              >
                <I size={21} />
                <span>{s}</span>
              </button>
            ))}
          </nav>
          <aside className="ae-panel">{sidebar}</aside>
        </div>
        <div className="ae-stage">
          <div className="ae-stagebar">
            <input
              aria-label="Video title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <Check size={14} color="#7c8794" />
            <button onClick={() => setModal("quality")}>
              ▣ Preview Auto (270p) <ChevronDown size={13} />
            </button>
            <div className="ae-spacer" />
            <button
              className="ae-format-button"
              onClick={() => setModal("format")}
            >
              {aspect} <ChevronDown size={13} />
            </button>
            <select className="ae-fps" aria-label="Project frame rate" value={fps} onChange={(e) => setFps(Number(e.target.value))} title="Project frame rate">{[24, 25, 30, 60].map((f) => <option key={f} value={f}>{f} fps</option>)}</select>
            <button
              className={autoKey ? "ae-autokey active" : "ae-autokey"}
              onClick={() => setAutoKey((v) => !v)}
              aria-pressed={autoKey}
              aria-label={`Auto-key ${autoKey ? "on" : "off"}`}
              title="Automatically add a keyframe when you edit an animatable property"
            >
              ◆ <span>Auto-key {autoKey ? "on" : "off"}</span>
            </button>
            <button
              onClick={() => stage.current?.requestFullscreen?.()}
              aria-label="Watch preview fullscreen"
              title="Watch preview fullscreen"
            >
              <Maximize size={15} /> <span>Fullscreen</span>
            </button>
            <button onClick={() => setModal("review")}>☑ Review</button>
            <button onClick={() => setModal("exports")}>
              <CloudUpload size={15} /> Exports
            </button>
            <button className="ae-export" onClick={exportVideo}>
              <Download size={15} /> Export video
            </button>
          </div>
          {graphOpen && layer && <GraphEditor layer={layer} time={time} fps={fps} selKf={selKf} api={graphApi} ctx={evalCtxRef.current} onClose={() => setGraphOpen(false)} />}
          <div className="ae-canvas-area" ref={stage}>
            <canvas className="ae-full-blur" ref={blurCanvas} width="320" height="180" aria-hidden="true"/>
            <div
              className="ae-canvas-wrap"
              style={{
                aspectRatio: aspect.replace(":", "/"),
                "--ae-ratio": canvasSize.width / canvasSize.height,
              }}
            >
              <canvas
                ref={canvas}
                width={canvasSize.width}
                height={canvasSize.height}
                onClick={onStageClick}
                onDragOver={(e) => { if (e.dataTransfer.types.includes("application/x-frame-preset") || e.dataTransfer.types.includes("application/x-frame-sfx")) e.preventDefault(); }}
                onDrop={(e) => {
                  const b = canvas.current.getBoundingClientRect(), px = ((e.clientX - b.left) / b.width) * 100, py = ((e.clientY - b.top) / b.height) * 100;
                  const hit = layerAt(px, py);
                  const presetId = e.dataTransfer.getData("application/x-frame-preset");
                  if (presetId) { e.preventDefault(); if (hit) { applyPresetToLayer(hit.id, presetId); setSelected(hit.id); } else setToast("Drop the preset onto an object."); }
                }}
              />
              {selPose && layer && time >= layer.start && time <= layer.start + layer.duration && (
                <>
                  {pathInfo && (
                    <svg className="ae-path" viewBox={`0 0 ${canvasSize.width} ${canvasSize.height}`} preserveAspectRatio="none" aria-hidden="true">
                      <polyline points={pathInfo.pts.map((p) => p.join(",")).join(" ")} className="ae-path-line" onDoubleClick={addPathNode} />
                      {pathInfo.arrows.map((a, i) => <path key={i} className="ae-path-arrow" transform={`translate(${a.x} ${a.y}) rotate(${a.deg})`} d="M-9 -7 L7 0 L-9 7 Z" />)}
                      {uiMode === "advanced" && pathInfo.handles.map((h) => <g key={h.id}><line className="ae-path-arm" x1={h.mx} y1={h.my} x2={h.x} y2={h.y} /><rect className="ae-path-bend" x={h.x - 8} y={h.y - 8} width="16" height="16" transform={`rotate(45 ${h.x} ${h.y})`} onPointerDown={(e) => startBend(e, h)} onPointerMove={moveBend} onPointerUp={endBend}><title>Drag to curve this segment</title></rect></g>)}
                      {pathInfo.nodes.map((n) => <circle key={n.t} className={"ae-path-node" + (Math.abs(n.t - time) < 0.5 / fps ? " here" : "")} cx={n.x} cy={n.y} r="10" onPointerDown={(e) => startNode(e, n)} onPointerMove={moveNode} onPointerUp={endNode}><title>{`Keyframe at ${n.t.toFixed(2)}s — drag to move`}</title></circle>)}
                    </svg>
                  )}
                  {guides.includes("v") && <i className="ae-guide ae-guide-v" />}
                  {guides.includes("h") && <i className="ae-guide ae-guide-h" />}
                  <div
                    className="ae-selection"
                    style={{
                      left: `${selCenter.x}%`,
                      top: `${selCenter.y}%`,
                      width: `${((selBox.w * selPose.scale) / 100 / canvasSize.width) * 100}%`,
                      height: `${((selBox.h * selPose.scale) / 100 / canvasSize.height) * 100}%`,
                      transform: `translate(-50%,-50%) rotate(${selPose.rotation}deg)`,
                    }}
                    onPointerDown={startDrag}
                    onPointerMove={moveDrag}
                    onPointerUp={(e) => {
                      if (drag.current?.before && drag.current.before !== layersRef.current) commitPreview(drag.current.before);
                      drag.current = null;
                      setGuides([]);
                      setIsDragging(false);
                      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* released */ }
                    }}
                  >
                    {["nw", "ne", "sw", "se"].map((h) => <i key={h} data-h={h} aria-label="Resize" onPointerDown={startScale} onPointerMove={moveXform} onPointerUp={endXform} />)}
                    <b className="ae-rotate" aria-label="Rotate" onPointerDown={startRotate} onPointerMove={moveXform} onPointerUp={endXform}>⟳</b>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        {layer && <aside className="ae-props" aria-label="Properties">
          <PropertiesPanel onKeyAll={keyframeAll} keyAllOn={!!layer && allKeyProps(layer).every((p) => keyframeAt(layer.keyframes?.[p], time, fps))} layer={layer} time={time} fps={fps} api={motionApi} patch={patchLayer} edit={edit} layers={layers} duration={duration} mode={uiMode} setMode={(m) => { setUiMode(m); try { localStorage.setItem("frame-editor-mode", m); } catch { /* storage unavailable */ } }} hasAudio={!!audioPcm} graphOpen={graphOpen} setGraphOpen={setGraphOpen} guide={animGuide && layer && animGuide.layerId === layer.id ? animGuide : null} onAnimate={startAnimate} onDoneGuide={() => setAnimGuide(null)} onPlay={() => { if (layer) { setTime(layer.start); setPlaying(true); } }} />
        </aside>}
      </div>
      <div className="ae-timeline">
        <div className="ae-toolbar">
          <div>
            <button onClick={undo} title="Undo">
              <Undo2 size={18} />
            </button>
            <button onClick={redo} title="Redo">
              <Redo2 size={18} />
            </button>
            <button onClick={splitSelected} title="Split selected layer (C)">
              <Scissors size={17} />
            </button>
            <button
              onClick={() => {
                if (layer) {
                  change((v) => v.filter((x) => x.id !== selected));
                  setSelected(null);
                }
              }}
              title="Delete layer"
            >
              <Trash2 size={17} />
            </button>
            <button onClick={groupSelected} disabled={multiSelected.length < 2} title="Group selected clips (⌘/Ctrl+G)"><Group size={17}/></button>
            <button onClick={ungroupSelected} disabled={!layer?.groupId} title="Ungroup selected clips (⌘/Ctrl+Shift+G)"><Ungroup size={17}/></button>
            <button
              onClick={addMarker}
              title="Add marker"
            >
              <Flag size={17} />
            </button>
            <span className="ae-sep" />
            <button className={"ae-keyall" + (layer && allKeyProps(layer).every((p) => keyframeAt(layer.keyframes?.[p], time, fps)) ? " on" : "")} onClick={keyframeAll} disabled={!layer} title="Keyframe all — add (or remove) a keyframe on every property of the selected layer at the playhead" aria-label="Keyframe all properties"><svg width="15" height="15" viewBox="0 0 14 14"><path d="M7 1 13 7 7 13 1 7Z" /></svg><span>Keyframe all</span></button>
            <button className={snapOn ? "on" : ""} onClick={() => setSnapOn((v) => !v)} aria-pressed={snapOn} title="Snap to frames, markers and keyframes"><Magnet size={17} /></button>
            <button className={graphOpen ? "on" : ""} onClick={() => setGraphOpen((v) => !v)} aria-pressed={graphOpen} title="Graph editor"><ChartSpline size={17} /></button>
            {selKf.length > 0 && (
              <span className="ae-kfbar" role="group" aria-label="Selected keyframes">
                <button onClick={copySelectedKf} title="Copy selected keyframes"><Copy size={16} /></button>
                <button onClick={pasteKf} disabled={!hasClip} title="Paste keyframes at playhead"><ClipboardPaste size={16} /></button>
                <button onClick={reverseSelectedKf} title="Reverse selected keyframes"><FlipHorizontal2 size={16} /></button>
                <button onClick={() => stretchSelectedKf(0.5)} title="Compress timing (½×)"><ArrowLeftRight size={16} /></button>
                <button onClick={() => stretchSelectedKf(2)} title="Stretch timing (2×)" style={{ transform: "scaleX(1.3)" }}><ArrowLeftRight size={16} /></button>
                <button onClick={deleteSelectedKf} title="Delete selected keyframes"><Trash2 size={16} /></button>
              </span>
            )}
          </div>
          <div className="ae-transport">
            <button onClick={() => setTime(0)}>◀▮</button>
            <button
              aria-label={playing ? "Pause" : "Play"}
              onClick={() => setPlaying((v) => !v)}
            >
              {playing ? (
                <Pause size={24} />
              ) : (
                <Play size={25} fill="currentColor" />
              )}
            </button>
            <button onClick={() => setTime(duration)}>▮▶</button>
            <span>
              {fmt(time)} / {fmt(duration)}
            </span>
          </div>
          <div className="ae-zoom">
            <ZoomOut size={16} />
            <input
              type="range"
              value={zoom}
              onChange={(e) => setZoom(+e.target.value)}
            />
            <ZoomIn size={16} />
            <button onClick={() => setZoom(50)}>Fit</button>
            <button
              title="Keyboard shortcuts"
              onClick={() => setModal("shortcuts")}
            >
              <Keyboard size={17} />
            </button>
          </div>
        </div>
        <div
          className="ae-ruler"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setTime(clamp(((e.clientX - r.left - 28) / (r.width - 38)) * timelineSpan, 0, duration));
          }}
        >
          {Array.from({ length: 8 }, (_, i) => (
            <span key={i} style={{ left: `calc(28px + (100% - 38px) * ${i / 8})` }}>{Math.round((i * timelineSpan) / 8)}s</span>
          ))}
        </div>
        <div className="ae-timeline-overlays" aria-hidden="true">
          <div className="ae-playhead" style={{ left: `${(time / timelineSpan) * 100}%` }}/>
          {markers.map(marker => <button className="ae-marker" key={marker.id} style={{left:`${(marker.time / timelineSpan) * 100}%`,color:marker.color}} title={marker.name || `Marker at ${fmt(marker.time)}`} aria-label={marker.name || `Marker at ${fmt(marker.time)}`} onPointerDown={event=>startMarkerDrag(event,marker)} onPointerMove={moveMarkerDrag} onPointerUp={()=>{markerDrag.current=null}} onPointerCancel={()=>{markerDrag.current=null}} onClick={()=>{if(markerJustMoved.current){markerJustMoved.current=false;return}setSelectedMarker(marker.id);setModal('marker');setTime(marker.time)}}>⚑</button>)}
        </div>
        <div className="ae-tracks" ref={tracksRef} onPointerDown={(e) => { if (e.target === e.currentTarget) setSelKf([]); else marqueeStart(e); }}
          onDragOver={(e) => { if (e.dataTransfer.types.includes("application/x-frame-sfx")) e.preventDefault(); }}
          onDrop={(e) => {
            const id = e.dataTransfer.getData("application/x-frame-sfx");
            if (!id) return;
            e.preventDefault();
            const r = tracksRef.current.getBoundingClientRect(), left = r.left + 28, width = r.width - 38;
            addSfx(id, clamp(((e.clientX - left) / width) * timelineSpan, 0, duration), { snap: snapOn });
          }}>
          {trackRows}
          {marquee && <i className="ae-marquee" style={marquee} />}
        </div>
      </div>
      {kfMenu && selKf.length > 0 && (
        <div className="ae-kfmenu-wrap" onPointerDown={() => setKfMenu(null)} onContextMenu={(e) => { e.preventDefault(); setKfMenu(null); }}>
          <div className="ae-kfmenu" role="menu" style={{ left: Math.min(kfMenu.x, window.innerWidth - 230), top: Math.max(8, Math.min(kfMenu.y, window.innerHeight - 340)) }} onPointerDown={(e) => e.stopPropagation()}>
            <header>{selKf.length} keyframe{selKf.length > 1 ? "s" : ""} selected · drag any to move</header>
            {[["Go to keyframe", jumpToSelectedKf], ["Copy", copySelectedKf], ["Paste at playhead", pasteKf, !hasClip], ["Duplicate", duplicateSelectedKf], ["Reverse", reverseSelectedKf], ["Open in graph editor", () => setGraphOpen(true)]].map(([label, fn, off]) => <button key={label} role="menuitem" disabled={off} onClick={() => { fn(); setKfMenu(null); }}>{label}</button>)}
            <div className="ae-kfmenu-sep">Easing</div>
            <div className="ae-kfmenu-ease">{EASING_OPTIONS.map((n) => <button key={n} role="menuitem" onClick={() => { setEaseSelectedKf(n); setKfMenu(null); }}>{EASING_LABELS[n]}</button>)}</div>
            <button role="menuitem" className="danger" onClick={() => { deleteSelectedKf(); setKfMenu(null); }}>Delete</button>
          </div>
        </div>
      )}
      {soundEditorFor && layers.find((l) => l.id === soundEditorFor && l.kind === "sfx") && <SoundEditor layer={layers.find((l) => l.id === soundEditorFor)} onChange={(patch) => mutate(soundEditorFor, (x) => ({ ...x, ...patch }))} onClose={() => setSoundEditorFor(null)} />}
      {toast && <div className="ae-toast" role="status">{toast}</div>}
      {modal && (
        <div className="ae-modal-bg" onClick={() => setModal("")}>
          <div
            className={modal === "shortcuts" ? "ae-modal ae-modal-shortcuts" : "ae-modal"}
            role="dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <button className="ae-close" onClick={() => setModal("")}>
              <X size={18} />
            </button>
            <h2>
              {modal === "export"
                ? "Export video"
                : modal === "quality"
                  ? "Preview quality"
                  : modal === "review"
                    ? "Review clip"
                    : modal === "shortcuts"
                      ? "Keyboard shortcuts"
                      : modal === "marker"
                        ? "Edit marker"
                      : modal === "cloud"
                        ? "Cloud uploads"
                        : modal === "exports"
                          ? "Exports"
                          : modal === "format"
                            ? "Canvas format"
                            : modal === "stock-audio"
                              ? "Stock audio"
                            : modal}
            </h2>
            {modal === "export" ? (
              <>
                <p>{exportStatus}</p>
                <div className="ae-progress">
                  <i style={{ width: `${exportProgress}%` }} />
                </div>
                <strong>{exportProgress}%</strong>
                <p>
                  Rendering happens in this browser. No credits or cloud backend
                  are used.
                </p>
              </>
            ) : modal === "marker" ? (
              <div className="ae-marker-editor">
                <label>Name<input aria-label="Marker name" placeholder="Name this marker" value={markers.find(marker=>marker.id===selectedMarker)?.name || ''} onChange={event=>setMarkers(items=>items.map(marker=>marker.id===selectedMarker?{...marker,name:event.target.value}:marker))}/></label>
                <label>Colour<input aria-label="Marker colour" type="color" value={markers.find(marker=>marker.id===selectedMarker)?.color || '#4e70ef'} onChange={event=>setMarkers(items=>items.map(marker=>marker.id===selectedMarker?{...marker,color:event.target.value}:marker))}/></label>
                <button onClick={()=>{setMarkers(items=>items.filter(marker=>marker.id!==selectedMarker));setModal('');setSelectedMarker(null)}}><Trash2 size={15}/> Delete marker</button>
              </div>
            ) : modal === "quality" ? (
              <div className="ae-list">
                {["Auto (270p)", "720p", "1080p"].map((x) => (
                  <button key={x} onClick={() => setModal("")}>
                    {x}
                  </button>
                ))}
              </div>
            ) : modal === "shortcuts" ? (
              <><p className="ae-shortcut-hint">Shortcuts work whenever you are not typing in a field.</p><div className="ae-shortcuts">{[
                ['Playback', [['Play or pause','Space'],['Step one frame','← / →'],['Step half a frame','Alt + ← / →'],['Scrub half a second','Shift + ← / →'],['Jump to start or end','Home / End']]],
                ['Editing', [['Split selected layer at playhead','C'],['Duplicate selected layer','⌘/Ctrl + D'],['Delete selected layer','Delete'],['Undo','⌘/Ctrl + Z'],['Redo','⇧ + ⌘/Ctrl + Z'],['Group selected clips','⌘/Ctrl + G'],['Ungroup selected clips','⇧ + ⌘/Ctrl + G'],['Deselect and close dialog','Esc']]],
                ['Canvas', [['Watch preview fullscreen','F'],['Show this shortcut menu','?']]],
                ['Timeline', [['Add or edit marker at playhead','M'],['Previous or next marker','[ / ]'],['Name, colour, or delete marker','Click marker'],['Move marker','Drag marker'],['Zoom timeline in or out','+ / −'],['Move a clip','Drag clip'],['Trim a clip','Drag clip edge']]],
              ].map(([group, actions])=><section key={group}><h3>{group}</h3>{actions.map(([action,key])=><div key={action}><span>{action}</span><kbd>{key}</kbd></div>)}</section>)}</div></>
            ) : modal === "format" ? (
              <div className="ae-list">
                {[
                  ["9:16", "Vertical · Shorts and stories"],
                  ["16:9", "Widescreen · standard video"],
                  ["1:1", "Square · social posts"],
                ].map(([ratio, label]) => (
                  <button
                    key={ratio}
                    className={aspect === ratio ? "active" : ""}
                    onClick={() => {
                      setAspect(ratio);
                      setModal("");
                    }}
                  >
                    <strong>{ratio}</strong>
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            ) : modal === "emoji" ? (
              <div className="ae-emoji">
                {"😀 😍 😂 🔥 ✨ 💙 👀 🎉 😭 🤯".split(" ").map((x) => (
                  <button
                    key={x}
                    onClick={() => {
                      add({
                        kind: "text",
                        text: x,
                        fontSize: 150,
                        name: "Emoji",
                        start: time,
                      });
                      setModal("");
                    }}
                  >
                    {x}
                  </button>
                ))}
              </div>
            ) : (
              <p>
                {modal === "review"
                  ? "Preview and scrub your composition before exporting."
                  : modal === "cloud"
                    ? "Cloud uploads are not connected. Use local media imports."
                    : modal === "exports"
                      ? "Local exports download directly to your device."
                      : modal === "stock-audio"
                        ? "The licensed stock-audio catalog is not connected in this local editor. Upload audio you have permission to use; imported audio previews and mixes into local exports."
                      : "This AI service is not connected in the local editor. You can still add and animate media, text, captions, and shapes."}
              </p>
            )}
            {modal !== "shortcuts" && <button onClick={() => setModal("")}>Close</button>}
          </div>
        </div>
      )}
    </div>
  );
}

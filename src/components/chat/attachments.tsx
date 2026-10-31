import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Download, X } from "lucide-react";
import { AI_EASE } from "./assistant/motion";
import "./attachments.css";

export type FileKind = "image" | "pdf" | "video" | "audio" | "text" | "archive" | "other";

const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|jsonc|ya?ml|xml|html?|css|scss|less|jsx?|tsx?|mjs|cjs|py|rb|go|rs|java|c|cpp|h|hpp|sh|bash|zsh|sql|log|ini|toml|env|svg|swift|kt|php|lua|r)$/i;
const ARCHIVE_EXT = /\.(zip|tar|gz|tgz|rar|7z|bz2)$/i;

export function fileKind(name: string, type = ""): FileKind {
  if (type.startsWith("image/") && type !== "image/svg+xml") return "image";
  if (type === "application/pdf" || /\.pdf$/i.test(name)) return "pdf";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("text/") || type === "application/json" || type === "image/svg+xml" || TEXT_EXT.test(name)) return "text";
  if (ARCHIVE_EXT.test(name)) return "archive";
  return "other";
}

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const KIND_LABEL: Record<FileKind, string> = {
  image: "Image", pdf: "PDF", video: "Video", audio: "Audio", text: "Text", archive: "Archive", other: "File",
};

const KIND_TINT: Record<FileKind, { bg: string; ink: string }> = {
  image: { bg: "#e8f1ff", ink: "#1e5fd8" },
  pdf: { bg: "#fdeceb", ink: "#c0392b" },
  video: { bg: "#f1ebff", ink: "#6a42c9" },
  audio: { bg: "#fff1e0", ink: "#b8690a" },
  text: { bg: "#e9f6ee", ink: "#25804c" },
  archive: { bg: "#f4efe6", ink: "#8a6a2f" },
  other: { bg: "#eef0f3", ink: "#4b505a" },
};

export function describeFile(file: { name: string; type?: string; size?: number }) {
  const kind = fileKind(file.name, file.type);
  const ext = file.name.includes(".") ? file.name.split(".").pop()!.toUpperCase().slice(0, 5) : KIND_LABEL[kind].toUpperCase();
  return { kind, ext, label: KIND_LABEL[kind], size: file.size != null ? formatBytes(file.size) : "" };
}

/** Thumbnail for the composer card: a real image preview, otherwise a tinted type badge. */
export function AttachmentThumb({ file, name }: { file?: File; name: string }) {
  const info = describeFile(file ?? { name });
  const url = useObjectUrl(info.kind === "image" ? file : undefined);
  if (url) return <img src={url} alt="" draggable={false} />;
  const tint = KIND_TINT[info.kind];
  return <span style={{ "--attach-tint": tint.bg, "--attach-ink": tint.ink } as CSSProperties} className="clyra-attach-badge">{info.ext}</span>;
}

function useObjectUrl(file?: File) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) { setUrl(null); return; }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}

const TEXT_PREVIEW_LIMIT = 200_000;

/** Preview for any attached file. Everything is rendered from a local blob; nothing is uploaded. */
export function FilePreviewDialog({ file, onClose }: { file: File | null; onClose: () => void }) {
  const reduced = useReducedMotion();
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const info = useMemo(() => (file ? describeFile(file) : null), [file]);
  const url = useObjectUrl(file ?? undefined);
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    setText(null);
    if (!file || info?.kind !== "text") return;
    let live = true;
    file.slice(0, TEXT_PREVIEW_LIMIT).text().then((value) => { if (live) setText(value); }).catch(() => { if (live) setText(""); });
    return () => { live = false; };
  }, [file, info?.kind]);

  useEffect(() => {
    if (!file) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [file, onClose]);

  return createPortal(
    <AnimatePresence>
      {file && info ? (
        <motion.div
          key="backdrop"
          className="clyra-filepreview-backdrop"
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.18 }}
          onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
        >
          <motion.div
            className="clyra-filepreview"
            role="dialog"
            aria-modal="true"
            aria-label={`Preview of ${file.name}`}
            initial={reduced ? false : { opacity: 0, y: 8, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.99 }}
            transition={{ duration: reduced ? 0 : 0.22, ease: AI_EASE }}
          >
            <header className="clyra-filepreview__head">
              <span className="clyra-filepreview__title">
                <strong>{file.name}</strong>
                <span>{[info.label, info.size].filter(Boolean).join(" · ")}</span>
              </span>
              {url ? (
                <a className="clyra-filepreview__btn" href={url} download={file.name} aria-label="Download file" title="Download">
                  <Download size={16} />
                </a>
              ) : null}
              <button ref={closeRef} type="button" className="clyra-filepreview__btn" onClick={onClose} aria-label="Close preview" title="Close">
                <X size={16} />
              </button>
            </header>
            <div className="clyra-filepreview__body">
              {info.kind === "image" && url ? <img src={url} alt={file.name} className="clyra-filepreview__image" /> : null}
              {info.kind === "pdf" && url ? <iframe src={url} title={file.name} className="clyra-filepreview__frame" /> : null}
              {info.kind === "video" && url ? <video src={url} controls className="clyra-filepreview__media" /> : null}
              {info.kind === "audio" && url ? <audio src={url} controls className="clyra-filepreview__audio" /> : null}
              {info.kind === "text" ? (
                <pre className="clyra-filepreview__text">{text === null ? "Loading…" : text || "This file is empty."}{file.size > TEXT_PREVIEW_LIMIT ? "\n\n… Showing the first 200 KB." : ""}</pre>
              ) : null}
              {info.kind === "archive" || info.kind === "other" ? (
                <div className="clyra-filepreview__card">
                  <span className="clyra-attach-card__thumb clyra-filepreview__badge"><AttachmentThumb file={file} name={file.name} /></span>
                  <strong>{file.name}</strong>
                  <span>{[info.label, info.size, file.type || "Unknown type"].filter(Boolean).join(" · ")}</span>
                  <p>This file type can't be previewed here. You can still attach it, or download a copy.</p>
                </div>
              ) : null}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

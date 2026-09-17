import { useEffect, useState, type ComponentPropsWithoutRef } from "react";
import { createPortal } from "react-dom";
import Markdown, { type Components } from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import oneLight from "react-syntax-highlighter/dist/esm/styles/prism/one-light.js";
import remarkGfm from "remark-gfm";
import { Check, Copy, ExternalLink, Maximize2, Minimize2, Play, RefreshCw, X } from "lucide-react";
import { cn } from "../lib/utils";
import { useTerminalRunner } from "./terminal/TerminalRunnerProvider";
import { getLanguageDisplayName, isPreviewableLanguage, isRunnableLanguage } from "../lib/runnableLanguages";

type CodeProps = ComponentPropsWithoutRef<"code"> & {
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
};

type PreviewPayload = { html: string; url: string };

function CodePreviewDialog({
  language,
  text,
  onClose,
}: {
  language: string;
  text: string;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setPreview(null);
    setError(null);
    void fetch("/api/notes/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ language, code: text }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json() as Partial<PreviewPayload> & { error?: string };
        if (!response.ok || payload.error || !payload.html || !payload.url) {
          throw new Error(payload.error || "Preview failed");
        }
        setPreview({ html: payload.html, url: new URL(payload.url, window.location.origin).href });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "Preview failed");
      });
    return () => controller.abort();
  }, [language, text, reloadKey]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (fullscreen) {
        setFullscreen(false);
      } else {
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [fullscreen, onClose]);

  const title = `${getLanguageDisplayName(language)} preview`;
  return createPortal(
    <div className="clyra-code-preview-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        className={cn("clyra-code-preview", fullscreen && "is-fullscreen")}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="clyra-code-preview__header">
          <span className="clyra-code-preview__address" title={preview?.url}>
            {preview ? new URL(preview.url).pathname.replace(/^\//, "") : "Starting preview…"}
          </span>
          <span className="clyra-code-preview__actions">
            <button type="button" aria-label="Reload preview" onClick={() => setReloadKey((value) => value + 1)}>
              <RefreshCw />
            </button>
            {preview ? (
              <button type="button" aria-label="Open preview externally" onClick={() => window.open(preview.url, "_blank", "noopener,noreferrer")}>
                <ExternalLink />
              </button>
            ) : null}
            <button type="button" aria-label={fullscreen ? "Exit full screen" : "Full screen"} onClick={() => setFullscreen((value) => !value)}>
              {fullscreen ? <Minimize2 /> : <Maximize2 />}
            </button>
            <button type="button" aria-label="Close preview" onClick={onClose}>
              <X />
            </button>
          </span>
        </header>
        {error ? <p className="clyra-code-preview__error">{error}</p> : null}
        {!error ? (
          <iframe
            className="clyra-code-preview__frame"
            title={title}
            srcDoc={preview?.html}
            sandbox="allow-scripts allow-forms allow-modals allow-popups"
          />
        ) : null}
      </section>
    </div>,
    document.body,
  );
}

function copyCode(text: string) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  return copied ? Promise.resolve() : Promise.reject(new Error("Copy unavailable"));
}

function CodeBlockHeader({ language, text }: { language: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const { runInTerminal } = useTerminalRunner();
  const runnable = isRunnableLanguage(language);
  const previewable = isPreviewableLanguage(language);
  return (
    <>
    <div className="clyra-code-block__header">
      <span className="clyra-code-block__language">{getLanguageDisplayName(language)}</span>
      <span className="clyra-code-block__actions">
        <button
          type="button"
          className="clyra-code-block__copy"
          aria-label={copied ? "Code copied" : "Copy code"}
          title={copied ? "Code copied" : "Copy code"}
          onClick={() => {
            void copyCode(text).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1600);
            }).catch(() => undefined);
          }}
        >
          {copied ? <Check /> : <Copy />}
        </button>
        {previewable ? (
          <button
            type="button"
            className="clyra-code-block__run"
            aria-label={`Preview ${getLanguageDisplayName(language)}`}
            title={`Preview ${getLanguageDisplayName(language)}`}
            onClick={() => setPreviewOpen(true)}
          >
            <Play fill="currentColor" strokeWidth={0} />
          </button>
        ) : runnable ? (
          <button
            type="button"
            className="clyra-code-block__run"
            aria-label={`Run ${getLanguageDisplayName(language)}`}
            title={`Run ${getLanguageDisplayName(language)}`}
            onClick={() => runInTerminal(text, language)}
          >
            <Play fill="currentColor" strokeWidth={0} />
          </button>
        ) : null}
      </span>
    </div>
    {previewOpen ? <CodePreviewDialog language={language} text={text} onClose={() => setPreviewOpen(false)} /> : null}
    </>
  );
}

export function MarkdownMessageContent({
  content,
  codeHighlighting = true,
  codePresentation = "default",
  /** When true, fenced blocks are omitted and inline code is plain text (e.g. Vibe mode — no code UI). */
  suppressCodeBlocks = false,
}: {
  content: string;
  codeHighlighting?: boolean;
  /** `soft` = light surface for Vibe coder (no dark code slab). */
  codePresentation?: "default" | "soft";
  suppressCodeBlocks?: boolean;
}) {
  const soft = codePresentation === "soft";

  const components: Partial<Components> = {
    // react-markdown normally leaves its `<pre>` around the customized code
    // renderer. That legacy wrapper carried the chat's old border/background,
    // creating a second card around the Clyra Notes surface.
    pre({ children }) {
      return <>{children}</>;
    },
    a({ href, children, node: _node, ref: _ref, ...props }) {
      const isClipperVideo =
        typeof href === "string" && false && href.endsWith(".mp4");
      if (isClipperVideo) {
        return (
          <span className="my-3 block overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
            <video
              src={href}
              controls
              preload="metadata"
              className="block aspect-video w-full bg-slate-950"
            />
            <span className="flex items-center justify-between gap-3 px-3 py-2 text-[12px] font-semibold text-slate-600">
              <span>Generated MP4</span>
              <a
                {...props}
                href={href}
                download
                className="rounded-full bg-slate-950 px-3 py-1.5 text-white transition-colors hover:bg-slate-800"
              >
                {children}
              </a>
            </span>
          </span>
        );
      }
      const googleWorkspaceMatch = typeof href === "string"
        ? href.match(/^https:\/\/(docs\.google\.com\/(document|spreadsheets)\/|calendar\.google\.com\/|mail\.google\.com\/)/)
        : null;
      const googleWorkspaceLabel = googleWorkspaceMatch?.[2] === "spreadsheets"
        ? "Open Google Sheet"
        : googleWorkspaceMatch?.[2] === "document"
          ? "Open Google Doc"
          : href?.startsWith("https://calendar.google.com")
            ? "Open Google Calendar"
            : href?.startsWith("https://mail.google.com")
              ? "Open Gmail"
              : null;
      return (
        <a
          {...props}
          href={href}
          target={href?.startsWith("http") ? "_blank" : undefined}
          rel={href?.startsWith("http") ? "noopener noreferrer" : undefined}
          className={cn(
            googleWorkspaceLabel
              ? "clyra-workspace-open-link"
              : "font-semibold text-slate-900 underline decoration-slate-300 underline-offset-4 transition-colors hover:text-slate-600",
          )}
        >
          {googleWorkspaceLabel || children}
        </a>
      );
    },
    code({ inline, className, children, ...props }: CodeProps) {
      const match = /language-(\w+)/.exec(className || "");
      const text = String(children).replace(/\n$/, "");
      const isInlineCode = inline ?? !className;
      // Markdown allows an unlabelled fenced block. It still deserves the
      // same Clyra Notes-style surface and copy affordance as a typed block.
      const language = match?.[1] || "text";

      if (suppressCodeBlocks) {
        if (!isInlineCode && text.includes("\n")) return null;
        return (
          <span className="font-mono text-[0.94em] text-inherit" {...props}>
            {children}
          </span>
        );
      }

      if (!isInlineCode && codeHighlighting) {
        return (
          <div className={cn("clyra-code-block", soft ? "my-3" : "my-2")}>
            <CodeBlockHeader language={language} text={text} />
            <SyntaxHighlighter
              {...props}
              style={oneLight}
              language={language}
              PreTag="div"
              className={cn(
                "!my-0 !bg-transparent",
              )}
              customStyle={{
                margin: 0,
                padding: "0",
                fontSize: "13.5px",
                lineHeight: 1.6,
                overflowX: "auto",
              }}
            >
              {text}
            </SyntaxHighlighter>
          </div>
        );
      }
      return (
        <code
          {...props}
          className={cn(
            "rounded bg-slate-100/80 px-1 py-0.5 font-mono text-[0.9em]",
            className,
          )}
        >
          {children}
        </code>
      );
    },
  };

  return (
    <Markdown remarkPlugins={[remarkGfm]} components={components}>
      {content}
    </Markdown>
  );
}

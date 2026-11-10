import { useEffect, useRef, useState, type ComponentPropsWithoutRef } from "react";
import { createPortal } from "react-dom";
import Markdown, { type Components } from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import oneLight from "react-syntax-highlighter/dist/esm/styles/prism/one-light.js";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { ArrowLeft, ArrowRight, Check, Copy, ExternalLink, Maximize2, Minimize2, Play, RefreshCw, X } from "lucide-react";
import { cn } from "../lib/utils";
import { useTerminalRunner } from "./terminal/TerminalRunnerProvider";
import { getLanguageDisplayName, isPreviewableLanguage, isRunnableLanguage } from "../lib/runnableLanguages";

type CodeProps = ComponentPropsWithoutRef<"code"> & {
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
};

type PreviewPayload = { html: string; url: string };
type PreviewHistoryEntry = { url: string; html: string | null };

const LOCAL_PREVIEW_PATH = /^\/notes\/preview\//;

/** Compact label for the address bar — a local preview shows its own path, an external URL shows host+path. */
function previewAddressLabel(url: string): string {
  const parsed = new URL(url, window.location.origin);
  if (parsed.origin === window.location.origin && LOCAL_PREVIEW_PATH.test(parsed.pathname)) {
    return `${parsed.pathname.slice(1)}${parsed.search}${parsed.hash}`;
  }
  return parsed.href.replace(/^https?:\/\//, "");
}

/** Same address-bar parsing as Clyra Notes: bare URL, bare domain, relative path, or a search query. */
function previewDestination(value: string): string | null {
  const query = value.trim();
  if (!query) return null;
  if (/^https?:\/\//i.test(query)) return new URL(query).href;
  if (/^localhost(?::\d+)?(?:[/?#].*)?$/i.test(query)) return new URL(`http://${query}`).href;
  if (/^[\w.-]+\.[a-z]{2,}(?::\d+)?(?:[/?#].*)?$/i.test(query)) return new URL(`https://${query}`).href;
  if (/^(?:\/|\.\/|\.\.\/)/.test(query)) return new URL(query, window.location.origin).href;
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

/** srcDoc renders at an opaque origin, so a link click needs this bridge to reach the parent's address bar/history. */
function addPreviewLinkBridge(html: string, sourceUrl: string): string {
  const bridge = `<script>document.addEventListener("click",function(e){var a=e.target.closest&&e.target.closest("a[href]");if(!a||e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||a.target==="_blank")return;var h=a.getAttribute("href");if(!h||/^(?:#|mailto:|tel:|javascript:)/i.test(h))return;e.preventDefault();parent.postMessage({type:"clyra-chat-preview-link",url:new URL(h,${JSON.stringify(sourceUrl)}).href},"*");},true);</script>`;
  return /<\/body\s*>/i.test(html) ? html.replace(/<\/body\s*>/i, `${bridge}</body>`) : `${html}${bridge}`;
}

function CodePreviewDialog({
  language,
  text,
  onClose,
}: {
  language: string;
  text: string;
  onClose: () => void;
}) {
  const [history, setHistory] = useState<PreviewHistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [addressValue, setAddressValue] = useState("Starting preview…");
  const [error, setError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const addressRef = useRef<HTMLInputElement>(null);

  const current = historyIndex >= 0 ? history[historyIndex] : undefined;

  const visit = (url: string, html: string | null = null) => {
    setError(null);
    setHistory((prev) => {
      const next = [...prev.slice(0, historyIndex + 1), { url, html }];
      setHistoryIndex(next.length - 1);
      return next;
    });
  };

  // The initial fetch to render the code as a live preview, once per code block instance.
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/notes/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ language, code: text }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as Partial<PreviewPayload> & { error?: string };
        if (!response.ok || payload.error || !payload.html || !payload.url) {
          throw new Error(payload.error || "Preview failed");
        }
        const url = new URL(payload.url, window.location.origin).href;
        setHistory([{ url, html: addPreviewLinkBridge(payload.html, url) }]);
        setHistoryIndex(0);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "Preview failed");
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, text]);

  useEffect(() => {
    if (current) {
      setAddressValue(previewAddressLabel(current.url));
      setError(null);
    }
  }, [current?.url]);

  // Follows a link clicked inside the preview (via addPreviewLinkBridge's postMessage) the same way Notes does.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== "clyra-chat-preview-link") return;
      const destination = previewDestination(String(event.data.url || ""));
      if (destination) visit(destination);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyIndex]);

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

  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex >= 0 && historyIndex < history.length - 1;

  const goBack = () => canGoBack && setHistoryIndex((i) => i - 1);
  const goForward = () => canGoForward && setHistoryIndex((i) => i + 1);
  const reload = () => {
    if (!current) return;
    // Bumps the iframe's key so it actually remounts and re-renders from scratch.
    setReloadNonce((n) => n + 1);
  };

  const handleAddressKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const destination = previewDestination(addressValue);
    if (destination) visit(destination);
    else if (current) setAddressValue(previewAddressLabel(current.url));
  };

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
          <span className="clyra-code-preview__actions">
            <button type="button" aria-label="Go back" disabled={!canGoBack} onClick={goBack}>
              <ArrowLeft />
            </button>
            <button type="button" aria-label="Go forward" disabled={!canGoForward} onClick={goForward}>
              <ArrowRight />
            </button>
            <button type="button" aria-label="Reload preview" onClick={reload} disabled={!current}>
              <RefreshCw />
            </button>
          </span>
          <input
            ref={addressRef}
            className="clyra-code-preview__address clyra-code-preview__address--input"
            value={error ? error : addressValue}
            onChange={(event) => setAddressValue(event.target.value)}
            onFocus={() => addressRef.current?.select()}
            onKeyDown={handleAddressKeyDown}
            aria-label="Preview address or web search"
            aria-invalid={Boolean(error)}
            autoComplete="off"
            spellCheck={false}
          />
          <span className="clyra-code-preview__actions">
            <button type="button" aria-label="Copy preview URL" disabled={!current} onClick={() => {
              if (!current) return;
              void navigator.clipboard?.writeText(current.url).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1600);
              }).catch(() => undefined);
            }}>
              {copied ? <Check /> : <Copy />}
            </button>
            {current ? (
              <button type="button" aria-label="Open preview externally" onClick={() => window.open(current.url, "_blank", "noopener,noreferrer")}>
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
        {current ? (
          current.html !== null ? (
            <iframe
              key={`${historyIndex}-${current.url}-${reloadNonce}`}
              className="clyra-code-preview__frame"
              title={title}
              srcDoc={current.html}
              sandbox="allow-scripts allow-forms allow-modals allow-popups"
            />
          ) : (
            <iframe
              key={`${historyIndex}-${current.url}-${reloadNonce}`}
              className="clyra-code-preview__frame"
              title={title}
              src={current.url}
              sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin"
            />
          )
        ) : !error ? (
          <div className="clyra-code-preview__frame" />
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

/* KaTeX speaks `$…$` / `$$…$$`. The product's math notation is \( … \) and
   \[ … \]. Translate those two forms only, outside code spans and fences, so
   plain currency like A$700 is never misparsed as math. Character-scan based
   (no regex over prose) and streaming-safe: an unclosed delimiter simply
   stays as literal text until the model completes it. */
function normalizeMathDelimiters(markdown: string): string {
  let out = "";
  let i = 0;
  while (i < markdown.length) {
    const ch = markdown[i];
    if (ch === "`") {
      let run = 1;
      while (markdown[i + run] === "`") run += 1;
      const fence = "`".repeat(run);
      const close = markdown.indexOf(fence, i + run);
      if (close === -1) { out += markdown.slice(i); break; }
      out += markdown.slice(i, close + run);
      i = close + run;
      continue;
    }
    if (markdown.startsWith("\\[", i)) { out += "$$"; i += 2; continue; }
    if (markdown.startsWith("\\]", i)) { out += "$$"; i += 2; continue; }
    if (markdown.startsWith("\\(", i)) { out += "$"; i += 2; continue; }
    if (markdown.startsWith("\\)", i)) { out += "$"; i += 2; continue; }
    out += ch;
    i += 1;
  }
  return out;
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
    // Tables are a first-class response type: wrap the raw <table> in a
    // horizontally scrollable region so wide tables never break the
    // conversation column on small screens, and give cells the chat's
    // premium surface via CSS (see .clyra-md-table in index.css).
    table({ children }) {
      return (
        <div className="clyra-md-table-wrap">
          <table className="clyra-md-table">{children}</table>
        </div>
      );
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
      /* an inline citation (App's linkCitations): a small host chip */
      if (typeof props.title === "string" && /^Source \d+:/.test(props.title)) {
        return (
          <a {...props} href={href} target="_blank" rel="noopener noreferrer" className="clyra-ai-cite">
            {children}
          </a>
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
    <Markdown
      /* only $$…$$ is maths: a single $ is money far more often ("$0.20 per 1M tokens and $1.20…") */
      remarkPlugins={[[remarkGfm, { singleTilde: false }], [remarkMath, { singleDollarTextMath: false }]]}
      rehypePlugins={[[rehypeKatex, { throwOnError: false, errorColor: "#15171C", strict: false }]]}
      components={components}
    >
      {normalizeMathDelimiters(content)}
    </Markdown>
  );
}

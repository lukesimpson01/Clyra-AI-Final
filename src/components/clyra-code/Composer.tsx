import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PerimeterBeam } from "./PerimeterBeam";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowUp, Bug, CheckCircle2, Clipboard, File as FileIcon, FileSearch, Folder, Globe2, Image, ListChecks, Mic, MousePointer2, Plus, Square, X } from "lucide-react";
import { cn } from "../../lib/utils";
import { QuestionComposer, type QuestionAnswers, type QuestionSet } from "./QuestionComposer";
import { ChevronDown14 } from "./harness";
import { PlanCard } from "./PlanCard";
import type { PlanRow } from "./activityModel";
import "../chat/assistant/agent-actions.css";
import { EffortSlider } from "../chat/EffortSlider";
import type { ComposerEffortOption } from "../chat/ClyraComposerShell";
import type { BriefPlatform } from "./appBrief";
import { BriefHeader, BriefSkeleton, IOSHostNote } from "./BriefComponents";
import { useClickAway } from "./useClickAway";
import { useDictationController, appendDictatedText } from "../../lib/useDictationController";
import { DictationMicButton, DictationStepsDrawer, DictationStrip } from "../chat/DictationMic";

export type ComposerContext = {
  id: string;
  label: string;
  detail: string;
};

export type ComposerAttachment = {
  id: string;
  file: File;
  preview?: string;
  kind: "image" | "file" | "folder";
};

export type ComposerCommand = "browser" | "plan" | "test" | "debug" | "explain";

const CODING_COMMANDS: Array<{ id: ComposerCommand; name: string; description: string; icon: typeof Globe2 }> = [
  { id: "browser", name: "Browser", description: "Use the live preview autonomously", icon: MousePointer2 },
  { id: "plan", name: "Plan", description: "Plan the task before changing files", icon: ListChecks },
  { id: "test", name: "Test", description: "Test the current implementation", icon: CheckCircle2 },
  { id: "debug", name: "Debug", description: "Find and fix a problem", icon: Bug },
  { id: "explain", name: "Explain", description: "Analyse selected project code", icon: FileSearch },
];

/** The only agent axis Clyra exposes. Deliberately no model catalogue: the
 *  runtime picks the model, and offering a choice that changes nothing the
 *  user can reason about would be a control that lies. */
const EFFORT_LEVELS: Array<{ id: "low" | "medium" | "high"; name: string; detail: string }> = [
  { id: "low", name: "Low", detail: "Fast passes for small, well-scoped edits" },
  { id: "medium", name: "Medium", detail: "Balanced planning and execution" },
  { id: "high", name: "High", detail: "Plans deeply and verifies its own work" },
];

/** Largest the input grows before it scrolls. */
const FIELD_MAX_HEIGHT = 140;
/** Shared height curve for the field, so growth and collapse feel like one motion. */
const FIELD_HEIGHT_TRANSITION = "height 150ms cubic-bezier(0.22, 1, 0.36, 1)";

const readableSize = (bytes: number) => bytes < 1024 * 1024
  ? `${Math.max(1, Math.round(bytes / 1024))} KB`
  : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/** A compact, bottom-anchored coding composer. Attachments remain real File
 * objects until submit so image previews never become placeholder UI. */
export function Composer({
  running,
  model: _model,
  contexts,
  onRemoveContext,
  onSubmit,
  onStop,
  placeholder = "Ask Clyra to make a change…",
  welcome = false,
  draft = null,
  onCommandChange,
  question,
  questionSubmitting = false,
  onQuestionSubmit,
  onQuestionBack,
  effort = "medium",
  onEffortChange,
  effortMenuOpen,
  onEffortMenuOpenChange,
  plan,
  brief = null,
  onBriefClear,
}: {
  running: boolean;
  model: string | null;
  contexts: ComposerContext[];
  onRemoveContext: (id: string) => void;
  onSubmit: (text: string, attachments: ComposerAttachment[], command?: ComposerCommand) => Promise<boolean> | boolean;
  onStop: () => void;
  placeholder?: string;
  welcome?: boolean;
  /** A prepared prompt from outside (a welcome entry point). A new id replaces what is typed and focuses the field. */
  draft?: { id: number; text: string } | null;
  onCommandChange?: (command: ComposerCommand | null) => void;
  question?: QuestionSet | null;
  questionSubmitting?: boolean;
  onQuestionSubmit?: (answers: QuestionAnswers) => void;
  onQuestionBack?: () => void;
  effort?: "low" | "medium" | "high";
  onEffortChange?: (effort: "low" | "medium" | "high") => void;
  /** When provided, the effort menu is controlled by the parent (for opening/closing in tandem with the project picker). */
  effortMenuOpen?: boolean;
  onEffortMenuOpenChange?: (open: boolean) => void;
  /** The agent's current plan, docked directly above the input card. */
  plan?: readonly PlanRow[] | null;
  /** A chosen app type from the welcome chips. Shows the guided brief until the user types. */
  brief?: BriefPlatform | null;
  onBriefClear?: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const [value, setValue] = useState("");
  /* the same microphone as Chat: speech fills the field and never sends */
  const dictation = useDictationController((spoken) => { setValue((previous) => appendDictatedText(previous, spoken)); requestAnimationFrame(() => textareaRef.current?.focus()); });
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [attachmentMenu, setAttachmentMenu] = useState(false);
  const [command, setCommand] = useState<ComposerCommand | null>(null);
  const [commandQuery, setCommandQuery] = useState<string | null>(null);
  const [commandIndex, setCommandIndex] = useState(0);
  const effortControlled = effortMenuOpen !== undefined;
  const [effortMenuInternal, setEffortMenuInternal] = useState(false);
  const effortMenu = effortControlled ? (effortMenuOpen ?? false) : effortMenuInternal;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (!draft) return;
    setValue(draft.text);
    const node = textareaRef.current;
    if (!node) return;
    requestAnimationFrame(() => { node.focus(); node.setSelectionRange(draft.text.length, draft.text.length); });
  }, [draft?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // A hidden mirror of the field, laid out with identical classes, gives the
  // true content height without touching the live textarea's height. Setting
  // the textarea to "auto" to measure it would snap it, so the transition
  // could never run.
  const mirrorRef = useRef<HTMLDivElement | null>(null);
  const [fieldHeight, setFieldHeight] = useState<number | undefined>(undefined);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const attachmentsRef = useRef<ComposerAttachment[]>([]);
  const attachmentMenuRef = useRef<HTMLDivElement | null>(null);
  const effortButtonRef = useRef<HTMLButtonElement | null>(null);
  const effortMenuRef = useRef<HTMLDivElement | null>(null);
  const [effortMenuPos, setEffortMenuPos] = useState<{ left: number; bottom: number } | null>(null);
  useClickAway(attachmentMenuRef, attachmentMenu, useCallback(() => setAttachmentMenu(false), []));

  const setEffortMenu = useCallback((next: boolean) => {
    if (next) {
      const rect = effortButtonRef.current?.getBoundingClientRect();
      if (rect) setEffortMenuPos({ left: rect.left - 6, bottom: window.innerHeight - rect.top + 11 });
    }
    if (!effortControlled) setEffortMenuInternal(next);
    onEffortMenuOpenChange?.(next);
  }, [effortControlled, onEffortMenuOpenChange]);

  // The effort menu is portaled to <body> so it can escape the composer's
  // overflow-hidden height animation, so it manages its own dismissal (outside
  // pointer press, Escape, or any scroll/resize that would detach the anchor).
  useEffect(() => {
    if (!effortMenu) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (effortButtonRef.current?.contains(target) || effortMenuRef.current?.contains(target)) return;
      setEffortMenu(false);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setEffortMenu(false); };
    const onScrollOrResize = () => setEffortMenu(false);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [effortMenu, setEffortMenu]);

  useEffect(() => {
    const input = folderInputRef.current;
    if (input) input.setAttribute("webkitdirectory", "");
  }, []);
  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);
  useEffect(() => () => {
    attachmentsRef.current.forEach((attachment) => attachment.preview && URL.revokeObjectURL(attachment.preview));
  }, []);

  const addFiles = useCallback((files: FileList | File[], kind: "image" | "file" | "folder" = "file") => {
    const next = Array.from(files).map((file) => ({
      id: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
      file,
      kind: file.type.startsWith("image/") ? "image" as const : kind,
      preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
    }));
    setAttachments((previous) => [...previous, ...next]);
    setAttachmentMenu(false);
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((previous) => {
      const removed = previous.find((attachment) => attachment.id === id);
      if (removed?.preview) URL.revokeObjectURL(removed.preview);
      return previous.filter((attachment) => attachment.id !== id);
    });
  }, []);

  const pasteClipboard = useCallback(async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((type) => type.startsWith("image/"));
        if (imageType) {
          const blob = await item.getType(imageType);
          addFiles([new File([blob], `clipboard-image.${imageType.split("/")[1] || "png"}`, { type: imageType })], "image");
          return;
        }
      }
      const text = await navigator.clipboard.readText();
      if (text) setValue((previous) => previous ? `${previous}\n${text}` : text);
    } catch {
      textareaRef.current?.focus();
    } finally {
      setAttachmentMenu(false);
    }
  }, [addFiles]);

  const submit = useCallback(async () => {
    const text = value.trim();
    // Context chips are real request metadata. In particular, "Add error to
    // chat" must be sendable without forcing the user to type filler text.
    if (!text && attachments.length === 0 && contexts.length === 0) return;
    const contextBlock = contexts.length ? `${contexts.map((context) => `[${context.label}] ${context.detail}`).join("\n")}\n\n` : "";
    /* Clear at once, as Codex does; if the request cannot be sent, the text comes back. */
    const sentAttachments = attachments;
    setValue("");
    setAttachments([]);
    const submitted = await Promise.resolve(onSubmit(contextBlock + text, sentAttachments, command ?? undefined)).catch(() => false);
    if (!submitted) {
      setValue((current) => current || text);
      setAttachments((current) => (current.length ? current : sentAttachments));
      return;
    }
    sentAttachments.forEach((attachment) => attachment.preview && URL.revokeObjectURL(attachment.preview));
    setCommand(null);
    onCommandChange?.(null);
    contexts.forEach((context) => onRemoveContext(context.id));
  }, [attachments, command, contexts, onCommandChange, onRemoveContext, onSubmit, value]);

  // Measure after every render that can change the text, before paint, so the
  // CSS height transition starts from the previous height on the same frame.
  useLayoutEffect(() => {
    const mirror = mirrorRef.current;
    if (!mirror) return;
    const measured = Math.min(FIELD_MAX_HEIGHT, mirror.offsetHeight);
    setFieldHeight((previous) => (previous === measured ? previous : measured));
  }, [value, welcome, brief]);

  const visibleCommands = commandQuery === null ? [] : CODING_COMMANDS.filter((item) => item.id.includes(commandQuery.toLowerCase()) || item.name.toLowerCase().includes(commandQuery.toLowerCase()));
  const selectCommand = useCallback((next: ComposerCommand) => {
    setCommand(next);
    onCommandChange?.(next);
    setValue((current) => current.replace(/(^|\s)\/[a-z]*$/i, "$1").replace(/^\s+/, ""));
    setCommandQuery(null);
    setCommandIndex(0);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [onCommandChange]);

  const onValueChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = event.target.value;
    setValue(next);
    const match = next.match(/(?:^|\s)\/([a-z]*)$/i);
    setCommandQuery(match ? match[1] : null);
    setCommandIndex(0);
  };

  const fieldClass = cn(
    "min-h-[38px] px-3 pt-2.5 text-[13px] leading-[1.45] tracking-[-0.008em]",
    welcome && "min-h-[59px] px-4 pt-4 text-[14px]",
    brief && !value && "min-h-[178px]",
  );

  const attached = attachments.length > 0 || contexts.length > 0;
  const activeEffort = EFFORT_LEVELS.find((level) => level.id === effort) ?? EFFORT_LEVELS[1];
  const effortOptions: ComposerEffortOption[] = useMemo(() => {
    return EFFORT_LEVELS.map((level) => ({
      value: level.id,
      label: level.name,
      hint: level.detail,
      onPick: () => onEffortChange?.(level.id),
    }));
  }, [onEffortChange]);
  return (
    <div className={cn("relative px-3", welcome ? "pt-0" : "pb-2 pt-1")}>
      {plan?.length ? (
        /* A one-line spacer keeps the composer still; the plan grows upward from it over the thread. */
        <div className={cn("relative mx-auto h-[38px]", welcome ? "max-w-[620px]" : "max-w-[688px]")}>
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-x-0 bottom-1 z-[6]"
          >
            <PlanCard plan={plan} live={Boolean(running)} className="shadow-[0_1px_2px_rgba(0,0,0,0.03)]" />
          </motion.div>
        </div>
      ) : null}
      {/* A single blue beam travels the border on the welcome screen and while the agent is working. */}
      <PerimeterBeam active={Boolean(welcome || running)} className={welcome ? "max-w-[620px]" : "max-w-[688px]"}>
      <motion.div
        data-running={running ? "" : undefined}
        data-welcome={welcome ? "" : undefined}
        className={cn(
          "cc-composer relative mx-auto overflow-visible border bg-white",
          welcome
            ? "max-w-[620px] rounded-[22px] border-black/[0.10] shadow-[0_1px_2px_rgba(20,24,32,0.04),0_12px_28px_-16px_rgba(20,24,32,0.16)] focus-within:border-black/[0.14]"
            : "max-w-[688px] rounded-[22px] border-black/[0.10] shadow-[0_1px_2px_rgba(20,24,32,0.04),0_12px_28px_-16px_rgba(20,24,32,0.16)] focus-within:border-black/[0.14] focus-within:shadow-[0_0_0_3px_rgba(30,111,255,0.07),0_12px_28px_-16px_rgba(20,24,32,0.16)]",
        )}
      >
        <AnimatePresence initial={false}>
          {question ? (
            <motion.div
              key="question"
              initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 7, height: 0 }}
              animate={reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0, height: "auto" }}
              exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -7, height: 0 }}
              transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden"
            >
              <QuestionComposer questionSet={question} submitting={questionSubmitting} onBack={onQuestionBack} onSubmit={(answers) => onQuestionSubmit?.(answers)} />
            </motion.div>
          ) : (
            <motion.div
              key="normal"
              initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 7, height: 0 }}
              animate={reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0, height: "auto" }}
              exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -7, height: 0 }}
              transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden"
            >
        <AnimatePresence initial={false}>
          {attached ? <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden">
            <div className="flex max-h-[86px] gap-1.5 overflow-x-auto px-2.5 pt-2 [scrollbar-width:none]">
              {contexts.map((context) => <span key={context.id} title={context.detail} className="flex h-[26px] shrink-0 items-center gap-1 rounded-full border border-black/[0.07] bg-[#F4F4F3] pl-2 pr-1 text-[11px] font-medium text-[#3A3C40]">{context.label}<button type="button" aria-label="Remove context" onClick={() => onRemoveContext(context.id)} className="flex h-4 w-4 items-center justify-center rounded-full text-[#8A8E94] transition-colors hover:bg-black/[0.06] hover:text-[#202124]"><X className="h-3 w-3" strokeWidth={2} /></button></span>)}
              {attachments.map((attachment) => attachment.kind === "image" && attachment.preview ? <div key={attachment.id} className="relative h-[68px] w-[84px] shrink-0 overflow-visible"><img src={attachment.preview} alt={attachment.file.name} className="h-[68px] w-[84px] rounded-[8px] border border-[var(--border-subtle)] object-cover" /><button type="button" aria-label={`Remove ${attachment.file.name}`} onClick={() => removeAttachment(attachment.id)} className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/70 text-white shadow-sm"><X className="h-2.5 w-2.5" /></button></div> : <div key={attachment.id} className="relative flex h-[44px] min-w-[150px] max-w-[220px] shrink-0 items-center gap-1.5 rounded-[8px] bg-[var(--surface-muted)] px-2 pr-5"><FileIcon className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" /><span className="min-w-0"><span className="block truncate text-[10.5px] font-medium text-[var(--text-secondary)]">{attachment.file.name}</span><span className="block text-[9.5px] text-[var(--text-tertiary)]">{attachment.kind === "folder" ? "Folder" : `${attachment.file.name.split(".").pop()?.toUpperCase() || "File"} · ${readableSize(attachment.file.size)}`}</span></span><button type="button" aria-label={`Remove ${attachment.file.name}`} onClick={() => removeAttachment(attachment.id)} className="absolute right-1.5 top-1.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"><X className="h-3 w-3" /></button></div>)}
            </div>
          </motion.div> : null}
        </AnimatePresence>
        {command ? (() => { const item = CODING_COMMANDS.find((candidate) => candidate.id === command)!; const Icon = item.icon; return <div className="px-3 pt-2"><span className="inline-flex h-5 items-center gap-1 rounded-[6px] bg-[var(--accent-blue)]/[0.1] px-1.5 text-[10.5px] font-medium text-[var(--accent-blue)]"><Icon className="h-3 w-3" strokeWidth={1.7} />{item.name}<button type="button" aria-label={`Remove ${item.name} command`} onClick={() => { setCommand(null); onCommandChange?.(null); }} className="ml-0.5 rounded text-[var(--accent-blue)]/70 hover:text-[var(--accent-blue)]"><X className="h-2.5 w-2.5" /></button></span></div>; })() : null}
        {brief ? <BriefHeader platform={brief} onClear={() => onBriefClear?.()} /> : null}
        <DictationStepsDrawer dictation={dictation} />
        <div className="relative">
        <DictationStrip dictation={dictation} height={fieldHeight ? Math.min(Number(fieldHeight) || 44, 120) : 44} />
        <div
          ref={mirrorRef}
          aria-hidden
          className={cn(fieldClass, "pointer-events-none invisible absolute inset-x-0 top-0 h-auto whitespace-pre-wrap break-words")}
        >
          {`${value}​`}
        </div>
        <textarea
          ref={textareaRef}
          value={value}
          rows={1}
          placeholder={brief ? "" : placeholder}
          onChange={onValueChange}
          style={{ height: fieldHeight, transition: FIELD_HEIGHT_TRANSITION }}
          onKeyDown={(event) => { if (commandQuery !== null) { if (event.key === "ArrowDown") { event.preventDefault(); setCommandIndex((index) => Math.min(visibleCommands.length - 1, index + 1)); return; } if (event.key === "ArrowUp") { event.preventDefault(); setCommandIndex((index) => Math.max(0, index - 1)); return; } if (event.key === "Escape") { event.preventDefault(); setCommandQuery(null); return; } if (event.key === "Enter" && visibleCommands[commandIndex]) { event.preventDefault(); selectCommand(visibleCommands[commandIndex].id); return; } } if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); } }}
          className={cn("block w-full resize-none overflow-y-auto bg-transparent text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]", fieldClass)}
        />
        <AnimatePresence initial={false}>
          {brief && !value ? (
            <motion.div
              key={brief}
              className="pointer-events-none absolute inset-0"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.14 } }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            >
              <BriefSkeleton
                platform={brief}
                onUse={(line) => {
                  setValue((previous) => (previous ? `${previous}\n${line}` : line));
                  requestAnimationFrame(() => textareaRef.current?.focus());
                }}
              />
            </motion.div>
          ) : null}
        </AnimatePresence>
        </div>
        {brief === "ios" ? <IOSHostNote /> : null}
        <div className={cn("flex h-10 items-center gap-1.5 px-2.5 pb-2", welcome && "px-3")}>
          <div ref={attachmentMenuRef} className="relative">
            <button type="button" aria-label="Add attachment" onClick={() => setAttachmentMenu((open) => !open)} className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-hover)]"><Plus className="h-[18px] w-[18px]" strokeWidth={1.6} /></button>
            <AnimatePresence>{attachmentMenu ? <motion.div initial={{ opacity: 0, y: 4, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 3, scale: 0.98 }} transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }} className="absolute bottom-8 left-0 z-30 w-[176px] rounded-[10px] border border-[var(--border-subtle)] bg-[var(--composer-surface)] p-1 shadow-[0_10px_24px_rgba(15,23,42,0.11)]">
              {[["Image", Image, () => imageInputRef.current?.click()], ["File", FileIcon, () => fileInputRef.current?.click()], ["Folder", Folder, () => folderInputRef.current?.click()], ["Paste from clipboard", Clipboard, pasteClipboard]].map(([label, Icon, action]) => { const IconComponent = Icon as typeof Image; return <button key={label as string} type="button" onClick={action as () => void} className="flex h-7 w-full items-center gap-2 rounded-[6px] px-2 text-left text-[11.5px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)]"><IconComponent className="h-3.5 w-3.5 text-[var(--text-tertiary)]" strokeWidth={1.65} />{label as string}</button>; })}
            </motion.div> : null}</AnimatePresence>
          </div>
          {/* As in Codex: attachments on the left; the model/effort picker, voice and send together on the right. */}
          <span className="flex-1" />
          <div className="relative">
            <button
              ref={effortButtonRef}
              type="button"
              className="dsh-chip"
              aria-label={`Effort: ${activeEffort.name}`}
              aria-haspopup="menu"
              aria-expanded={effortMenu}
              onClick={() => setEffortMenu(!effortMenu)}
            >
              Agent
              <span className="dsh-chip-value">{activeEffort.name}</span>
              <ChevronDown14 className="dsh-chip-chevron" data-open={effortMenu} />
            </button>
            {typeof document !== "undefined"
              ? createPortal(
                  <div ref={effortMenuRef}>
                    <EffortSlider
                      efforts={effortOptions}
                      current={effort}
                      accentColor="#3977F6"
                      open={effortMenu}
                      defaultValue="medium"
                      fixedAnchor={effortMenuPos}
                    />
                  </div>,
                  document.body,
                )
              : null}
          </div>
          <DictationMicButton dictation={dictation} />
          {running ? <button type="button" onClick={onStop} aria-label="Stop" className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-[var(--text-primary)] text-[var(--app-background)] transition-colors duration-150 hover:opacity-90 active:scale-[0.96]"><Square className="h-[10px] w-[10px]" fill="currentColor" /></button> : <button type="button" onClick={submit} disabled={!value.trim() && attachments.length === 0 && contexts.length === 0} aria-label="Send" className={cn("flex h-8 w-8 items-center justify-center rounded-full transition-all duration-150 active:scale-[0.96]", value.trim() || attachments.length || contexts.length ? "bg-[var(--accent-blue)] text-white hover:brightness-110" : "bg-[var(--accent-blue)]/45 text-white")}><ArrowUp className="h-4 w-4" strokeWidth={2.1} /></button>}
        </div>
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>{commandQuery !== null && visibleCommands.length ? <motion.div initial={{ opacity: 0, y: 4, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 3, scale: 0.985 }} transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }} className="clyra-command-palette absolute bottom-[calc(100%+7px)] left-0 z-40 w-full overflow-hidden rounded-[10px] border border-[var(--border-subtle)] bg-[var(--composer-surface)] p-1 shadow-[0_10px_24px_rgba(15,23,42,0.11)]">{visibleCommands.map((item, index) => { const Icon = item.icon; return <button key={item.id} type="button" onMouseEnter={() => setCommandIndex(index)} onClick={() => selectCommand(item.id)} className={cn("flex h-9 w-full items-center gap-2 rounded-[6px] px-2.5 text-left transition-colors", index === commandIndex ? "bg-[var(--surface-hover)]" : "hover:bg-[var(--surface-hover)]")}><Icon className="h-3.5 w-3.5 text-[var(--text-secondary)]" strokeWidth={1.65} /><span className="min-w-0 flex-1"><span className="block text-[11.5px] font-medium text-[var(--text-secondary)]">/{item.id}</span></span><span className="truncate text-[10.5px] text-[var(--text-tertiary)]">{item.description}</span></button>; })}</motion.div> : null}</AnimatePresence>
      </motion.div>
      </PerimeterBeam>
      <input ref={imageInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(event) => { if (event.currentTarget.files) addFiles(event.currentTarget.files, "image"); event.currentTarget.value = ""; }} />
      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(event) => { if (event.currentTarget.files) addFiles(event.currentTarget.files); event.currentTarget.value = ""; }} />
      <input ref={folderInputRef} type="file" multiple className="hidden" onChange={(event) => { if (event.currentTarget.files) addFiles(event.currentTarget.files, "folder"); event.currentTarget.value = ""; }} />
    </div>
  );
}

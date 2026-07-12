/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useCallback,
  useState,
} from "react";
import {
  motion,
  AnimatePresence,
  useMotionValue,
  useSpring,
  useVelocity,
  useTransform,
} from "motion/react";
import {
  AppWindow,
  Scissors,
  ArrowUpIcon,
  Check,
  ChevronRight,
  FileUp,
  Folder,
  MessageCircleDashed,
  MousePointer2,
  Paperclip,
  Pencil,
  Play,
  Search,
  Settings,
  SquarePen,
  Trash2,
  X,
  XIcon,
  Edit2,
} from "lucide-react";
import { cn } from "./lib/utils";
import { SettingsModal } from "./components/SettingsModal";
import { ChatSearchModal } from "./components/ChatSearchModal";
import { ShiningText } from "./components/ShiningText";
import { BlurredStaggerStream } from "@/components/ui/blurred-stagger-text";
import { ResearchStatusBar } from "@/components/chat/ResearchStatusBar";
import { needsWebResearch } from "@/lib/researchDetect";
import {
  formatResearchContext,
  runResearch,
  type ResearchSite,
} from "@/lib/researchClient";
import { MarkdownMessageContent } from "./components/MarkdownMessageContent";
import {
  DocumentCardUI,
  type DocumentRewriteRequest,
} from "./components/ui/document-card";
import AIClipper from "./components/AIClipper";
import VibeCoderWorkspace from "./components/VibeCoderWorkspace";
import { AiOrb, type OrbColorTheme } from "./components/AiOrb";
import { VibeAgentMessageBody } from "./components/vibe/VibeAgentMessageBody";
import { VibeLivePreviewPanel } from "./components/vibe/VibeLivePreviewPanel";
import { buildLocalVibeFallbackResponse } from "./lib/buildLocalVibeFallback";
import { VIBE_CURSOR_AGENT_SYSTEM_PROMPT } from "./lib/vibeAgentConstants";
import { extractVibeFilesFromContent } from "./lib/parseVibeAgentContent";

type WorkspaceTabId = "chat" | "vibe" | "browser";
const WORKSPACE_TAB_ORDER: WorkspaceTabId[] = ["chat", "vibe", "browser"];
const ORB_COLOR_THEMES: OrbColorTheme[] = [
  "default",
  "ocean",
  "sunset",
  "forest",
  "mono",
  "noir",
];

const TYPING_CORRECTIONS: Record<string, string> = {
  adress: "address",
  becuase: "because",
  definately: "definitely",
  recieve: "receive",
  seperate: "separate",
  teh: "the",
  thier: "their",
  wierd: "weird",
  yourt: "your",
};

function getTypingCorrection(value: string) {
  const match = value.match(/(^|\s)([A-Za-z']{2,})$/);
  if (!match) return null;
  const word = match[2];
  const correction = TYPING_CORRECTIONS[word.toLowerCase()];
  if (!correction || correction === word) return null;
  return { word, correction };
}

function readStoredOrbColorTheme(): OrbColorTheme {
  if (typeof window === "undefined") return "default";
  try {
    const storedTheme = window.localStorage.getItem("clyra-orb-color-theme");
    return ORB_COLOR_THEMES.includes(storedTheme as OrbColorTheme)
      ? (storedTheme as OrbColorTheme)
      : "default";
  } catch {
    return "default";
  }
}

/** Standard chat: shimmer until the model emits answer text (`content`), then hide so stagger can print it. */
function ChatThinkingLabel({
  isThinking,
  isStreaming,
  content,
}: {
  isThinking: boolean;
  isStreaming: boolean;
  content: string;
}) {
  const visible = content.length === 0 && (isThinking || isStreaming);

  if (!visible) return null;

  return (
    <div className="flex items-center gap-1" aria-live="polite">
      <ShiningText text="Thinking" preset="thinkingChat" />
    </div>
  );
}

function UserMessageText({ text }: { text: string }) {
  return <p className="clyra-chat-user-text">{text}</p>;
}

const AnimatedMessage = ({
  messageId,
  content,
  isThinking,
  isStreaming,
  fontSizeClass,
  markdownSupport,
  codeHighlighting = true,
  assistantKind = "chat",
  isLastAssistant,
  onVibePreviewReady,
  onDocumentRewriteRequest,
  onContentChange,
  isResearching,
  researchSites = [],
}: {
  messageId?: string;
  content: string;
  isThinking?: boolean;
  isStreaming?: boolean;
  reasoningContent?: string;
  vibeUserPrompt?: string;
  fontSizeClass?: string;
  markdownSupport?: boolean;
  codeHighlighting?: boolean;
  assistantKind?: "chat" | "vibe";
  isLastAssistant?: boolean;
  isResearching?: boolean;
  researchSites?: ResearchSite[];
  onVibePreviewReady?: (
    messageId: string,
    filesByPath: Record<string, string>,
  ) => void;
  onDocumentRewriteRequest?: (request: DocumentRewriteRequest) => void;
  onContentChange?: (messageId: string, newContent: string) => void;
}) => {
  const isVibe = assistantKind === "vibe";
  /** Vibe agent now drives its own thought UI from the model's <<<VIBE_THINKING>>> blocks. While we have no
   *  content yet, show the unified "Thinking" shimmer so the seam into the inline VibeThoughtPanel is clean. */
  const suppressVibeAnswerBody = isVibe && !!isThinking && content.length === 0;
  const hasMarkdownStructure =
    /```|^\s{0,3}#{1,6}\s|^\s*[-*]\s|\n\s*\d+\.\s|\|.+\||\*\*[^*]+\*\*/m.test(
      content,
    );

  // Robust heuristics to detect if the response is an email or structured notes, ignoring preamble.
  const isEmail =
    /^(?:Subject:|To:|From:)\s*.+/im.test(content) ||
    /^(?:Hi|Dear|Hello)\s+[\w\s]+,\s*\n/i.test(content);

  const isNote =
    /^\s*#{1,3}\s+(?:Meeting Notes|Notes|Summary Notes|Session Notes)\b/i.test(content);
  const useDocumentUI = (isEmail || isNote) && content.length > 5;

  let preamble = "";
  let docContent = content;

  if (useDocumentUI) {
    if (isEmail) {
      const emailMatch = content.match(
        /Subject:\s*.+|Hi\s+[\w\s]+,|Dear\s+[\w\s]+,|Hello\s+[\w\s]+,/i,
      );
      if (
        emailMatch &&
        emailMatch.index !== undefined &&
        emailMatch.index > 0
      ) {
        preamble = content.substring(0, emailMatch.index).trim();
        docContent = content.substring(emailMatch.index);
      }
    } else {
      const headingMatch = content.match(
        /(?:^|\n)\s*#{1,2}\s*(?:📘\s*)?(?:Notes?|Meeting Notes?|Summary|.+)|(?:Quick overview|Key Points|Main Notes)/i,
      );
      if (
        headingMatch &&
        headingMatch.index !== undefined &&
        headingMatch.index > 0
      ) {
        preamble = content.substring(0, headingMatch.index).trim();
        docContent = content.substring(headingMatch.index);
      } else {
        const fallbackMatch = content.match(/Here are.*notes:?/i);
        if (fallbackMatch && fallbackMatch.index !== undefined) {
          preamble = content
            .substring(0, fallbackMatch.index + fallbackMatch[0].length)
            .trim();
          docContent = content
            .substring(fallbackMatch.index + fallbackMatch[0].length)
            .trim();
        }
      }
    }
  }

  const shouldRenderMarkdown =
    markdownSupport && hasMarkdownStructure && !useDocumentUI;
  return (
    <div
      className={cn(
        "pt-0.5 font-medium text-inherit w-full relative flex flex-col gap-2",
        fontSizeClass,
      )}
    >
      {isResearching ? <ResearchStatusBar sites={researchSites} /> : null}
      {!isResearching && content.length === 0 && (isThinking || isStreaming) ? (
        <ChatThinkingLabel
          isThinking={!!isThinking}
          isStreaming={!!isStreaming}
          content={content}
        />
      ) : null}
      {content.length > 0 && !suppressVibeAnswerBody ? (
        <div
          className={cn("markdown-body mt-1", isVibe && "markdown-body--vibe")}
          data-invert-ignore
        >
          {isVibe ? (
            <VibeAgentMessageBody
              key={messageId ?? "vibe-body"}
              messageId={messageId}
              content={content}
              isStreaming={!!isStreaming}
              fontSizeClass={fontSizeClass}
              isLastAssistant={!!isLastAssistant}
              onVibePreviewReady={onVibePreviewReady}
            />
          ) : useDocumentUI ? (
            <>
              {preamble && (
                <MarkdownMessageContent
                  content={preamble}
                  codeHighlighting={!!codeHighlighting}
                  codePresentation="default"
                />
              )}
              <DocumentCardUI
                content={docContent}
                isStreaming={!!isStreaming}
                isEmail={isEmail}
                onRewriteRequest={onDocumentRewriteRequest}
                onContentChange={(newContent) => {
                  if (onContentChange && messageId) {
                    onContentChange(
                      messageId,
                      preamble ? `${preamble}\n\n${newContent}` : newContent,
                    );
                  }
                }}
                className={cn(preamble ? "mt-4" : "mt-1", fontSizeClass)}
              />
            </>
          ) : shouldRenderMarkdown ? (
            <MarkdownMessageContent
              content={content}
              codeHighlighting={!!codeHighlighting}
              codePresentation="default"
            />
          ) : (
            <BlurredStaggerStream
              text={content}
              isStreaming={!!isStreaming}
              className={cn("text-inherit", fontSizeClass)}
            />
          )}
        </div>
      ) : null}
    </div>
  );
};

interface UseAutoResizeTextareaProps {
  minHeight: number;
  maxHeight?: number;
}

function useAutoResizeTextarea({
  minHeight,
  maxHeight,
  lineThreshold = 18,
}: UseAutoResizeTextareaProps & { lineThreshold?: number }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback(
    (reset?: boolean) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      if (reset) {
        textarea.style.height = `${minHeight}px`;
        textarea.style.overflowY = "hidden";
        return;
      }

      window.requestAnimationFrame(() => {
        textarea.style.height = `${minHeight}px`;
        const needsSecondLine =
          textarea.value.length > 0 &&
          textarea.scrollHeight > minHeight + lineThreshold;
        const targetHeight = needsSecondLine
          ? Math.min(textarea.scrollHeight, maxHeight ?? Number.POSITIVE_INFINITY)
          : minHeight;

        textarea.style.height = `${targetHeight}px`;
        textarea.style.overflowY =
          maxHeight && textarea.scrollHeight > maxHeight ? "auto" : "hidden";
      });
    },
    [minHeight, maxHeight, lineThreshold],
  );

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = `${minHeight}px`;
    }
  }, [minHeight]);

  useEffect(() => {
    const handleResize = () => adjustHeight();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [adjustHeight]);

  return { textareaRef, adjustHeight };
}

interface CommandSuggestion {
  id: string;
  icon: (isActive: boolean) => React.ReactNode;
  label: string;
  description: string;
  prefix: string;
}

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  containerClassName?: string;
  highlightOverlay?: string | null;
}

const PromptGhostText = ({ text, ghost }: { text: string; ghost: string }) => {
  if (!ghost || !ghost.trim()) {
    return null;
  }

  return (
    <>
      <span className="opacity-0">{text}</span>
      <span className="clyra-prompt-ghost" aria-hidden="true">
        {" "}
        {ghost}
      </span>
    </>
  );
};

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    { className, containerClassName, highlightOverlay, value, ...props },
    ref,
  ) => {
    return (
      <div className={cn("relative flex items-center", containerClassName)}>
        {highlightOverlay && (
          <div
            className={cn(
              "clyra-prompt-ghost-layer absolute inset-0 pointer-events-none break-words whitespace-pre-wrap flex w-full bg-transparent px-4 text-base transition-all duration-200 ease-in-out font-medium",
              className,
            )}
            aria-hidden="true"
          >
            <PromptGhostText
              text={String(value || "")}
              ghost={highlightOverlay}
            />
          </div>
        )}
        <textarea
          className={cn(
            "flex w-full bg-transparent px-4 text-base",
            "transition-all duration-200 ease-in-out",
            "placeholder:text-slate-400 font-medium",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "focus-visible:outline-none focus:ring-0 focus-visible:ring-offset-0",
            className,
            "text-slate-800",
          )}
          value={value}
          ref={ref}
          {...props}
        />
      </div>
    );
  },
);
Textarea.displayName = "Textarea";

const HighlightText = ({
  text,
  highlight,
}: {
  text: string;
  highlight: string;
}) => {
  if (!highlight.trim()) return <>{text}</>;
  const lower = highlight.toLowerCase();
  const parts = text.split(
    new RegExp(`(${highlight.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"),
  );
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === lower ? (
          <span
            key={i}
            className="text-blue-500 font-medium transition-colors duration-300 ease-out"
          >
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
};

export const FullscreenContext = React.createContext({
  isFullscreen: false,
  setIsFullscreen: (v: boolean) => {},
});

export default function App() {
  interface Message {
    id: string;
    role: "user" | "assistant";
    content: string;
    reasoningContent?: string;
    isThinking?: boolean;
    isStreaming?: boolean;
    /** `vibe` keeps the expandable thought UI; normal chat uses the “Thinking:” line only. */
    assistantKind?: "chat" | "vibe";
    /** User prompt for this Vibe reply—drives the fixed Thought summary. */
    vibeUserPrompt?: string;
    isResearching?: boolean;
    researchSites?: ResearchSite[];
  }

  interface ChatSession {
    id: string;
    title: string;
    messages: Message[];
    updatedAt: number;
    kind?: "chat" | "vibe";
    vibeRunning?: boolean;
    vibeUnread?: boolean;
  }

  const [selectedCommand, setSelectedCommand] =
    useState<CommandSuggestion | null>(null);
  const [activeWorkspaceTab, setActiveWorkspaceTab] =
    useState<WorkspaceTabId>("chat");
  const [workspaceTransitionDirection, setWorkspaceTransitionDirection] =
    useState<number>(0);

  const containerMouseX = useMotionValue(0);
  const magneticTargetX = useTransform(containerMouseX, (mouseX) => {
    // Determine closest button center (assuming 105px width, 4px gap, 5px padding)
    const padding = 5;
    const offsetStep = 109; // 105 + 4
    const rawIndex = (mouseX - padding) / offsetStep;
    const closestIndex = Math.max(0, Math.min(2, Math.round(rawIndex)));
    const closestCenter = padding + closestIndex * offsetStep + 52.5;

    const minDistance = Math.abs(mouseX - closestCenter);

    // Soft magnetic zone: stretches toward the nearest tab, then settles cleanly on it.
    const snapZone = 30;
    const releaseZone = 58;

    if (minDistance < snapZone) {
      return closestCenter;
    } else if (minDistance < releaseZone) {
      const t = (minDistance - snapZone) / (releaseZone - snapZone);
      const smoothT = t * t * (3 - 2 * t);
      return closestCenter * (1 - smoothT) + mouseX * smoothT;
    }
    return mouseX;
  });

  const springContainerX = useSpring(magneticTargetX, {
    stiffness: 430,
    damping: 33,
    mass: 0.34,
  });
  const containerVelocityX = useVelocity(springContainerX);
  const hoverScaleX = useTransform(
    containerVelocityX,
    [-1500, 0, 1500],
    [1.1, 1, 1.1],
  );
  const hoverOrigin = useTransform(
    containerVelocityX,
    [-1500, 0, 1500],
    ["right", "center", "left"],
  );
  const hoverPillX = useTransform(() => {
    const pillX = springContainerX.get() - 50.5;
    return Math.min(225, Math.max(7, pillX));
  });
  const [isWorkspaceSwitching, setIsWorkspaceSwitching] = useState(false);
  const workspaceSwitchTimeoutRef = useRef<number | null>(null);
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === "undefined" ? 1200 : window.innerWidth,
  );
  const [hoveredWorkspaceTab, setHoveredWorkspaceTab] =
    useState<WorkspaceTabId | null>(null);
  const [clipInitialUrl, setClipInitialUrl] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [chats, setChats] = useState<ChatSession[]>(() => {
    try {
      const saved = localStorage.getItem("vibe-coder-chats");
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error("Failed to load chats:", e);
    }
    return [];
  });

  useEffect(() => {
    try {
      localStorage.setItem("vibe-coder-chats", JSON.stringify(chats));
    } catch (e) {
      console.error("Failed to save chats:", e);
    }
  }, [chats]);

  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const currentChatIdRef = useRef<string | null>(null);
  useEffect(() => {
    currentChatIdRef.current = currentChatId;
  }, [currentChatId]);
  useEffect(() => {
    const updateViewportWidth = () => setViewportWidth(window.innerWidth);
    updateViewportWidth();
    window.addEventListener("resize", updateViewportWidth);
    window.visualViewport?.addEventListener("resize", updateViewportWidth);
    return () => {
      window.removeEventListener("resize", updateViewportWidth);
      window.visualViewport?.removeEventListener("resize", updateViewportWidth);
    };
  }, []);
  type IntroState =
    | "booting"
    | "orb_up"
    | "progress"
    | "input_circle"
    | "input_expand"
    | "progress_complete"
    | "complete";
  const [introState, setIntroState] = useState<IntroState>("booting");
  const [introProgressText, setIntroProgressText] = useState("INITIALIZING");
  const [progressDuration] = useState(() => 3 + Math.random() * 3);

  useEffect(() => {
    if (introState === "complete") {
      return;
    }

    if (
      typeof document !== "undefined" &&
      document.visibilityState === "hidden"
    ) {
      setIntroState("complete");
      return;
    }

    const t1 = setTimeout(() => setIntroState("orb_up"), 10);
    const t2 = setTimeout(() => setIntroState("input_circle"), 1600);
    const t3 = setTimeout(() => setIntroState("input_expand"), 1980);
    const t4 = setTimeout(() => {
      setIntroState("complete");
      setIsSidebarOpen(true);
    }, 2850);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (workspaceSwitchTimeoutRef.current != null) {
        window.clearTimeout(workspaceSwitchTimeoutRef.current);
      }
    };
  }, []);
  const [searchQuery, setSearchQuery] = useState("");
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeSuggestion, setActiveSuggestion] = useState<number>(-1);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [recentCommand, setRecentCommand] = useState<string | null>(null);
  const [isInputExpanded, setIsInputExpanded] = useState(false);
  const inputContainerRef = useRef<HTMLDivElement>(null);

  const isAiResponding = messages.some((m) => m.isStreaming || m.isThinking);
  const isExpanded =
    !isAiResponding &&
    (isInputExpanded ||
      attachments.length > 0 ||
      selectedCommand !== null ||
      activeWorkspaceTab === "vibe");

  const { textareaRef, adjustHeight } = useAutoResizeTextarea({
    minHeight: 40,
    maxHeight: 96,
  });

  useEffect(() => {
    adjustHeight();
  }, [adjustHeight, isExpanded, value]);

  const pendingDocumentRewriteRef = useRef<DocumentRewriteRequest | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isRephrasingMode, setIsRephrasingMode] = useState(false);
  const [rewritePhase, setRewritePhase] = useState<"ready" | "applying">(
    "ready",
  );
  const [isProjectsOpen, setIsProjectsOpen] = useState(false);
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isChatInitialLoad, setIsChatInitialLoad] = useState(false);

  const handleDocumentChange = React.useCallback(
    (messageId: string, newContent: string) => {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId
            ? { ...msg, text: newContent, content: newContent }
            : msg,
        ),
      );
    },
    [],
  );
  useEffect(() => {
    setIsChatInitialLoad(true);
    const timer = setTimeout(() => setIsChatInitialLoad(false), 100);
    return () => clearTimeout(timer);
  }, [currentChatId]);

  const [isTemporaryChat, setIsTemporaryChat] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [showClipsLibrary, setShowClipsLibrary] = useState(false);
  const [theme, setTheme] = useState("Light");
  const [sendOnEnter, setSendOnEnter] = useState(true);
  const [fontSize, setFontSize] = useState("Medium");
  const [autoScroll, setAutoScroll] = useState(true);
  const [animationSpeed, setAnimationSpeed] = useState(1);
  const [codeHighlighting, setCodeHighlighting] = useState(true);
  const [markdownSupport, setMarkdownSupport] = useState(true);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [temperature, setTemperature] = useState(0.7);
  const [userBubbleColor, setUserBubbleColor] = useState("#E4E7EC");
  const [orbColorTheme, setOrbColorTheme] = useState<OrbColorTheme>(
    readStoredOrbColorTheme,
  );
  const [bgAnimEnabled, setBgAnimEnabled] = useState(false);
  const [bgAnimColor, setBgAnimColor] = useState("#8b5cf6");
  const commandPaletteRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  /** When true, stream / layout growth will keep the chat column pinned to the bottom (normal chat behavior). */
  const chatNearBottomRef = useRef(true);

  useEffect(() => {
    setIsSearching(searchQuery.length > 0);
  }, [searchQuery]);

  useEffect(() => {
    try {
      window.localStorage.setItem("clyra-orb-color-theme", orbColorTheme);
    } catch (error) {
      console.error("Failed to save orb color theme:", error);
    }
  }, [orbColorTheme]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setIsSearchModalOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    document.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      document.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, []);

  const lastAssistantId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]!.role === "assistant") return messages[i]!.id;
    }
    return null as string | null;
  }, [messages]);

  const [vibePreviewMessageId, setVibePreviewMessageId] = useState<
    string | null
  >(null);
  const [vibePreviewFiles, setVibePreviewFiles] = useState<Record<
    string,
    string
  > | null>(null);

  const handleVibePreviewReady = useCallback(
    (messageId: string, files: Record<string, string>) => {
      if (Object.keys(files).length === 0) return;
      setVibePreviewMessageId(messageId);
      setVibePreviewFiles(files);
    },
    [],
  );

  /** Keeps Vibe streams writing into the correct chat in `chats` even when the user switches away. */
  const patchMessagesForChat = useCallback(
    (chatId: string, update: (prev: Message[]) => Message[]) => {
      setChats((prevChats) => {
        const i = prevChats.findIndex((c) => c.id === chatId);
        if (i < 0) return prevChats;
        const nextMsgs = update(prevChats[i]!.messages);
        const next = [...prevChats];
        next[i] = { ...next[i]!, messages: nextMsgs, updatedAt: Date.now() };
        return next;
      });
      setMessages((prev) =>
        currentChatIdRef.current === chatId ? update(prev) : prev,
      );
    },
    [],
  );

  const isVibeChat = useCallback((chat: ChatSession) => {
    return (
      chat.kind === "vibe" ||
      chat.messages.some((message) => message.assistantKind === "vibe")
    );
  }, []);

  const openChatSession = useCallback(
    (chat: ChatSession) => {
      setCurrentChatId(chat.id);
      setMessages(chat.messages);
      setSelectedCommand(null);
      setClipInitialUrl("");
      setActiveWorkspaceTab(isVibeChat(chat) ? "vibe" : "chat");
      setChats((prev) =>
        prev.map((item) =>
          item.id === chat.id ? { ...item, vibeUnread: false } : item,
        ),
      );
      let restoredPreview = false;
      const lastDoneVibe = [...chat.messages]
        .reverse()
        .find(
          (m) =>
            m.role === "assistant" &&
            m.assistantKind === "vibe" &&
            !m.isStreaming &&
            typeof m.content === "string" &&
            m.content.includes("<<<VIBE_"),
        );
      if (lastDoneVibe) {
        const files = extractVibeFilesFromContent(lastDoneVibe.content);
        if (Object.keys(files).length > 0) {
          setVibePreviewMessageId(lastDoneVibe.id);
          setVibePreviewFiles(files);
          restoredPreview = true;
        }
      }
      if (!restoredPreview) {
        setVibePreviewMessageId(null);
        setVibePreviewFiles(null);
      }
      setIsSidebarOpen(false);
      window.setTimeout(() => {
        const chatContainer = document.getElementById("chat-container");
        if (chatContainer) {
          chatNearBottomRef.current = true;
          chatContainer.scrollTo({
            top: chatContainer.scrollHeight,
            behavior: "smooth",
          });
        }
      }, 120);
    },
    [isVibeChat],
  );

  const handleChatSelect = useCallback(
    (id: string) => {
      const chat = chats.find((item) => item.id === id);
      if (chat) {
        openChatSession(chat);
      }
    },
    [chats, openChatSession],
  );

  const handleNewChat = useCallback(() => {
    setMessages([]);
    setCurrentChatId(null);
    setSelectedCommand(null);
    setActiveWorkspaceTab("chat");
    setClipInitialUrl("");
    setVibePreviewMessageId(null);
    setVibePreviewFiles(null);
    setIsSidebarOpen(false);
    setSearchQuery("");
  }, []);

  const showVibeLivePreview =
    !!vibePreviewFiles &&
    vibePreviewMessageId != null &&
    vibePreviewMessageId === lastAssistantId &&
    messages.some(
      (m) =>
        m.id === lastAssistantId && m.role === "assistant" && !m.isStreaming,
    );

  useEffect(() => {
    if (!vibePreviewMessageId) return;
    if (!messages.some((m) => m.id === vibePreviewMessageId)) {
      setVibePreviewMessageId(null);
      setVibePreviewFiles(null);
    }
  }, [messages, vibePreviewMessageId]);

  const chatScrollSignature = useMemo(
    () =>
      messages
        .map(
          (m) =>
            `${m.id}:${m.content.length}:${m.isStreaming ? 1 : 0}:${m.isThinking ? 1 : 0}`,
        )
        .join("|"),
    [messages],
  );

  useEffect(() => {
    const el = document.getElementById("chat-container");
    if (!el) return;
    const onScroll = () => {
      const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
      chatNearBottomRef.current = gap < 80;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [messages.length]);

  useLayoutEffect(() => {
    if (!autoScroll) return;
    const el = document.getElementById("chat-container");
    if (!el || messages.length === 0) return;
    if (!chatNearBottomRef.current) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [chatScrollSignature, autoScroll, messages.length, showVibeLivePreview]);

  useEffect(() => {
    if (toastMessage) {
      const t = setTimeout(() => setToastMessage(null), 1800);
      return () => clearTimeout(t);
    }
  }, [toastMessage]);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        textareaRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  const isVibeComposerMode =
    activeWorkspaceTab === "vibe" &&
    selectedCommand?.id !== "clip" &&
    selectedCommand?.id !== "browse";

  useEffect(() => {
    if (messages.length === 0 || isTemporaryChat) return;

    setChats((prevChats) => {
      const existingChatIndex = prevChats.findIndex(
        (c) => c.id === currentChatId,
      );

      if (existingChatIndex >= 0) {
        const newChats = [...prevChats];
        newChats[existingChatIndex] = {
          ...newChats[existingChatIndex],
          messages,
          updatedAt: Date.now(),
        };
        return newChats.sort((a, b) => b.updatedAt - a.updatedAt);
      } else if (currentChatId) {
        const title =
          messages[0].content.slice(0, 30) +
          (messages[0].content.length > 30 ? "..." : "");
        const newChat = {
          id: currentChatId,
          title,
          messages,
          updatedAt: Date.now(),
          kind: messages.some((message) => message.assistantKind === "vibe")
            ? ("vibe" as const)
            : ("chat" as const),
        };
        return [newChat, ...prevChats].sort(
          (a, b) => b.updatedAt - a.updatedAt,
        );
      }
      return prevChats;
    });
  }, [messages, currentChatId, isTemporaryChat]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        inputContainerRef.current &&
        !inputContainerRef.current.contains(event.target as Node) &&
        value.trim().length === 0 &&
        attachments.length === 0 &&
        !selectedCommand &&
        activeWorkspaceTab !== "vibe"
      ) {
        setIsInputExpanded(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [value, attachments.length, selectedCommand, activeWorkspaceTab]);

  const commandSuggestions: CommandSuggestion[] = [
    {
      id: "vibe",
      icon: (isActive) => (
        <div className="relative flex items-center justify-center w-[18px] text-slate-700">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-[18px] h-[18px]"
          >
            <path d="M8 7L13 12L8 17" />
            <motion.path
              d="M15 17H20"
              animate={isActive ? { opacity: [1, 1, 0, 0] } : { opacity: 1 }}
              transition={
                isActive
                  ? {
                      repeat: Infinity,
                      duration: 1,
                      times: [0, 0.49, 0.5, 1],
                      ease: "linear",
                    }
                  : {}
              }
            />
          </svg>
        </div>
      ),
      label: "Vibe Coder",
      description: "Build polished apps in a live workbench",
      prefix: "/vibe",
    },
    {
      id: "clip",
      icon: (isActive) => (
        <div className="relative flex items-center justify-center w-full h-full text-slate-700">
          <motion.div
            animate={
              isActive
                ? { scale: [1, 1.15, 1], rotate: [0, 5, 0] }
                : { scale: 1, rotate: 0 }
            }
            transition={{ repeat: Infinity, duration: 1.5, ease: "easeOut" }}
          >
            <Play className="w-4 h-4" />
          </motion.div>
          {isActive && (
            <motion.div
              initial={{ scale: 0.8, opacity: 0.5 }}
              animate={{ scale: 2, opacity: 0 }}
              transition={{ repeat: Infinity, duration: 1.5, ease: "easeOut" }}
              className="absolute inset-0 border border-slate-700 rounded-md"
            />
          )}
        </div>
      ),
      label: "AI Clip",
      description: "Render cinematic 720p clips with timed subtitles",
      prefix: "/clip",
    },
  ];

  const commandPaletteEnabled = false;
  const isCommandMode =
    commandPaletteEnabled && value.startsWith("/") && !value.includes(" ");
  const commandQuery = isCommandMode ? value.substring(1).toLowerCase() : "";
  const memoizedChats = React.useMemo(() => chats, [chats]);
  const filteredChats = React.useMemo(() => {
    if (!searchQuery) return memoizedChats;
    return memoizedChats.filter(
      (chat) =>
        chat.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        chat.messages.some((msg) =>
          msg.content.toLowerCase().includes(searchQuery.toLowerCase()),
        ),
    );
  }, [memoizedChats, searchQuery]);
  const filteredProjectChats = useMemo(
    () => filteredChats.filter((chat) => isVibeChat(chat)),
    [filteredChats, isVibeChat],
  );
  const filteredStandardChats = useMemo(
    () => filteredChats.filter((chat) => !isVibeChat(chat)),
    [filteredChats, isVibeChat],
  );

  const filteredSuggestions = isCommandMode
    ? commandSuggestions.filter((cmd) =>
        cmd.label.toLowerCase().includes(commandQuery),
      )
    : [];

  useEffect(() => {
    if (
      commandPaletteEnabled &&
      isCommandMode &&
      filteredSuggestions.length > 0
    ) {
      setShowCommandPalette(true);
      if (
        activeSuggestion >= filteredSuggestions.length ||
        activeSuggestion === -1
      ) {
        setActiveSuggestion(0);
      }
    } else {
      setShowCommandPalette(false);
      setActiveSuggestion(-1);
    }
  }, [
    commandPaletteEnabled,
    isCommandMode,
    commandQuery,
    filteredSuggestions.length,
  ]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const commandButton = document.querySelector("[data-command-button]");

      if (
        commandPaletteRef.current &&
        !commandPaletteRef.current.contains(target) &&
        !commandButton?.contains(target)
      ) {
        setShowCommandPalette(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  useEffect(() => {
    const handleResize = () => {
      // Assume base design was for a window around 1200x800, maybe standard laptop.
      const baseWidth = 1200;
      const baseHeight = 800;
      const screenW = window.screen.width;
      const screenH = window.screen.height;
      const innerW = window.innerWidth;
      const innerH = window.innerHeight;

      // Check if we are basically fullscreen (allowing for generic UI shells)
      if (innerW >= screenW - 40 && innerH >= screenH - 120) {
        // Determine scale while maintaining position ratios
        const scaleW = innerW / baseWidth;
        const scaleH = innerH / baseHeight;
        // Take the smaller scale to ensure it fits, but don't shrink below 1
        const newScale = Math.max(1, Math.min(scaleW, scaleH));
        document.documentElement.style.setProperty(
          "--app-scale",
          newScale.toString(),
        );
      } else {
        document.documentElement.style.setProperty("--app-scale", "1");
      }
    };

    handleResize(); // trigger on mount
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showCommandPalette && filteredSuggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveSuggestion((prev) =>
          prev < filteredSuggestions.length - 1 ? prev + 1 : 0,
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveSuggestion((prev) =>
          prev > 0 ? prev - 1 : filteredSuggestions.length - 1,
        );
      } else if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        const targetIndex = activeSuggestion >= 0 ? activeSuggestion : 0;
        if (targetIndex >= 0 && targetIndex < filteredSuggestions.length) {
          const selectedCmd = filteredSuggestions[targetIndex];
          const originalIndex = commandSuggestions.findIndex(
            (c) => c.prefix === selectedCmd.prefix,
          );
          selectCommandSuggestion(originalIndex);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        setShowCommandPalette(false);
        setValue("");
        setSelectedCommand(null);
        setIsInputExpanded(false);
        adjustHeight();
        textareaRef.current?.blur();
      }
    } else if (e.key === "Enter" && !e.shiftKey) {
      if (sendOnEnter) {
        e.preventDefault();
        if (value.trim() || selectedCommand) {
          handleSendMessage();
        }
      }
    } else if (e.key === "Enter" && e.shiftKey) {
      if (!sendOnEnter) {
        e.preventDefault();
        if (value.trim() || selectedCommand) {
          handleSendMessage();
        }
      }
    } else if (e.key === "Escape") {
      if (value || selectedCommand) {
        e.preventDefault();
        setValue("");
        setSelectedCommand(null);
        setIsInputExpanded(false);
        adjustHeight();
      } else {
        textareaRef.current?.blur();
      }
    }
  };

  const buildVibeProjectTitle = (prompt: string) => {
    const clean = prompt
      .replace(/^make\s+(me\s+)?/i, "")
      .replace(/^build\s+(me\s+)?/i, "")
      .replace(/^create\s+(me\s+)?/i, "")
      .replace(/\b(a|an|the)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    const lower = clean.toLowerCase();
    if (lower.includes("calculator")) return "Calculator App";
    if (
      lower.includes("task") ||
      lower.includes("planner") ||
      lower.includes("todo") ||
      lower.includes("kanban")
    )
      return "Task Planner App";
    if (lower.includes("landing") && lower.includes("openai"))
      return "OpenAI Landing Page";
    if (lower.includes("landing")) return "Launch Landing Page";
    if (lower.includes("dashboard")) return "Analytics Dashboard";
    if (lower.includes("login") || lower.includes("auth")) return "Auth Flow";
    if (!clean) return "Vibe Project";
    return clean
      .split(" ")
      .slice(0, 4)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ");
  };

  const buildVibeProjectRoot = (prompt: string) => {
    const slug = buildVibeProjectTitle(prompt)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 42);
    return `vibe-project/${slug || "clyra-vibe-project"}`;
  };

  const buildLocalVibeFallback = (userPrompt: string) => {
    const fallbackProjectTitle = buildVibeProjectTitle(userPrompt);
    return buildLocalVibeFallbackResponse(userPrompt, fallbackProjectTitle);

    const lowerPrompt = userPrompt.toLowerCase();
    const isTimerApp = /\b(timer|pomodoro|stopwatch|countdown)\b/.test(
      lowerPrompt,
    );
    const projectTitle = buildVibeProjectTitle(userPrompt);
    const projectTitleLiteral = JSON.stringify(projectTitle);
    const projectPromptLiteral = JSON.stringify(userPrompt);
    const appCode = isTimerApp
      ? `import React, { useEffect, useMemo, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";

/** A premium minimal timer app rendered inside the isolated Vibe sandbox. */
export default function TimerApp() {
  const [secondsLeft, setSecondsLeft] = useState(25 * 60);
  const [isRunning, setIsRunning] = useState(false);
  const totalSeconds = 25 * 60;

  useEffect(() => {
    if (!isRunning) return;
    const id = window.setInterval(() => {
      setSecondsLeft((value) => {
        if (value <= 1) {
          setIsRunning(false);
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [isRunning]);

  const minutes = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const seconds = String(secondsLeft % 60).padStart(2, "0");
  const progress = useMemo(() => 1 - secondsLeft / totalSeconds, [secondsLeft]);

  return (
    <main className="grid min-h-screen place-items-center bg-[#10100d] px-6 text-white">
      <section className="w-full max-w-md rounded-lg border border-white/10 bg-white/[0.06] p-6 shadow-xl shadow-black/30">
        <div className="mb-10 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#d6b56d]">Focus timer</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">Minimal Timer</h1>
          </div>
          <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/45">25 min</span>
        </div>

        <div className="relative mx-auto grid h-64 w-64 place-items-center rounded-full border border-white/10 bg-black/25">
          <svg className="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="43" fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="4" />
            <circle cx="50" cy="50" r="43" fill="none" stroke="#d6b56d" strokeLinecap="round" strokeWidth="4" strokeDasharray={270} strokeDashoffset={270 - progress * 270} />
          </svg>
          <div className="text-center">
            <p className="text-6xl font-semibold tabular-nums">{minutes}:{seconds}</p>
            <p className="mt-3 text-sm text-white/40">{isRunning ? "Session running" : secondsLeft === 0 ? "Complete" : "Ready"}</p>
          </div>
        </div>

        <div className="mt-10 grid grid-cols-[1fr_auto] gap-3">
          <button onClick={() => setIsRunning((value) => !value)} className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-[#d6b56d] px-5 text-sm font-semibold text-[#17130b] transition hover:bg-[#e7c981]">
            {isRunning ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {isRunning ? "Pause" : "Start"}
          </button>
          <button onClick={() => { setIsRunning(false); setSecondsLeft(totalSeconds); }} className="grid h-12 w-12 place-items-center rounded-lg border border-white/10 bg-white/[0.05] text-white/70 transition hover:bg-white/10 hover:text-white" aria-label="Reset timer">
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>
      </section>
    </main>
  );
}`
      : `import React, { useMemo, useState } from "react";
import { CheckCircle2, Circle, Plus, Sparkles, Trash2 } from "lucide-react";

const projectTitle = ${projectTitleLiteral};
const projectPrompt = ${projectPromptLiteral};

/** A working prompt-specific app rendered inside the isolated Vibe sandbox. */
export default function AdaptiveWorkspaceApp() {
  const seedTasks = useMemo(() => {
    const words = projectPrompt
      .split(/\\s+/)
      .filter((word) => word.length > 3)
      .slice(0, 5);
    return (words.length ? words : ["design", "build", "polish"]).map((word, index) => ({
      id: String(index),
      label: "Ship " + word.replace(/[^a-z0-9]/gi, ""),
      done: index === 0,
    }));
  }, []);
  const [tasks, setTasks] = useState(seedTasks);
  const [note, setNote] = useState(projectPrompt);
  const [newTask, setNewTask] = useState("");
  const completeCount = tasks.filter((task) => task.done).length;
  const progress = Math.round((completeCount / Math.max(1, tasks.length)) * 100);
  const addTask = () => {
    const clean = newTask.trim();
    if (!clean) return;
    setTasks((items) => [
      ...items,
      { id: crypto.randomUUID(), label: clean, done: false },
    ]);
    setNewTask("");
  };

  return (
    <main className="min-h-screen bg-[#f6f7f4] p-6 text-slate-950">
      <section className="mx-auto grid min-h-[calc(100vh-3rem)] max-w-6xl gap-5 lg:grid-cols-[0.9fr_1.1fr]">
        <aside className="rounded-xl border border-black/10 bg-white/80 p-6 shadow-xl shadow-slate-200/70">
          <div className="grid h-12 w-12 place-items-center rounded-lg bg-black text-white">
            <Sparkles className="h-5 w-5" />
          </div>
          <p className="mt-8 text-xs font-bold uppercase tracking-[0.24em] text-emerald-700">
            Interactive app
          </p>
          <h1 className="mt-3 text-5xl font-semibold tracking-tight">
            {projectTitle}
          </h1>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="mt-6 min-h-36 w-full resize-none rounded-lg border border-black/10 bg-slate-50 p-4 leading-7 outline-none transition focus:border-black/25"
          />
          <div className="mt-6 grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg bg-slate-50 p-4">
              <p className="text-2xl font-semibold">{tasks.length}</p>
              <p className="text-xs font-semibold text-slate-500">Tasks</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-4">
              <p className="text-2xl font-semibold">{completeCount}</p>
              <p className="text-xs font-semibold text-slate-500">Done</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-4">
              <p className="text-2xl font-semibold">{progress}%</p>
              <p className="text-xs font-semibold text-slate-500">Progress</p>
            </div>
          </div>
          <div className="mt-6 h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-emerald-700 transition-all"
              style={{ width: progress + "%" }}
            />
          </div>
        </aside>

        <div className="rounded-xl border border-black/10 bg-white p-5 shadow-2xl shadow-slate-200">
          <div className="flex gap-2">
            <input
              value={newTask}
              onChange={(event) => setNewTask(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && addTask()}
              placeholder="Add an app task..."
              className="h-12 flex-1 rounded-lg border border-black/10 px-4 outline-none transition focus:border-black/25"
            />
            <button
              onClick={addTask}
              className="inline-flex h-12 items-center gap-2 rounded-lg bg-black px-5 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              <Plus className="h-4 w-4" />
              Add
            </button>
          </div>
          <div className="mt-5 space-y-3">
            {tasks.map((task) => (
              <div
                key={task.id}
                className="flex items-center gap-3 rounded-lg border border-black/10 bg-slate-50 p-4"
              >
                <button
                  onClick={() =>
                    setTasks((items) =>
                      items.map((item) =>
                        item.id === task.id ? { ...item, done: !item.done } : item,
                      ),
                    )
                  }
                  className="text-slate-700"
                >
                  {task.done ? (
                    <CheckCircle2 className="h-5 w-5" />
                  ) : (
                    <Circle className="h-5 w-5" />
                  )}
                </button>
                <span
                  className={
                    task.done
                      ? "flex-1 text-slate-400 line-through"
                      : "flex-1 font-medium"
                  }
                >
                  {task.label}
                </span>
                <button
                  onClick={() =>
                    setTasks((items) => items.filter((item) => item.id !== task.id))
                  }
                  className="text-slate-400 transition hover:text-red-500"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}`;
    const fallbackBuildLabel = isTimerApp
      ? "a premium minimal focus timer with start, pause, reset, and progress ring"
      : `a working interactive ${projectTitle} app with editable state, task controls, and progress tracking`;
    const fallbackDesignDirection = isTimerApp
      ? "Cinematic minimal utility app with a dark canvas, gold progress ring, large readable timer, and compact controls."
      : "Light, minimal software UI with real controls, prompt-matched hierarchy, restrained contrast, responsive structure, and no landing-page filler.";

    return `<<<VIBE_THINKING>>>
Build session
Active agent: Build
Phase: Implement
Intent: ${userPrompt}
Context: Remote generation was unavailable, so I am creating a compact working sandbox preview directly.
TodoWrite: Build the requested UI in vibe-project/src/App.tsx, then verify the preview handoff.
Next tool: Write
Why: A real preview file is more useful than a staged planning timeline.
${fallbackDesignDirection}
<<<END_VIBE_THINKING>>>
Writing the sandbox preview.
<<<VIBE_CODE file="vibe-project/src/App.tsx" added="${appCode.split("\n").length}" removed="0">>>
${appCode}
<<<END_VIBE_CODE>>>
<<<VIBE_THINKING>>>
Build session
Active agent: Build
Phase: Verify
Intent: ${userPrompt}
Context: The preview now has a real React surface with local state and visible controls.
TodoWrite: Verify the generated App.tsx can be handed to the sandbox preview.
Next tool: Bash
Why: The user needs a working preview, not extra process cards.
<<<END_VIBE_THINKING>>>
<<<VIBE_RUN>>>
RUNNING COMMAND
$ npm run lint
Purpose: validate the generated React preview shape
OUTPUT
Command prepared for the sandbox preview. The host app also runs its own TypeScript checks before shipping.
<<<END_VIBE_RUN>>>
<<<VIBE_THINKING>>>
SHIPPED

WHAT WAS BUILT:
A sandboxed Vibe preview with ${fallbackBuildLabel}. The code is isolated under vibe-project and loaded by the preview server after verification.

FILE MANIFEST:
Created:
vibe-project/src/App.tsx — primary preview surface.

HOW TO RUN:
npm run dev
Then open the live preview URL shown in the workbench.

KNOWN TRADEOFFS:
The local fallback is intentionally compact so recovery stays fast and reliable.
<<<END_VIBE_THINKING>>>`;
  };

  const streamLocalVibeFallback = async (
    aiMsgId: string,
    streamChatId: string,
    fallback: string,
  ) => {
    let full = "";
    const chunks = fallback.match(/[\s\S]{1,2200}/g) ?? [fallback];
    for (const chunk of chunks) {
      full += chunk;
      patchMessagesForChat(streamChatId, (prev) =>
        prev.map((msg) =>
          msg.id === aiMsgId
            ? { ...msg, content: full, isThinking: false, isStreaming: true }
            : msg,
        ),
      );
      await new Promise((resolve) => window.setTimeout(resolve, 4));
    }
    patchMessagesForChat(streamChatId, (prev) =>
      prev.map((msg) =>
        msg.id === aiMsgId
          ? { ...msg, isThinking: false, isStreaming: false }
          : msg,
      ),
    );
  };

  const simulateVibeCoder = async (
    aiMsgId: string,
    userPrompt: string,
    streamChatId: string,
  ) => {
    setChats((prev) =>
      prev.map((chat) =>
        chat.id === streamChatId
          ? {
              ...chat,
              kind: "vibe",
              vibeRunning: true,
              vibeUnread: false,
              updatedAt: Date.now(),
            }
          : chat,
      ),
    );
    try {
      const remoteVibeEnabled =
        window.localStorage.getItem("clyra-vibe-remote") !== "false";
      if (!remoteVibeEnabled) {
        const fallback = buildLocalVibeFallback(userPrompt);
        await streamLocalVibeFallback(aiMsgId, streamChatId, fallback);
        setChats((prev) =>
          prev.map((chat) =>
            chat.id === streamChatId
              ? {
                  ...chat,
                  kind: "vibe",
                  vibeRunning: false,
                  vibeUnread: currentChatIdRef.current !== streamChatId,
                  updatedAt: Date.now(),
                }
              : chat,
          ),
        );
        return;
      }

      const vibeProjectRoot = buildVibeProjectRoot(userPrompt);
      let full = "";
      const openAiMessages = [
        {
          role: "user",
          content: `User request - build a complete, polished React 19 + TypeScript experience with Tailwind-compatible classes, lucide-react, and framer-motion where helpful.

Project context: elite in-browser coding agent. Your stream is rendered as a live timeline.
You MUST follow a Cursor-style build loop: inspect, plan, implement, reflect, verify. Adapt the depth to the request instead of using a fixed script.

Project root for this build:
  ${vibeProjectRoot}

Required build contract:
  1) Think like a senior product engineer. Build the complete version the user probably expects, not the smallest possible component.
  2) DEEP REASONING: Before any code, you MUST emit a <<<VIBE_CODE file="${vibeProjectRoot}/plan.md">>> block.
     - This plan must be a detailed breakdown of architecture, file structure, component hierarchy, state management, and implementation steps.
     - Use this plan to reason through complex logic before writing product code. Do not pad it with generic steps.
  3) Emit a concise opening <<<VIBE_THINKING>>> block that identifies the product type, the architecture choice, and the first concrete step from the plan.
  4) Write real source files under ${vibeProjectRoot}. Split meaningful work across components, data, hooks, and utilities when the request deserves it.
  5) Use honest implementation phases. Small tools may need only 2-3 phases; complex products should use more. After each major phase, emit a <<<VIBE_THINKING>>> reflection naming what was completed, what changed, what risk remains, and what the next plan.md step is.
  6) Build obvious supporting features automatically: empty states, loading states, responsive layouts, working controls, validation, navigation, and polished interactions where relevant.
  7) Every button, menu, tab, modal, form, dropdown, sidebar, and navigation element you render must work locally with React state.
  8) Verify with one <<<VIBE_RUN>>> card before the final SHIPPED block and only claim work that is represented by actual code blocks.

Hard rules:
  - NEVER use markdown triple-backtick fences. All code goes inside <<<VIBE_CODE>>> as raw source.
  - Prose OUTSIDE delimiters must be short (≤1 sentence). Long reasoning belongs inside DEEP THINKING.
  - SANDBOX: every \`file\` and \`path\` MUST start with \`${vibeProjectRoot}/\`.
  - Each top-level export in your CODE blocks should have a one-line JSDoc above it.
  - The final SHIPPED block must list the actual files created.
  - Avoid repeating the same labels or filler wording between steps. The timeline should feel like a real agent noticing the current project.

Request details: ${userPrompt}`,
        },
      ];

      // Use deepseek-chat (non-reasoning) for the structured agent stream so the model spends
      // its entire output budget on the delimited timeline (thinking + analyze + code + ...)
      // instead of burning tokens on internal reasoning that we discard anyway.
      const vibeAbort = new AbortController();
      let acceptRemoteVibeChunks = true;
      let vibeTimeout: number | undefined;
      try {
        await Promise.race([
          streamOpenAI(
            VIBE_CURSOR_AGENT_SYSTEM_PROMPT,
            openAiMessages,
            (chunkText, isReasoning) => {
              if (!acceptRemoteVibeChunks || isReasoning) {
                return;
              }
              full += chunkText;
              patchMessagesForChat(streamChatId, (prev) =>
                prev.map((msg) =>
                  msg.id === aiMsgId
                    ? {
                        ...msg,
                        content: full,
                        isThinking: false,
                      }
                    : msg,
                ),
              );
            },
            0.6,
            8000,
            "deepseek-chat",
            vibeAbort.signal,
          ),
          new Promise<never>((_, reject) => {
            vibeTimeout = window.setTimeout(() => {
              acceptRemoteVibeChunks = false;
              vibeAbort.abort();
              reject(new Error("Vibe remote stream timed out"));
            }, 45000);
          }),
        ]);
      } finally {
        acceptRemoteVibeChunks = false;
        if (vibeTimeout !== undefined) window.clearTimeout(vibeTimeout);
      }

      const codeBlockMatches =
        full.match(/<<<VIBE_CODE\s+file="vibe-project\/[^"]+"/g) ?? [];
      if (
        codeBlockMatches.length < 4 ||
        !/<<<VIBE_CODE\s+file="vibe-project\/[^"]*\/src\/App\.tsx"/.test(full)
      ) {
        throw new Error(
          "Vibe remote stream returned no complete sandbox preview",
        );
      }

      // Removed fetch

      patchMessagesForChat(streamChatId, (prev) =>
        prev.map((msg) =>
          msg.id === aiMsgId
            ? {
                ...msg,
                isThinking: false,
                isStreaming: false,
              }
            : msg,
        ),
      );
      setChats((prev) =>
        prev.map((chat) =>
          chat.id === streamChatId
            ? {
                ...chat,
                kind: "vibe",
                vibeRunning: false,
                vibeUnread: currentChatIdRef.current !== streamChatId,
                updatedAt: Date.now(),
              }
            : chat,
        ),
      );

      setTimeout(() => {
        const chatContainer = document.getElementById("chat-container");
        if (chatContainer && autoScroll) {
          chatContainer.scrollTo({
            top: chatContainer.scrollHeight,
            behavior: "smooth",
          });
        }
      }, 300);
    } catch (error) {
      console.warn("Vibe Coder switched to the local sandbox fallback:", error);
      const fallback = buildLocalVibeFallback(userPrompt);
      await streamLocalVibeFallback(aiMsgId, streamChatId, fallback);
      setChats((prev) =>
        prev.map((chat) =>
          chat.id === streamChatId
            ? {
                ...chat,
                kind: "vibe",
                vibeRunning: false,
                vibeUnread: currentChatIdRef.current !== streamChatId,
                updatedAt: Date.now(),
              }
            : chat,
        ),
      );
    }
  };

  const handleAutoFix = useCallback(
    (error: { message: string; stack?: string; label?: string }) => {
      if (!currentChatIdRef.current || !vibePreviewMessageId) return;

      const errorPrompt = `The live preview encountered a ${error.label || "runtime"} error:
\`\`\`
${error.message}
${error.stack || ""}
\`\`\`
Please analyze the code you just wrote and fix this error.`;

      const userMsgId = Date.now().toString();
      const aiMsgId = (Date.now() + 1).toString();

      setMessages((prev) => [
        ...prev,
        {
          id: userMsgId,
          role: "user",
          content: "I'm seeing an error in the preview. Can you fix it?",
        },
        {
          id: aiMsgId,
          role: "assistant",
          content: "",
          isThinking: true,
          isStreaming: true,
          assistantKind: "vibe",
          vibeUserPrompt: "Fixing preview error...",
        },
      ]);

      simulateVibeCoder(aiMsgId, errorPrompt, currentChatIdRef.current);
    },
    [vibePreviewMessageId, simulateVibeCoder],
  );

  const handlePreviewElementReference = useCallback(
    (label: string) => {
      const chatId = currentChatIdRef.current;
      if (!chatId) return;
      const clean = label.trim().slice(0, 160);
      if (!clean) return;
      const referenceMessage: Message = {
        id: `${Date.now()}-preview-ref`,
        role: "user",
        content: `Referenced preview element: ${clean}`,
      };
      patchMessagesForChat(chatId, (prev) => [...prev, referenceMessage]);
      setToastMessage("Preview element referenced in chat");
    },
    [patchMessagesForChat],
  );

  const handleSendMessage = async () => {
    if (!value.trim() && attachments.length === 0) return;

    if (value.trim() || selectedCommand) {
      const pendingRewrite = pendingDocumentRewriteRef.current;
      if (pendingRewrite && value.trim()) {
        const instruction = value.trim();
        pendingDocumentRewriteRef.current = null;
        setRewritePhase("applying");
        setSelectedCommand(null);
        setActiveSkeletonText(null);
        setValue("");
        adjustHeight(true);
        setToastMessage(
          pendingRewrite.mode === "fix"
            ? "Fixing selected text..."
            : "Rephrasing selected text...",
        );

        try {
          let replacement = "";
          await streamOpenAI(
            pendingRewrite.mode === "fix"
              ? "Fix spelling, grammar, punctuation, and clarity. Preserve the meaning and formatting intent. Return only the corrected replacement text."
              : "Rewrite the selected text according to the user's instruction. Preserve meaning unless the instruction asks otherwise. Return only the replacement text.",
            [
              {
                role: "user",
                content: `Selected text:\n${pendingRewrite.selectedText}\n\nInstruction:\n${instruction}`,
              },
            ],
            (chunkText, isReasoning) => {
              if (!isReasoning) replacement += chunkText;
            },
            0.35,
            700,
            "deepseek-chat",
          );

          const cleanedReplacement = replacement
            .trim()
            .replace(/^["'`]+|["'`]+$/g, "");
          pendingRewrite.applyReplacement(
            cleanedReplacement || pendingRewrite.selectedText,
          );
          setIsRephrasingMode(false);
          setRewritePhase("ready");
          setToastMessage("Selected text updated");
        } catch (error) {
          console.warn("Document rewrite failed:", error);
          pendingRewrite.applyReplacement(pendingRewrite.selectedText);
          setIsRephrasingMode(false);
          setRewritePhase("ready");
          setToastMessage("Rewrite unavailable, kept original text");
        }
        return;
      }

      setVibePreviewMessageId(null);
      setVibePreviewFiles(null);
      const userCommandLabel =
        selectedCommand?.label ??
        (activeWorkspaceTab === "vibe" ? "Vibe Coder" : undefined);
      const userCommandId =
        selectedCommand?.id ??
        (activeWorkspaceTab === "vibe" ? "vibe" : undefined);
      const rawUserText = value.trim();
      const vibeCommand = rawUserText.match(/^\/vibe(?:\s+(.+))?$/i);
      const clipCommand = rawUserText.match(/^\/clip(?:\s+(.+))?$/i);
      if (userCommandId === "clip" || clipCommand) {
        const clipCommandSource = clipCommand?.[1]?.trim() ?? rawUserText;
        setClipInitialUrl(
          clipCommandSource && !clipCommandSource.startsWith("/clip")
            ? clipCommandSource
            : "",
        );
        setSelectedCommand(
          commandSuggestions.find((command) => command.id === "clip") ?? null,
        );
        setActiveWorkspaceTab("browser");
        setValue("");
        adjustHeight(true);
        setRecentCommand(null);
        setShowCommandPalette(false);
        return;
      }
      const userText =
        vibeCommand?.[1]?.trim() ||
        rawUserText ||
        (userCommandLabel ? `Execute ${userCommandLabel}` : "");
      setValue("");
      setSelectedCommand(null);
      adjustHeight(true);
      setRecentCommand(null);

      let chatId = currentChatId;
      const isFirstMessage = messages.length === 0 && !chatId;
      if (isFirstMessage) {
        chatId = Date.now().toString();
        setCurrentChatId(chatId);
      }

      const currentMessages = messages;
      const userMsgId = Date.now().toString();
      const aiMsgId = (Date.now() + 1).toString();

      const isVibeMode = userCommandId === "vibe" || Boolean(vibeCommand);
      setActiveWorkspaceTab(isVibeMode ? "vibe" : "chat");
      const userMessage: Message = {
        id: userMsgId,
        role: "user",
        content: userText,
      };
      const assistantMessage: Message = {
        id: aiMsgId,
        role: "assistant",
        content: "",
        isThinking: true,
        isStreaming: true,
        assistantKind: isVibeMode ? "vibe" : "chat",
        ...(isVibeMode ? { vibeUserPrompt: userText } : {}),
      };
      const nextMessages = [...currentMessages, userMessage, assistantMessage];

      chatNearBottomRef.current = true;
      setMessages(nextMessages);

      if (isVibeMode && chatId && !isTemporaryChat) {
        const projectTitle = buildVibeProjectTitle(userText);
        setChats((prev) => {
          const existing = prev.find((chat) => chat.id === chatId);
          const nextChat: ChatSession = {
            ...(existing ?? {
              id: chatId!,
              title: projectTitle,
              updatedAt: Date.now(),
              messages: [],
            }),
            title: existing?.title ?? projectTitle,
            messages: nextMessages,
            kind: "vibe",
            vibeRunning: true,
            vibeUnread: false,
            updatedAt: Date.now(),
          };
          return [nextChat, ...prev.filter((chat) => chat.id !== chatId)].sort(
            (a, b) => b.updatedAt - a.updatedAt,
          );
        });
      }

      setTimeout(() => {
        const chatContainer = document.getElementById("chat-container");
        if (chatContainer && autoScroll) {
          chatNearBottomRef.current = true;
          chatContainer.scrollTo({
            top: chatContainer.scrollHeight,
            behavior: "smooth",
          });
        }
      }, 100);

      try {
        if (isFirstMessage && !isTemporaryChat && chatId) {
          let generatedTitle = "";
          void streamOpenAI(
            "Generate a concise chat title of 4 words or fewer. Return only the title text, with no quotes and no punctuation unless needed.",
            [{ role: "user", content: userText }],
            (chunkText, isReasoning) => {
              if (!isReasoning) generatedTitle += chunkText;
            },
            0.2,
            48,
            "deepseek-chat",
          )
            .then(() => {
              const newTitle = generatedTitle.trim().replace(/^"|"$/g, "");
              if (!newTitle) return;
              setChats((prev) =>
                prev.map((c) =>
                  c.id === chatId ? { ...c, title: newTitle } : c,
                ),
              );
            })
            .catch((error) => {
              console.warn("DeepSeek title generation skipped:", error);
            });
        }

        if (isVibeMode && chatId) {
          simulateVibeCoder(aiMsgId, userText, chatId);
          return;
        }

        const shouldResearch = needsWebResearch(userText);
        let researchContext = "";

        if (shouldResearch) {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === aiMsgId
                ? { ...msg, isResearching: true, researchSites: [], isThinking: true }
                : msg,
            ),
          );

          try {
            const researchResult = await runResearch(userText, (event) => {
              if (event.type === "site") {
                setMessages((prev) =>
                  prev.map((msg) => {
                    if (msg.id !== aiMsgId) return msg;
                    const existing = msg.researchSites ?? [];
                    const alreadySeen = existing.some(
                      (site) => site.url === event.url || site.host === event.host,
                    );
                    if (alreadySeen) return msg;
                    return {
                      ...msg,
                      researchSites: [
                        ...existing,
                        {
                          host: event.host,
                          title: event.title,
                          url: event.url,
                        },
                      ],
                    };
                  }),
                );
              }
            });

            if (researchResult) {
              researchContext = formatResearchContext(researchResult);
            }
          } catch (error) {
            console.warn("Web research failed:", error);
            researchContext =
              "Web research could not be completed. Say you could not verify facts online and avoid guessing.";
          } finally {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === aiMsgId ? { ...msg, isResearching: false } : msg,
              ),
            );
          }
        }

        const contents = currentMessages.map((msg) => ({
          role: msg.role === "user" ? "user" : "model",
          parts: [{ text: msg.content }],
        }));
        contents.push({ role: "user", parts: [{ text: userText }] });

        try {
          let accumulatedText = "";
          let accumulatedReasoning = "";
          const openAiMessages = contents.map((c) => ({
            role: c.role === "model" ? "assistant" : c.role,
            content: c.parts[0].text,
          }));

          const basePrompt =
            systemPrompt.trim() !== ""
              ? systemPrompt.trim()
              : "Your name is Clyra, an AI assistant. Give helpful and appropriately detailed responses.";

          const researchPrompt = researchContext
            ? `\n\nWEB RESEARCH CONTEXT (verified sources — do not invent facts beyond this):\n${researchContext}`
            : shouldResearch
              ? "\n\nNo verified web research was available. Say you could not confirm facts online and avoid guessing."
              : "";

          const wantsNotes =
            /\b(?:notes?|summary|study\s+notes|meeting\s+notes|class\s+notes|tutorial\s+notes)\b/i.test(
              userText,
            );

          const notesContract = wantsNotes
            ? `\n\nNOTES MODE CONTRACT
Create clean, easy-to-read notes from the information I give you. If the user asks for notes, a summary, study notes, meeting notes, class notes, tutorial notes, or anything note-like, you must output polished Markdown notes that follow this contract.

The notes must adapt to the topic and user's request. Keep it short unless the topic needs detail. Do not force sections that are not useful. Make the notes feel custom-made, not like a generic template.

Formatting contract:
* Use # for the big main heading.
* Use ## for main sections.
* Use ### for subtopics.
* Use **bold** for key words.
* Use --- as dividers between major sections.
* Use bullet points for quick ideas.
* Use > quote boxes for important takeaways.
* Use Markdown tables only when they make the information easier to read.
* Use - [ ] checklists only when there are real actions or next steps.

Information to turn into notes:
${userText}`
            : "";

          const researchAnswerContract = shouldResearch
            ? `\n\nRESEARCH ANSWER MODE
Answer the user's factual question in clear, conversational prose.
Use only verified web research provided above.
Cite sources inline like [1] or [2] when stating facts.
If research is incomplete, say what you could not verify instead of guessing.
Keep the response concise, accurate, and easy to read.`
            : "";

          const finalPrompt =
            basePrompt + researchPrompt + researchAnswerContract + notesContract;

          await streamOpenAI(
            finalPrompt,
            openAiMessages,
            (chunkText, isReasoning) => {
              if (isReasoning) {
                accumulatedReasoning += chunkText;
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === aiMsgId
                      ? { ...msg, reasoningContent: accumulatedReasoning }
                      : msg,
                  ),
                );
              } else {
                accumulatedText += chunkText;
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === aiMsgId
                      ? { ...msg, content: accumulatedText, isThinking: false }
                      : msg,
                  ),
                );
              }
            },
            temperature,
          );

          // End of streaming
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === aiMsgId
                ? { ...msg, isStreaming: false, isThinking: false }
                : msg,
            ),
          );
        } catch (error) {
          console.error("Standard chat stream error:", error);
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === aiMsgId
                ? {
                    ...msg,
                    content:
                      "Sorry, I've hit a rate limit right now! Please try again in an hour or so. In the meantime, the UI works perfectly.",
                    isThinking: false,
                    isStreaming: false,
                  }
                : msg,
            ),
          );
        }
      } catch (error) {
        console.error("AI Error:", error);
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === aiMsgId
              ? {
                  ...msg,
                  content:
                    "Sorry, I encountered an error while processing your request.",
                  isThinking: false,
                  isStreaming: false,
                }
              : msg,
          ),
        );
      }
    }
  };

  const handleAttachFile = () => {
    fileInputRef.current?.click();
  };

  const handleFilesSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length) {
      setAttachments((prev) => [...prev, ...files.map((file) => file.name)]);
      setIsInputExpanded(true);
    }
    event.target.value = "";
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const selectCommandSuggestion = (index: number) => {
    const selectedCmd = commandSuggestions[index];
    setSelectedCommand(selectedCmd);
    if (selectedCmd?.id === "vibe") {
      setActiveWorkspaceTab("vibe");
    } else if (selectedCmd?.id === "clip") {
      setActiveWorkspaceTab("browser");
    } else if (selectedCmd?.id !== "clip") {
      setActiveWorkspaceTab("chat");
    }
    setClipInitialUrl("");
    setValue("");
    setShowCommandPalette(false);
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
    }, 50);
  };

  const isClipWorkspace =
    activeWorkspaceTab === "browser" || selectedCommand?.id === "clip";
  const isVibeWorkspace = activeWorkspaceTab === "vibe" && !isClipWorkspace;
  const showSidebarControls = activeWorkspaceTab === "chat" && !isClipWorkspace;
  const rawShowWorkspaceLivePreview = isVibeWorkspace && showVibeLivePreview;
  const [workspacePreviewLayoutVisible, setWorkspacePreviewLayoutVisible] =
    useState(rawShowWorkspaceLivePreview);
  const showWorkspaceLivePreview = rawShowWorkspaceLivePreview;
  const keepWorkspacePreviewLayout =
    showWorkspaceLivePreview || workspacePreviewLayoutVisible;

  useEffect(() => {
    if (rawShowWorkspaceLivePreview) {
      setWorkspacePreviewLayoutVisible(true);
      return;
    }

    if (!isWorkspaceSwitching) {
      setWorkspacePreviewLayoutVisible(false);
    }
  }, [isWorkspaceSwitching, rawShowWorkspaceLivePreview]);

  const workspaceViewKey = isClipWorkspace
    ? "clip"
    : isVibeWorkspace
      ? "vibe"
      : "chat";
  const activeInputCommand =
    selectedCommand && selectedCommand.id !== "vibe" ? selectedCommand : null;
  const inputPlaceholder = isVibeWorkspace
    ? "Tell the coding agent what to build..."
    : "Ask Clyra anything...";
  const firstUserMessageId = messages.find(
    (message) => message.role === "user",
  )?.id;
  const emptyStateTitle = isVibeWorkspace
    ? "Clyra Vibe is ready."
    : "Hi there, I'm Clyra";
  const emptyStateSubtitle = isVibeWorkspace
    ? ""
    : "What can I help you with today?";
  const workflowTabs: Array<{
    id: WorkspaceTabId;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: "chat", label: "Chat", icon: MessageCircleDashed },
    { id: "vibe", label: "Vibe Coder", icon: SquarePen },
    { id: "browser", label: "Clip", icon: Scissors },
  ];
  const sidebarWidthPx = 272;
  const sidebarClearancePx = sidebarWidthPx + 24;
  const effectiveWorkspaceViewport =
    isSidebarOpen && showSidebarControls && viewportWidth >= 760
      ? Math.max(420, viewportWidth - sidebarClearancePx)
      : viewportWidth;
  const centeredContentWidth = isClipWorkspace
    ? Math.min(940, Math.max(0, effectiveWorkspaceViewport - 32))
    : showWorkspaceLivePreview
      ? Math.min(effectiveWorkspaceViewport, 1180)
      : Math.min(768, Math.max(0, effectiveWorkspaceViewport - 32));
  const naturalContentGap = Math.max(
    0,
    (viewportWidth - centeredContentWidth) / 2,
  );
  const sidebarAvoidShift =
    isSidebarOpen &&
    showSidebarControls &&
    viewportWidth >= 760 &&
    naturalContentGap < sidebarClearancePx
      ? Math.min(
          sidebarClearancePx - naturalContentGap,
          sidebarWidthPx * 0.52,
        )
      : 0;

  useEffect(() => {
    if (!showSidebarControls) {
      setIsSidebarOpen(false);
    }
  }, [showSidebarControls]);
  const workspaceSwipeTravelPx = Math.min(
    Math.max(360, viewportWidth - 16),
    Math.max(360, centeredContentWidth) + 8,
  );
  const workspaceSwipeEase = [0.38, 0, 0.16, 1] as [
    number,
    number,
    number,
    number,
  ];
  const workspaceSwipeTransition = {
    type: "tween" as const,
    duration: 0.58,
    ease: workspaceSwipeEase,
  };
  const workspacePanelVariants = {
    enter: (direction: number) => ({
      opacity: 0.995,
      x: direction > 0 ? workspaceSwipeTravelPx : -workspaceSwipeTravelPx,
    }),
    center: {
      opacity: 1,
      x: "0%",
    },
    exit: (direction: number) => ({
      opacity: 0.12,
      x: direction > 0 ? -workspaceSwipeTravelPx : workspaceSwipeTravelPx,
    }),
  };

  const chatQuickActions: Array<{
    baseLabel: string;
    skeletonLabel: string;
    prompt: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    {
      baseLabel: "Plan a launch",
      skeletonLabel: "[for a new product]",
      prompt:
        "Help me create a crisp launch plan with priorities, risks, and next actions.",
      icon: Check,
    },
    {
      baseLabel: "Refine an idea",
      skeletonLabel: "[for a mobile app]",
      prompt: "Help me refine this idea into a polished product concept:",
      icon: MessageCircleDashed,
    },
    {
      baseLabel: "Draft something",
      skeletonLabel: "[like a blog post]",
      prompt: "Write a concise, professional draft for:",
      icon: SquarePen,
    },
  ];

  const vibeQuickActions: Array<{
    label: string;
    prompt: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    {
      label: "Agent dashboard",
      prompt:
        "Build a premium SaaS analytics dashboard with charts, filters, command actions, and a polished light theme.",
      icon: AppWindow,
    },
    {
      label: "Product launch",
      prompt:
        "Build a cinematic product landing page with a strong first viewport, refined sections, and responsive polish.",
      icon: SquarePen,
    },
    {
      label: "Smart tool",
      prompt:
        "Build a useful interactive web tool with clear controls, smooth states, and production-ready UI details.",
      icon: MousePointer2,
    },
  ];

  const [activeSkeletonText, setActiveSkeletonText] = useState<string | null>(
    null,
  );
  const [isFadingInText, setIsFadingInText] = useState(false);
  const typingCorrection = useMemo(() => getTypingCorrection(value), [value]);

  const applyTypingCorrection = useCallback(() => {
    if (!typingCorrection) return;
    setValue((current) => {
      const match = current.match(/([\s\S]*?)([A-Za-z']{2,})$/);
      if (!match) return current;
      return `${match[1]}${typingCorrection.correction}`;
    });
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      adjustHeight();
    });
  }, [adjustHeight, textareaRef, typingCorrection]);

  const handleDocumentRewriteRequest = useCallback(
    (request: DocumentRewriteRequest) => {
      pendingDocumentRewriteRef.current = request;
      setIsRephrasingMode(true);
      setRewritePhase("ready");
      setActiveWorkspaceTab("chat");
      setSelectedCommand(null);
      setShowCommandPalette(false);
      setIsInputExpanded(true);
      setIsFadingInText(true);
      setValue("");
      setActiveSkeletonText(
        request.mode === "fix"
          ? "[keep the same meaning, make it clean]"
          : "[make it clearer, shorter, warmer...]",
      );
      window.setTimeout(() => {
        textareaRef.current?.focus();
        textareaRef.current?.setSelectionRange(
          textareaRef.current.value.length,
          textareaRef.current.value.length,
        );
        adjustHeight();
        setIsFadingInText(false);
      }, 140);
    },
    [adjustHeight, textareaRef],
  );

  const getRecentVibeProjects = useMemo(() => {
    return filteredProjectChats.slice(0, 3).map((chat) => ({
      id: chat.id,
      title: chat.title,
      updatedAt: chat.updatedAt,
      isRunning: chat.vibeRunning,
    }));
  }, [filteredProjectChats]);

  const applyQuickPrompt = (prompt: string, skeleton?: string) => {
    setActiveWorkspaceTab("chat");
    setSelectedCommand(null);
    setIsInputExpanded(true);

    setIsFadingInText(true);
    setValue(prompt);
    if (skeleton) {
      setActiveSkeletonText(skeleton);
    } else {
      setActiveSkeletonText(null);
    }

    window.setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(prompt.length, prompt.length);
      adjustHeight();
      setIsFadingInText(false);
    }, 150);
  };

  useEffect(() => {
    if (value.trim().length === 0 && !isVibeWorkspace) {
      setIsInputExpanded(false);
      setActiveSkeletonText(null);
    }
  }, [value, isVibeWorkspace]);

  const applyVibePrompt = (prompt: string) => {
    setActiveWorkspaceTab("vibe");
    setSelectedCommand(null);
    setValue(prompt);
    setIsInputExpanded(false);
    window.setTimeout(() => {
      textareaRef.current?.focus();
      adjustHeight(true);
    }, 30);
  };

  const handleWorkspaceTabChange = (tabId: WorkspaceTabId) => {
    if (tabId === activeWorkspaceTab) return;
    const currentIsVibeChat = messages.some(
      (message) => message.assistantKind === "vibe",
    );
    const fromIndex = WORKSPACE_TAB_ORDER.indexOf(activeWorkspaceTab);
    const toIndex = WORKSPACE_TAB_ORDER.indexOf(tabId);
    setWorkspaceTransitionDirection(toIndex > fromIndex ? 1 : -1);
    setIsWorkspaceSwitching(true);
    if (workspaceSwitchTimeoutRef.current != null) {
      window.clearTimeout(workspaceSwitchTimeoutRef.current);
    }
    workspaceSwitchTimeoutRef.current = window.setTimeout(() => {
      setIsWorkspaceSwitching(false);
      workspaceSwitchTimeoutRef.current = null;
    }, 620);
    setActiveWorkspaceTab(tabId);
    setSelectedCommand(null);
    setShowCommandPalette(false);
    setClipInitialUrl("");
    if (tabId !== "chat") {
      setIsSidebarOpen(false);
    }
    setIsInputExpanded(false);
    adjustHeight(true);

    if (tabId === "vibe" && !currentIsVibeChat) {
      setMessages([]);
      setCurrentChatId(null);
    } else if (tabId === "chat" && currentIsVibeChat) {
      setMessages([]);
      setCurrentChatId(null);
      setVibePreviewMessageId(null);
      setVibePreviewFiles(null);
    }

    if (tabId === "browser") {
      setValue("");
      adjustHeight(true);
      return;
    }

    window.setTimeout(() => {
      textareaRef.current?.focus();
      adjustHeight();
    }, 50);
  };

  return (
    <FullscreenContext.Provider value={{ isFullscreen, setIsFullscreen }}>
      {theme === "Dark" && (
        <style
          dangerouslySetInnerHTML={{
            __html: `
                html { filter: invert(1) hue-rotate(180deg); background: #fff; }
                img, video, iframe, [data-invert-ignore] { filter: invert(1) hue-rotate(-180deg); }
                html:not([data-invert-ignore]) pre, html:not([data-invert-ignore]) code { filter: invert(1) hue-rotate(-180deg); }
                [data-invert-ignore] pre, [data-invert-ignore] code { filter: none !important; }
                .border-slate-200\\/60 { border-color: rgba(226, 232, 240, 0.4); }
                body { background: #fff; }
                /* Make grey text more visible (white) in dark mode */
                .text-slate-400, .text-slate-500, .text-slate-600 { color: #000 !important; }
                /* Remove all glow effects (inverted shadows) in dark mode except for AI orb */
                *:not(.clyra-ai-orb-shell):not(.clyra-ai-orb-shell *):not(.clyra-ai-orb):not(.clyra-ai-orb *) {
                    box-shadow: none !important;
                }
            `,
          }}
        />
      )}
      <motion.div
        className="clyra-app-shell h-dvh flex min-w-0 bg-white text-slate-900 font-sans selection:bg-slate-200 overflow-hidden scalable-container relative"
        initial={{ opacity: 0, scale: 0.97, filter: "blur(12px)", y: 12 }}
        animate={{ opacity: 1, scale: 1, filter: "blur(0px)", y: 0 }}
        transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1], delay: 0.05 }}
      >
        {showSidebarControls && (
        <motion.aside
          aria-hidden={!isSidebarOpen}
          initial={false}
          animate={
            introState !== "complete"
              ? {
                  x: 0,
                  y: 18,
                  scale: 1,
                  opacity: 0,
                  filter: "blur(0px)",
                }
              : isSidebarOpen
                ? {
                    x: 0,
                    y: 0,
                    scale: 1,
                    opacity: 1,
                    filter: "blur(0px)",
                  }
                : {
                    x: -292,
                    y: 0,
                    scale: 1,
                    opacity: 1,
                    filter: "blur(0px)",
                  }
          }
          transition={{
            type: "tween",
            duration: isSidebarOpen ? 0.58 : 0.34,
            ease: isSidebarOpen ? [0.18, 1, 0.25, 1] : [0.22, 1, 0.36, 1],
            opacity: { duration: isSidebarOpen ? 0.58 : 0 },
            filter: { duration: 0 },
            scale: { duration: 0 },
          }}
          className={cn(
            "clyra-sidebar-rail fixed inset-y-0 left-0 z-[120] flex w-[272px] shrink-0 flex-col overflow-hidden px-3 py-4 sm:px-3.5 sm:py-5",
            !isSidebarOpen && "clyra-sidebar-rail--closed pointer-events-none",
          )}
          style={{
            transformOrigin: "left center",
            willChange: "transform",
          }}
        >
          <div className="clyra-sidebar-panel w-[244px] h-full min-h-0 flex flex-col shrink-0">
            <div className="clyra-sidebar-section px-3 pb-2 pt-3 flex flex-col gap-1.5 shrink-0">
              <div className="flex items-center justify-between h-9 -mt-0.5 -mb-0.5 pl-1 -mr-1">
                <div className="flex items-center gap-2 text-[13px] font-semibold tracking-tight text-slate-700">
                  <span className="h-2 w-2 rounded-full bg-slate-900 shadow-[0_0_14px_rgba(15,23,42,0.18)]" />
                  Clyra
                </div>
                {isSidebarOpen && (
                  <button
                    type="button"
                    onPointerDown={() => setIsSidebarOpen(false)}
                    onClick={() => setIsSidebarOpen(false)}
                    aria-label="Close sidebar"
                    title="Close sidebar"
                    className="clyra-sidebar-close group relative flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition-[color,transform] duration-300 hover:scale-[1.04] hover:text-slate-900 active:scale-[0.94]"
                  >
                    <X className="pointer-events-none relative w-[15px] h-[15px] stroke-[2.2]" />
                  </button>
                )}
              </div>
              <div className="px-1 flex flex-col gap-1">
                <button
                  onClick={() => {
                    setMessages([]);
                    setCurrentChatId(null);
                    setSelectedCommand(null);
                    setActiveWorkspaceTab("chat");
                    setClipInitialUrl("");
                    setVibePreviewMessageId(null);
                    setVibePreviewFiles(null);
                    setIsSidebarOpen(false);
                    setSearchQuery("");
                  }}
                  className="clyra-sidebar-action w-full flex items-center gap-3 px-2 py-2 rounded-lg text-slate-700 transition-colors font-medium text-[13.5px]"
                >
                  <SquarePen className="w-4 h-4 stroke-[2]" />
                  New chat
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowClipsLibrary(true);
                  }}
                  className="clyra-sidebar-action w-full flex items-center gap-3 px-2 py-2 mb-0.5 rounded-lg text-slate-700 transition-colors font-medium text-[13.5px]"
                >
                  <Scissors className="w-4 h-4 stroke-[2]" />
                  <span className="flex-1 text-left">Clips</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsProjectsOpen((open) => !open)}
                  className="clyra-sidebar-action w-full flex items-center gap-3 px-2 py-2 rounded-lg text-slate-700 transition-colors font-medium text-[13.5px]"
                >
                  <Folder className="w-4 h-4 stroke-[2]" />
                  <span className="flex-1 text-left">Projects</span>
                  {filteredProjectChats.some(
                    (chat) => chat.vibeRunning || chat.vibeUnread,
                  ) ? (
                    <span
                      className={cn(
                        "h-2 w-2 rounded-full",
                        filteredProjectChats.some((chat) => chat.vibeRunning)
                          ? "animate-pulse bg-black"
                          : "bg-blue-500",
                      )}
                    />
                  ) : null}
                  <ChevronRight
                    className={cn(
                      "h-3.5 w-3.5 text-slate-400 transition-transform",
                      isProjectsOpen && "rotate-90",
                    )}
                  />
                </button>
                <AnimatePresence initial={false}>
                  {isProjectsOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{
                        type: "spring",
                        stiffness: 220,
                        damping: 34,
                        mass: 0.9,
                      }}
                      className="overflow-hidden pl-3"
                    >
                      <div className="mt-0.5 flex flex-col gap-0.5 pl-2">
                        {filteredProjectChats.length > 0 ? (
                          filteredProjectChats.slice(0, 8).map((chat) => (
                            <div
                              key={`project-${chat.id}`}
                              className={cn(
                                "group relative flex w-full items-center gap-1 rounded-lg px-1.5 py-1 text-[12.5px] font-medium transition-colors",
                                currentChatId === chat.id
                                  ? "clyra-sidebar-action--active text-slate-900"
                                  : "clyra-sidebar-action text-slate-500 hover:text-slate-800",
                              )}
                            >
                              {editingChatId === chat.id ? (
                                <input
                                  type="text"
                                  value={editingTitle}
                                  onChange={(e) =>
                                    setEditingTitle(e.target.value)
                                  }
                                  className="clyra-sidebar-input min-w-0 flex-1 rounded-md px-2 py-1 text-[12.5px] font-medium text-slate-800 outline-none"
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      setChats((prev) =>
                                        prev.map((c) =>
                                          c.id === chat.id
                                            ? {
                                                ...c,
                                                title: editingTitle || c.title,
                                              }
                                            : c,
                                        ),
                                      );
                                      setEditingChatId(null);
                                    } else if (e.key === "Escape") {
                                      setEditingChatId(null);
                                    }
                                  }}
                                  onBlur={() => {
                                    setChats((prev) =>
                                      prev.map((c) =>
                                        c.id === chat.id
                                          ? {
                                              ...c,
                                              title: editingTitle || c.title,
                                            }
                                          : c,
                                      ),
                                    );
                                    setEditingChatId(null);
                                  }}
                                />
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => openChatSession(chat)}
                                    className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-0.5 py-1 text-left"
                                  >
                                    <span
                                      className={cn(
                                        "clyra-sidebar-project-dot h-1.5 w-1.5 shrink-0 rounded-full",
                                        (currentChatId === chat.id ||
                                          chat.vibeRunning ||
                                          chat.vibeUnread) &&
                                          "clyra-sidebar-project-dot--visible",
                                        chat.vibeRunning
                                          ? "animate-pulse bg-black"
                                          : chat.vibeUnread
                                            ? "bg-blue-500"
                                            : "bg-slate-300",
                                      )}
                                    />
                                    <span className="min-w-0 flex-1 truncate">
                                      {chat.title}
                                    </span>
                                  </button>
                                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setEditingChatId(chat.id);
                                        setEditingTitle(chat.title);
                                      }}
                                      className="rounded-md p-1 text-slate-400 hover:bg-white/70 hover:text-slate-800"
                                      aria-label={`Rename ${chat.title}`}
                                      title="Rename project"
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setChats((prev) =>
                                          prev.filter((c) => c.id !== chat.id),
                                        );
                                        if (currentChatId === chat.id) {
                                          setCurrentChatId(null);
                                          setMessages([]);
                                          setVibePreviewMessageId(null);
                                          setVibePreviewFiles(null);
                                        }
                                      }}
                                      className="rounded-md p-1 text-slate-400 hover:bg-white/70 hover:text-red-500"
                                      aria-label={`Delete ${chat.title}`}
                                      title="Delete project"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          ))
                        ) : (
                          <div className="px-2 py-1.5 text-[12px] font-medium text-slate-400">
                            No Vibe projects yet
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <button
                  type="button"
                  onClick={() => setIsSearchModalOpen(true)}
                  className="clyra-sidebar-action w-full flex items-center gap-3 px-2 py-2 mt-1.5 rounded-lg text-slate-700 transition-colors font-medium text-[13.5px]"
                >
                  <Search className="w-4 h-4 stroke-[2]" />
                  <span className="flex-1 text-left">Search</span>
                  <kbd className="text-[11px] text-slate-400 font-medium bg-slate-100 px-1.5 py-0.5 rounded-md">
                    ⌘F
                  </kbd>
                </button>
              </div>
            </div>

            <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto flex flex-col p-2 space-y-3">
              {filteredStandardChats.length > 0 ? (
                <div className="flex flex-col gap-0.5">
                  <AnimatePresence mode="popLayout">
                    {filteredStandardChats.map((chat) => {
                      const matchedMessage = searchQuery
                        ? chat.messages.find((m) =>
                            m.content
                              .toLowerCase()
                              .includes(searchQuery.toLowerCase()),
                          )
                        : null;
                      const isTitleMatch = searchQuery
                        ? chat.title
                            .toLowerCase()
                            .includes(searchQuery.toLowerCase())
                        : false;

                      return (
                        <motion.div
                          layout="position"
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{
                            opacity: 0,
                            y: -20,
                            height: 0,
                            filter: "blur(4px)",
                          }}
                          transition={{
                            duration: 0.25,
                            type: "spring",
                            bounce: 0,
                            mass: 0.8,
                          }}
                          key={chat.id}
                          className={cn(
                            "group relative w-full px-3 py-2 rounded-[12px] transition-[background-color,color,box-shadow] cursor-pointer flex flex-col justify-center",
                            currentChatId === chat.id
                              ? "clyra-sidebar-action--active text-[#0f0f0f]"
                              : "clyra-sidebar-action text-slate-600 hover:text-[#0f0f0f]",
                          )}
                          onClick={() => {
                            if (editingChatId === chat.id) return;
                            openChatSession(chat);
                          }}
                        >
                          {editingChatId === chat.id ? (
                            <div className="flex w-full items-center gap-2">
                              <input
                                type="text"
                                value={editingTitle}
                                onChange={(e) =>
                                  setEditingTitle(e.target.value)
                                }
                                className="clyra-sidebar-input flex-1 outline-none rounded-md px-2 py-0.5 text-[13.5px] font-medium"
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    setChats((prev) =>
                                      prev.map((c) =>
                                        c.id === chat.id
                                          ? {
                                              ...c,
                                              title: editingTitle || c.title,
                                            }
                                          : c,
                                      ),
                                    );
                                    setEditingChatId(null);
                                  } else if (e.key === "Escape") {
                                    setEditingChatId(null);
                                  }
                                }}
                                onBlur={() => {
                                  setChats((prev) =>
                                    prev.map((c) =>
                                      c.id === chat.id
                                        ? {
                                            ...c,
                                            title: editingTitle || c.title,
                                          }
                                        : c,
                                    ),
                                  );
                                  setEditingChatId(null);
                                }}
                              />
                            </div>
                          ) : (
                            <>
                              <div className="flex items-center w-full">
                                <span className="flex-1 text-[13.5px] truncate font-medium pr-10">
                                  <HighlightText
                                    text={chat.title}
                                    highlight={searchQuery}
                                  />
                                </span>
                                <div className="absolute right-1 opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity pl-2">
                                  <div className="absolute inset-0 bg-gradient-to-r from-transparent to-white/45 -left-6 w-6 pointer-events-none" />
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditingChatId(chat.id);
                                      setEditingTitle(chat.title);
                                    }}
                                    className="p-1.5 text-slate-400 hover:text-[#0f0f0f] transition-colors"
                                  >
                                    <Pencil className="w-3.5 h-3.5 stroke-[2]" />
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setChats((prev) =>
                                        prev.filter((c) => c.id !== chat.id),
                                      );
                                      if (currentChatId === chat.id) {
                                        setCurrentChatId(null);
                                        setMessages([]);
                                      }
                                    }}
                                    className="p-1.5 text-slate-400 hover:text-red-500 transition-colors"
                                  >
                                    <Trash2 className="w-3.5 h-3.5 stroke-[2]" />
                                  </button>
                                </div>
                              </div>
                              {searchQuery &&
                                !isTitleMatch &&
                                matchedMessage && (
                                  <div className="text-[11.5px] text-slate-400 truncate mt-0.5 pr-2 w-full">
                                    {matchedMessage.role === "user"
                                      ? "You: "
                                      : "AI: "}
                                    <HighlightText
                                      text={matchedMessage.content}
                                      highlight={searchQuery}
                                    />
                                  </div>
                                )}
                            </>
                          )}
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              ) : (
                <div className="p-5 text-center text-sm text-slate-400 font-medium">
                  {searchQuery ? "No chats found" : "No chats yet"}
                </div>
              )}
            </div>

            <button
              onClick={() => setIsSettingsOpen(true)}
              className="clyra-sidebar-footer mx-2 mb-2 flex shrink-0 cursor-pointer items-center gap-2.5 rounded-2xl px-3 py-2.5 text-left transition-all duration-300 group"
            >
              <div className="flex items-center justify-center p-1 rounded-full bg-transparent text-slate-400 group-hover:text-slate-600 transition-colors">
                <Settings className="w-[18px] h-[18px] transition-transform duration-500 ease-out group-hover:rotate-90" />
              </div>
              <span className="flex-1 font-medium text-slate-500 group-hover:text-slate-700 transition-colors text-sm">
                Settings
              </span>
            </button>
          </div>
        </motion.aside>
        )}

        <div className="clyra-main-surface relative z-10 flex min-h-0 min-w-0 flex-1 flex-col bg-white sm:border-transparent">
          <AnimatePresence>
            {showSidebarControls && !isSidebarOpen && (
              <motion.button
                type="button"
                onClick={() => setIsSidebarOpen(true)}
                aria-label="Open sidebar"
                aria-expanded={false}
                title="Open sidebar"
                initial={
                  introState !== "complete"
                    ? { opacity: 0, scale: 0.96, y: 14 }
                    : { opacity: 0, scale: 0.9, y: -8 }
                }
                animate={{
                  opacity: introState === "complete" ? 1 : 0,
                  scale: 1,
                  y: introState === "complete" ? 0 : 14,
                }}
                exit={{ opacity: 0, scale: 0.9, y: -8 }}
                transition={
                  introState !== "complete"
                    ? { duration: 0.7, ease: [0.16, 1, 0.3, 1] }
                    : { duration: 0.24, ease: [0.22, 1, 0.36, 1] }
                }
                className="clyra-sidebar-toggle group fixed left-4 top-4 z-[180] flex h-11 w-11 items-center justify-center rounded-full border border-transparent bg-transparent text-slate-600 shadow-none transition-[color,transform] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] hover:scale-[1.05] hover:text-slate-900 active:scale-[0.94] sm:top-6 sm:left-6"
              >
                <span className="pointer-events-none relative block h-[12px] w-[18px] opacity-95">
                  <span className="pointer-events-none absolute left-0 top-0 h-[2px] w-full rounded-full bg-current" />
                  <span className="pointer-events-none absolute left-0 top-[5px] h-[2px] w-full rounded-full bg-current" />
                  <span className="pointer-events-none absolute left-0 top-[10px] h-[2px] w-full rounded-full bg-current" />
                </span>
              </motion.button>
            )}
          </AnimatePresence>
          <div className="relative z-[90] h-[52px] w-full shrink-0">
            <motion.div
              className="absolute left-1/2 top-5 sm:top-6 -translate-x-1/2 z-50"
              initial={introState !== "complete" ? { y: -50 } : false}
              animate={{ y: introState === "complete" ? 0 : -50 }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            >
              <div
                className={cn(
                  "clyra-workflow-tabs relative transition-opacity duration-700",
                  introState === "complete" ? "opacity-100" : "opacity-0",
                  theme === "Dark" && "dark-tabs",
                )}
                role="tablist"
                aria-label="Clyra workspace"
                data-invert-ignore="true"
                onPointerMove={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  containerMouseX.set(e.clientX - rect.left);
                }}
                onMouseLeave={() => setHoveredWorkspaceTab(null)}
                onBlur={(event) => {
                  if (
                    !event.currentTarget.contains(
                      event.relatedTarget as Node | null,
                    )
                  ) {
                    setHoveredWorkspaceTab(null);
                  }
                }}
              >
                <AnimatePresence>
                  {hoveredWorkspaceTab && (
                    <motion.div
                      className="clyra-workflow-tab__hover absolute pointer-events-none"
                      initial={{ opacity: 0, scale: 0.85 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{
                        opacity: 0,
                        scale: 0.95,
                        transition: { duration: 0.15 },
                      }}
                      style={{
                        x: hoverPillX,
                        width: 101,
                        top: 6,
                        bottom: 6,
                        height: "auto",
                        translate: "none",
                        scaleX: hoverScaleX,
                        transformOrigin: hoverOrigin as any,
                      }}
                      transition={{
                        type: "spring",
                        stiffness: 400,
                        damping: 30,
                      }}
                    />
                  )}
                </AnimatePresence>
                {workflowTabs.map((tabItem) => {
                  const Icon = tabItem.icon;
                  const isActive = activeWorkspaceTab === tabItem.id;
                  const isHovered = hoveredWorkspaceTab === tabItem.id;

                  return (
                    <button
                      key={tabItem.id}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      onPointerDown={(event) => {
                        event.preventDefault();
                        handleWorkspaceTabChange(tabItem.id);
                      }}
                      onClick={() => handleWorkspaceTabChange(tabItem.id)}
                      onMouseEnter={() => setHoveredWorkspaceTab(tabItem.id)}
                      onFocus={() => setHoveredWorkspaceTab(tabItem.id)}
                      className={cn(
                        "clyra-workflow-tab w-[105px] justify-center",
                        isActive && "clyra-workflow-tab--active",
                      )}
                    >
                      <Icon className="relative h-4 w-4 shrink-0" />
                      <span className="relative truncate">{tabItem.label}</span>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          </div>
          <AnimatePresence></AnimatePresence>
          <motion.div
            className="clyra-screen-stage relative flex min-h-0 min-w-0 flex-1 flex-col"
            animate={{ x: sidebarAvoidShift }}
            transition={{
              type: "spring",
              stiffness: 220,
              damping: 34,
              mass: 0.9,
            }}
            style={{
              willChange: "transform",
            }}
          >
            <div
              className={cn(
                "grid min-h-0 w-full flex-1 overflow-hidden",
                "transition-[grid-template-columns] duration-[720ms] ease-[cubic-bezier(0.32,0.72,0,1)]",
                keepWorkspacePreviewLayout
                  ? "grid-cols-[minmax(260px,min(420px,34vw))_minmax(0,1fr)]"
                  : "grid-cols-[minmax(0,1fr)_0fr]",
              )}
            >
              <div
                className={cn(
                  "clyra-workspace-scene relative z-10 flex min-h-0 min-w-0 flex-col overflow-hidden",
                  keepWorkspacePreviewLayout && "border-r border-slate-200/70",
                )}
              >
                {bgAnimEnabled && (
                  <div className="pointer-events-none absolute inset-[-20%] z-0 overflow-hidden clyra-fluid-bg-container">
                    <div
                      className="clyra-fluid-blob clyra-fluid-blob-1"
                      style={{ backgroundColor: bgAnimColor }}
                    />
                    <div
                      className="clyra-fluid-blob clyra-fluid-blob-2"
                      style={{ backgroundColor: bgAnimColor }}
                    />
                    <div
                      className="clyra-fluid-blob clyra-fluid-blob-3"
                      style={{ backgroundColor: bgAnimColor }}
                    />
                  </div>
                )}
                <AnimatePresence>
                  {isWorkspaceSwitching && (
                    <motion.div
                      aria-hidden="true"
                      className="clyra-workspace-swipe-shadow"
                      initial={{
                        opacity: 0,
                        x: workspaceTransitionDirection * 54,
                        scaleX: 0.9,
                      }}
                      animate={{
                        opacity: [0, 0.26, 0],
                        x: [
                          workspaceTransitionDirection * 36,
                          0,
                          workspaceTransitionDirection * -28,
                        ],
                        scaleX: [0.94, 1.02, 0.98],
                      }}
                      exit={{ opacity: 0 }}
                      transition={{
                        duration: 0.58,
                        ease: workspaceSwipeEase,
                        times: [0, 0.52, 1],
                      }}
                    />
                  )}
                </AnimatePresence>
                <div
                  className={cn(
                    "relative z-10 flex flex-col h-full min-h-0 w-full",
                  )}
                >
                  <AnimatePresence
                    initial={false}
                    custom={workspaceTransitionDirection}
                  >
                    <motion.div
                      key={workspaceViewKey}
                      custom={workspaceTransitionDirection}
                      variants={workspacePanelVariants}
                      layout={false}
                      className={cn(
                        "clyra-workspace-card absolute inset-0 flex flex-col transform-gpu",
                        messages.length === 0 &&
                          !isClipWorkspace &&
                          "justify-center",
                      )}
                      initial="enter"
                      animate="center"
                      exit="exit"
                      transition={workspaceSwipeTransition}
                      style={{
                        backfaceVisibility: "hidden",
                        willChange: "transform",
                      }}
                    >
                      {isVibeWorkspace ? (
                        <VibeCoderWorkspace orbColorTheme={orbColorTheme} />
                      ) : isClipWorkspace ? (
                        <AIClipper
                          embedded
                          initialUrl={clipInitialUrl}
                          onClose={() => {
                            setSelectedCommand(null);
                            setClipInitialUrl("");
                            setActiveWorkspaceTab("chat");
                          }}
                        />
                      ) : messages.length === 0 ? (
                        <motion.div
                          initial={
                            isWorkspaceSwitching
                              ? false
                              : {
                                  opacity: 0,
                                  y: 32,
                                  scale: 0.982,
                                }
                          }
                          animate={{
                            opacity: 1,
                            y: 0,
                            scale: 1,
                          }}
                          transition={{
                            duration: 0.82,
                            ease: [0.18, 1, 0.25, 1],
                          }}
                          className={cn(
                            "text-center space-y-3 mb-7 flex flex-col items-center max-w-3xl mx-auto w-full",
                            showWorkspaceLivePreview
                              ? "px-3 sm:px-4"
                              : "px-5 sm:px-8",
                          )}
                        >
                          <motion.div
                            className="mb-2 flex w-full justify-center relative transform-gpu"
                            initial={
                              isWorkspaceSwitching
                                ? false
                                : introState !== "complete"
                                  ? { y: 44, opacity: 0 }
                                  : false
                            }
                            animate={
                              introState !== "booting"
                                ? { y: 0, opacity: 1 }
                                : { y: 44, opacity: 0 }
                            }
                            transition={{
                              type: "tween",
                              ease: [0.12, 0.78, 0.18, 1],
                              duration: 1.26,
                            }}
                          >
                            <AiOrb
                              colorTheme={orbColorTheme}
                              introActive={introState !== "complete"}
                            />
                          </motion.div>
                          <motion.h1
                            className="text-3xl sm:text-4xl font-semibold tracking-tight text-slate-800"
                            animate={{
                              opacity: introState === "complete" ? 1 : 0,
                              y: introState === "complete" ? 0 : 18,
                              scale: introState === "complete" ? 1 : 0.96,
                            }}
                            transition={{
                              duration: 0.74,
                              ease: [0.18, 1, 0.28, 1],
                            }}
                          >
                            {emptyStateTitle}
                          </motion.h1>
                          <motion.div className="flex flex-col items-center">
                            <motion.p
                              className="text-slate-500 text-sm sm:text-base font-medium font-sans z-10 relative"
                              animate={{
                                opacity: introState === "complete" ? 1 : 0,
                                y: introState === "complete" ? 0 : 14,
                              }}
                              transition={{
                                duration: 0.72,
                                ease: [0.18, 1, 0.28, 1],
                              }}
                            >
                              {emptyStateSubtitle}
                            </motion.p>

                            {!isVibeWorkspace && (
                              <motion.div
                                className="clyra-chat-quick-actions mt-4"
                                initial="hidden"
                                animate="visible"
                                variants={{
                                  hidden: { opacity: 0 },
                                  visible: {
                                    opacity: 1,
                                    transition: {
                                      staggerChildren: 0.12,
                                      delayChildren: 0.2,
                                    },
                                  },
                                }}
                              >
                                {chatQuickActions.map((action) => {
                                  const QuickIcon = action.icon;

                                  return (
                                    <motion.button
                                      variants={{
                                        hidden: { opacity: 0, y: 20 },
                                        visible: {
                                          opacity:
                                            introState === "complete" ? 1 : 0,
                                          y: introState === "complete" ? 0 : 20,
                                          transition: {
                                            duration: 0.7,
                                            ease: [0.16, 1, 0.3, 1],
                                          },
                                        },
                                      }}
                                      key={action.baseLabel}
                                      type="button"
                                      className="clyra-chat-chip group"
                                      onClick={() =>
                                        applyQuickPrompt(
                                          action.prompt,
                                          action.skeletonLabel,
                                        )
                                      }
                                    >
                                      <QuickIcon className="h-3.5 w-3.5" />
                                      <span>{action.baseLabel}</span>
                                    </motion.button>
                                  );
                                })}
                              </motion.div>
                            )}
                          </motion.div>
                        </motion.div>
                      ) : (
                        <div
                          className={cn(
                            "relative flex min-h-0 flex-1 w-full overflow-hidden z-0 max-w-3xl mx-auto",
                            showWorkspaceLivePreview
                              ? "px-3 sm:px-4 pt-6 sm:pt-8"
                              : "px-5 sm:px-8 pt-8 sm:pt-10",
                          )}
                        >
                          <div
                            className={cn(
                              "clyra-visible-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden transition-opacity duration-700",
                              introState === "complete"
                                ? "opacity-100"
                                : "opacity-0",
                            )}
                            id="chat-container"
                          >
                            {messages.map((message) => {
                              const fontClass =
                                fontSize === "Small"
                                  ? "text-[14px] leading-relaxed"
                                  : fontSize === "Large"
                                    ? "text-[18px] leading-loose"
                                    : "text-[15px] sm:text-[16px] leading-relaxed";
                              const isLastAssistant =
                                message.role === "assistant" &&
                                lastAssistantId != null &&
                                message.id === lastAssistantId;
                              return (
                                <motion.div
                                  key={message.id}
                                  initial={
                                    isWorkspaceSwitching
                                      ? false
                                      : {
                                          opacity: 0,
                                          y: message.role === "user" ? 8 : 6,
                                          scale: 0.995,
                                        }
                                  }
                                  animate={{ opacity: 1, y: 0, scale: 1 }}
                                  transition={{
                                    type: "tween",
                                    ease: [0.25, 0.46, 0.45, 0.94],
                                    duration: message.role === "user" ? 0.42 : 0.38,
                                  }}
                                  className={cn(
                                    "flex w-full",
                                    message.role === "user"
                                      ? "justify-end"
                                      : "justify-start",
                                  )}
                                >
                                  {message.role === "user" ? (
                                    <div
                                      data-invert-ignore="true"
                                      className={cn(
                                        "clyra-chat-user-bubble px-5 py-3.5 rounded-[24px] max-w-[85%] sm:max-w-[75%] border border-slate-200/60 whitespace-pre-wrap",
                                        message.id === firstUserMessageId &&
                                          "clyra-chat-user-bubble--first",
                                        fontClass,
                                      )}
                                      style={{
                                        backgroundColor: userBubbleColor,
                                        color: "#1e293b",
                                      }}
                                    >
                                      <UserMessageText text={message.content} />
                                    </div>
                                  ) : (
                                    <div
                                      data-invert-ignore={
                                        theme === "Dark" ? "true" : undefined
                                      }
                                      className="px-1 py-1 w-full flex items-start gap-3"
                                      style={{
                                        color:
                                          theme === "Dark"
                                            ? "#e2e8f0"
                                            : "#1e293b",
                                      }}
                                    >
                                      <div
                                        className={cn(
                                          "clyra-assistant-message",
                                          message.assistantKind === "vibe" &&
                                            "clyra-assistant-message--vibe",
                                        )}
                                      >
                                        <AnimatedMessage
                                          messageId={message.id}
                                          content={message.content}
                                          isThinking={message.isThinking}
                                          isStreaming={message.isStreaming}
                                          isResearching={message.isResearching}
                                          researchSites={message.researchSites}
                                          reasoningContent={
                                            message.reasoningContent
                                          }
                                          vibeUserPrompt={
                                            message.vibeUserPrompt
                                          }
                                          fontSizeClass={fontClass}
                                          markdownSupport={markdownSupport}
                                          codeHighlighting={codeHighlighting}
                                          assistantKind={
                                            message.assistantKind === "vibe"
                                              ? "vibe"
                                              : "chat"
                                          }
                                          isLastAssistant={isLastAssistant}
                                          onVibePreviewReady={
                                            handleVibePreviewReady
                                          }
                                          onDocumentRewriteRequest={(request) =>
                                            handleDocumentRewriteRequest(
                                              request,
                                            )
                                          }
                                          onContentChange={handleDocumentChange}
                                        />
                                      </div>
                                    </div>
                                  )}
                                </motion.div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      <AnimatePresence initial={false}>
                        {!isFullscreen && !isClipWorkspace && !isVibeWorkspace && (
                          <motion.div
                            key="composer"
                            ref={inputContainerRef}
                            onClick={() => {
                              if (!isInputExpanded && isVibeWorkspace) {
                                setIsInputExpanded(true);
                              }
                            }}
                            initial={false}
                            animate={{
                              opacity: 1,
                              x: 0,
                              y: 0,
                              scale: 1,
                            }}
                            exit={{
                              opacity: 1,
                              y: 0,
                              scale: 1,
                              pointerEvents: "none",
                            }}
                            transition={{
                              type: "tween",
                              duration: 0,
                              ease: [0.22, 1, 0.36, 1],
                            }}
                            style={{
                              transformStyle: "preserve-3d",
                              backfaceVisibility: "hidden",
                            }}
                            className={cn(
                              "clyra-composer-transition w-full shrink-0 relative z-20 transition-all duration-300 max-w-3xl mx-auto",
                              showWorkspaceLivePreview
                                ? "px-3 sm:px-4"
                                : "px-5 sm:px-8",
                              messages.length === 0
                                ? "pb-0 mb-8"
                                : "pb-4 sm:pb-6 mb-3",
                            )}
                          >
                            <AnimatePresence>
                              {isTemporaryChat && (
                                <motion.div
                                  initial={{
                                    opacity: 0,
                                    scale: 0.9,
                                    y: 15,
                                    filter: "blur(4px)",
                                  }}
                                  animate={{
                                    opacity: 1,
                                    scale: 1,
                                    y: 0,
                                    filter: "blur(0px)",
                                  }}
                                  exit={{
                                    opacity: 0,
                                    scale: 0.9,
                                    y: 15,
                                    filter: "blur(4px)",
                                  }}
                                  transition={{
                                    type: "spring",
                                    stiffness: 220,
                                    damping: 20,
                                    mass: 1,
                                  }}
                                  className="absolute bottom-[calc(100%+16px)] left-1/2 -translate-x-1/2 z-10 pointer-events-none"
                                >
                                  <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-100/90 text-slate-600 font-medium text-xs backdrop-blur-md border border-slate-200/60 shadow-sm">
                                    <MessageCircleDashed className="w-3.5 h-3.5 stroke-[2.2]" />
                                    Temporary Chat Enabled
                                  </span>
                                </motion.div>
                              )}
                            </AnimatePresence>
                            <motion.div
                              className={cn(
                                "input-wrapper relative backdrop-blur-xl border transition-[background-color,border-color,padding,box-shadow] duration-300 cursor-text overflow-visible mx-auto z-[3]",
                                isVibeWorkspace && "clyra-vibe-composer",
                                theme === "Dark"
                                  ? "bg-slate-200/90 border-slate-400/50"
                                  : "bg-white/80 border-slate-200/60",
                                isExpanded ? "p-2 sm:p-3" : "p-1.5 sm:p-2",
                              )}
                              initial={
                                isWorkspaceSwitching
                                  ? false
                                  : introState !== "complete"
                                    ? {
                                        width: 48,
                                        height: 48,
                                        borderRadius: 24,
                                        opacity: 0,
                                        y: 20,
                                      }
                                    : false
                              }
                              animate={{
                                width:
                                  introState === "booting" ||
                                  introState === "orb_up" ||
                                  introState === "input_circle"
                                    ? 48
                                    : "100%",
                                height:
                                  introState === "booting" ||
                                  introState === "orb_up" ||
                                  introState === "input_circle"
                                    ? 48
                                    : "auto",
                                borderRadius:
                                  introState === "booting" ||
                                  introState === "orb_up" ||
                                  introState === "input_circle"
                                    ? 24
                                    : isExpanded
                                      ? 32
                                      : 40,
                                opacity:
                                  introState === "booting" ||
                                  introState === "orb_up"
                                    ? 0
                                    : 1,
                                y:
                                  introState === "booting" ||
                                  introState === "orb_up"
                                    ? 20
                                    : 0,
                              }}
                              transition={{
                                type: "tween",
                                ease: [0.22, 1, 0.36, 1],
                                duration: 0.8,
                              }}
                            >
                              <motion.div
                                className="relative z-10 w-full h-full"
                                initial={{ opacity: 0 }}
                                animate={{
                                  opacity:
                                    introState === "booting" ||
                                    introState === "orb_up" ||
                                    introState === "input_circle"
                                      ? 0
                                      : 1,
                                }}
                                transition={{ duration: 0.6, ease: "easeOut" }}
                              >
                                <AnimatePresence>
                                  {isRephrasingMode && (
                                    <motion.div
                                      initial={{
                                        opacity: 0,
                                        y: 15,
                                        scale: 0.94,
                                        filter: "blur(8px)",
                                      }}
                                      animate={{
                                        opacity: 1,
                                        y: 0,
                                        scale: 1,
                                        filter: "blur(0px)",
                                      }}
                                      exit={{
                                        opacity: 0,
                                        y: 10,
                                        scale: 0.94,
                                        filter: "blur(6px)",
                                      }}
                                      transition={{
                                        duration: 0.4,
                                        ease: [0.16, 1, 0.3, 1],
                                      }}
                                      className="clyra-rewrite-chip absolute bottom-[calc(100%+14px)] left-4 z-20 flex items-center gap-2.5 rounded-full border border-slate-200/60 bg-white/80 backdrop-blur-xl px-3.5 py-2 text-[12.5px] font-semibold text-slate-700 shadow-[0_8px_30px_rgba(15,23,42,0.12)] pointer-events-auto"
                                    >
                                      <span
                                        className={cn(
                                          "clyra-rewrite-chip-dot h-1.5 w-1.5 rounded-full",
                                          rewritePhase === "applying"
                                            ? "bg-blue-500 shadow-[0_0_0_4px_rgba(59,130,246,0.15)] animate-pulse"
                                            : "bg-slate-700 shadow-[0_0_0_4px_rgba(15,23,42,0.06)]",
                                        )}
                                      />
                                      {rewritePhase === "applying" ? (
                                        <ShiningText
                                          text="Rephrasing text"
                                          preset="thinkingChat"
                                        />
                                      ) : (
                                        <span className="bg-gradient-to-r from-slate-800 to-slate-500 bg-clip-text text-transparent tracking-tight">
                                          Rephrase highlighted text
                                        </span>
                                      )}
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          pendingDocumentRewriteRef.current =
                                            null;
                                          setIsRephrasingMode(false);
                                          setRewritePhase("ready");
                                          setValue("");
                                        }}
                                        className="ml-1 rounded-full p-1 text-slate-400 transition-all hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-200"
                                        aria-label="Cancel rephrasing"
                                      >
                                        <svg
                                          width="12"
                                          height="12"
                                          viewBox="0 0 24 24"
                                          fill="none"
                                          stroke="currentColor"
                                          strokeWidth="2.5"
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                        >
                                          <line
                                            x1="18"
                                            y1="6"
                                            x2="6"
                                            y2="18"
                                          ></line>
                                          <line
                                            x1="6"
                                            y1="6"
                                            x2="18"
                                            y2="18"
                                          ></line>
                                        </svg>
                                      </button>
                                    </motion.div>
                                  )}
                                </AnimatePresence>

                                <AnimatePresence>
                                  {commandPaletteEnabled &&
                                    showCommandPalette && (
                                      <motion.div
                                        ref={commandPaletteRef}
                                        className="absolute left-4 right-4 sm:left-6 sm:right-6 bottom-[calc(100%+8px)] max-h-[170px] overflow-y-auto bg-white rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.12)] border border-slate-100 z-50 scrollbar-none transform-gpu origin-bottom pb-1"
                                        initial={{ opacity: 0, y: 20 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: 20 }}
                                        transition={{
                                          duration: 0.25,
                                          ease: "easeOut",
                                        }}
                                      >
                                        <div className="py-2">
                                          <div className="px-3 pb-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                                            Commands
                                          </div>
                                          {filteredSuggestions.map(
                                            (suggestion, index) => {
                                              const originalIndex =
                                                commandSuggestions.findIndex(
                                                  (c) =>
                                                    c.prefix ===
                                                    suggestion.prefix,
                                                );
                                              return (
                                                <motion.div
                                                  key={suggestion.prefix}
                                                  className={cn(
                                                    "flex items-center gap-3 px-4 py-2.5 text-sm transition-colors cursor-pointer",
                                                    activeSuggestion === index
                                                      ? "bg-slate-100 text-slate-900"
                                                      : "text-slate-600 hover:bg-slate-50/50 hover:text-slate-900",
                                                  )}
                                                  onClick={() =>
                                                    selectCommandSuggestion(
                                                      originalIndex,
                                                    )
                                                  }
                                                  onMouseEnter={() =>
                                                    setActiveSuggestion(index)
                                                  }
                                                >
                                                  <div
                                                    className={cn(
                                                      "w-7 h-7 rounded-md flex items-center justify-center transition-colors shrink-0",
                                                      activeSuggestion === index
                                                        ? "bg-slate-50 shadow-[0_1px_3px_rgba(0,0,0,0.05)] border border-slate-200"
                                                        : "bg-slate-50/50 text-slate-500 border border-transparent",
                                                    )}
                                                  >
                                                    {suggestion.icon(
                                                      activeSuggestion ===
                                                        index,
                                                    )}
                                                  </div>
                                                  <div className="flex-1 flex flex-col items-start leading-snug truncate">
                                                    <span className="font-medium truncate w-full">
                                                      {commandQuery ? (
                                                        <>
                                                          {suggestion.label.substring(
                                                            0,
                                                            suggestion.label
                                                              .toLowerCase()
                                                              .indexOf(
                                                                commandQuery,
                                                              ),
                                                          )}
                                                          <span className="text-blue-500">
                                                            {suggestion.label.substring(
                                                              suggestion.label
                                                                .toLowerCase()
                                                                .indexOf(
                                                                  commandQuery,
                                                                ),
                                                              suggestion.label
                                                                .toLowerCase()
                                                                .indexOf(
                                                                  commandQuery,
                                                                ) +
                                                                commandQuery.length,
                                                            )}
                                                          </span>
                                                          {suggestion.label.substring(
                                                            suggestion.label
                                                              .toLowerCase()
                                                              .indexOf(
                                                                commandQuery,
                                                              ) +
                                                              commandQuery.length,
                                                          )}
                                                        </>
                                                      ) : (
                                                        suggestion.label
                                                      )}
                                                    </span>
                                                    <span className="text-slate-400 text-xs hidden sm:block truncate w-full">
                                                      {suggestion.description}
                                                    </span>
                                                  </div>
                                                </motion.div>
                                              );
                                            },
                                          )}
                                        </div>
                                      </motion.div>
                                    )}
                                </AnimatePresence>

                                <AnimatePresence>
                                  {typingCorrection && (
                                    <motion.div
                                      className="clyra-writing-suggestions"
                                      initial={{
                                        opacity: 0,
                                        y: 10,
                                        scale: 0.98,
                                      }}
                                      animate={{ opacity: 1, y: 0, scale: 1 }}
                                      exit={{ opacity: 0, y: 10, scale: 0.98 }}
                                      transition={{
                                        duration: 0.2,
                                        ease: [0.22, 1, 0.36, 1],
                                      }}
                                    >
                                      <span>Suggestion</span>
                                      <button
                                        type="button"
                                        onPointerDown={(event) => {
                                          event.preventDefault();
                                          applyTypingCorrection();
                                        }}
                                        onMouseDown={(event) => {
                                          event.preventDefault();
                                          applyTypingCorrection();
                                        }}
                                        onClick={applyTypingCorrection}
                                      >
                                        {typingCorrection.correction}
                                      </button>
                                    </motion.div>
                                  )}
                                </AnimatePresence>

                                <div
                                  className={cn(
                                    isExpanded
                                      ? "px-3 py-1"
                                      : "flex items-center gap-1 px-2 py-0.5",
                                  )}
                                >
                                  <input
                                    ref={fileInputRef}
                                    type="file"
                                    multiple
                                    className="hidden"
                                    onChange={handleFilesSelected}
                                  />
                                  {!isExpanded && (
                                    <motion.button
                                      type="button"
                                      onClick={handleAttachFile}
                                      whileHover={{ scale: 1.05 }}
                                      whileTap={{ scale: 0.95 }}
                                      className={cn(
                                        "p-2 text-slate-500 hover:text-slate-800 rounded-full transition-all duration-700 flex items-center justify-center shrink-0",
                                        introState === "complete"
                                          ? "opacity-100"
                                          : "opacity-0",
                                      )}
                                      aria-label="Attach files"
                                      title="Attach files"
                                    >
                                      <Paperclip className="w-4.5 h-4.5 sm:w-5 sm:h-5" />
                                    </motion.button>
                                  )}
                                  <Textarea
                                    ref={textareaRef}
                                    rows={1}
                                    value={value}
                                    highlightOverlay={
                                      isRephrasingMode ? "" : activeSkeletonText
                                    }
                                    onChange={(e) => {
                                      const nextValue = e.target.value;
                                      setValue(nextValue);
                                      if (
                                        !isVibeWorkspace &&
                                        !selectedCommand &&
                                        attachments.length === 0
                                      ) {
                                        setIsInputExpanded(
                                          nextValue.trim().length > 0,
                                        );
                                      }
                                      if (
                                        activeSkeletonText &&
                                        !nextValue.includes(
                                          activeSkeletonText,
                                        )
                                      ) {
                                        setActiveSkeletonText(null);
                                      }
                                      adjustHeight();
                                    }}
                                    onKeyDown={handleKeyDown}
                                    onFocus={() => {
                                      if (isVibeWorkspace) {
                                        setIsInputExpanded(true);
                                      }
                                      adjustHeight();
                                    }}
                                    spellCheck
                                    placeholder={
                                      isRephrasingMode
                                        ? "Tell Clyra how to change the highlighted text..."
                                        : inputPlaceholder
                                    }
                                    containerClassName="w-full"
                                    className={cn(
                                      "resize-none overflow-y-auto overflow-x-hidden bg-transparent outline-none disabled:opacity-50",
                                      "text-[15px] leading-relaxed sm:text-lg",
                                      theme === "Dark"
                                        ? "placeholder:text-slate-500"
                                        : "placeholder:text-slate-400",
                                      isExpanded
                                        ? "min-h-[50px] max-h-[96px] py-3 px-1"
                                        : "min-h-[40px] max-h-[96px] py-2 px-1",
                                      "clyra-visible-scrollbar transition-[height,min-height,max-height,padding,opacity,transform] duration-300 ease-[cubic-bezier(0.25,0.46,0.45,0.94)] will-change-[height,transform]",
                                      isFadingInText
                                        ? "opacity-0 translate-y-1 scale-[0.99]"
                                        : introState !== "complete"
                                          ? "opacity-0 translate-y-2 scale-[0.98]"
                                          : "opacity-100 translate-y-0 scale-100",
                                    )}
                                    style={{ maxHeight: "96px" }}
                                  />
                                  {!isExpanded && (
                                    <motion.button
                                      type="button"
                                      onClick={handleSendMessage}
                                      aria-label="Send message"
                                      whileHover={{ scale: 1.05 }}
                                      whileTap={{ scale: 0.95 }}
                                      disabled={
                                        value.trim().length === 0 &&
                                        !selectedCommand
                                      }
                                      className={cn(
                                        "p-2 rounded-full transition-all duration-700 shrink-0",
                                        "flex items-center justify-center",
                                        introState === "complete"
                                          ? "opacity-100"
                                          : "opacity-0",
                                        value.trim() || selectedCommand
                                          ? "bg-slate-900 text-white hover:bg-slate-800"
                                          : "bg-slate-100 text-slate-400 cursor-not-allowed",
                                      )}
                                    >
                                      <ArrowUpIcon className="w-4.5 h-4.5" />
                                    </motion.button>
                                  )}
                                </div>

                                <AnimatePresence>
                                  {attachments.length > 0 && (
                                    <motion.div
                                      className="clyra-attachments-row px-4 pb-3 flex gap-2 flex-wrap"
                                      initial={{ opacity: 0, height: 0 }}
                                      animate={{ opacity: 1, height: "auto" }}
                                      exit={{ opacity: 0, height: 0 }}
                                    >
                                      {attachments.map((file, index) => (
                                        <motion.div
                                          key={index}
                                          className="clyra-file-chip flex items-center gap-2 text-xs font-medium py-1.5 px-3 rounded-xl text-slate-600"
                                          initial={{ opacity: 0, scale: 0.9 }}
                                          animate={{ opacity: 1, scale: 1 }}
                                          exit={{ opacity: 0, scale: 0.9 }}
                                        >
                                          <FileUp className="w-3.5 h-3.5 text-slate-400" />
                                          <span>{file}</span>
                                          <button
                                            onClick={() =>
                                              removeAttachment(index)
                                            }
                                            className="text-slate-400 hover:text-slate-700 transition-colors ml-1"
                                          >
                                            <XIcon className="w-3.5 h-3.5" />
                                          </button>
                                        </motion.div>
                                      ))}
                                    </motion.div>
                                  )}
                                </AnimatePresence>

                                {isExpanded && (
                                  <div
                                    className={cn(
                                      "flex items-center justify-between p-2 pt-0",
                                    )}
                                  >
                                    <div className="flex items-center gap-1 sm:gap-2">
                                      <motion.button
                                        type="button"
                                        onClick={handleAttachFile}
                                        whileHover={{ scale: 1.05 }}
                                        whileTap={{ scale: 0.95 }}
                                        className="clyra-file-trigger p-2 sm:p-2.5 text-slate-500 hover:text-slate-800 rounded-full transition-colors flex items-center justify-center shrink-0 backdrop-blur-sm backdrop-saturate-125"
                                        aria-label="Attach files"
                                        title="Attach files"
                                      >
                                        <Paperclip className="w-4.5 h-4.5 sm:w-5 sm:h-5" />
                                      </motion.button>

                                      <AnimatePresence>
                                        {activeInputCommand && (
                                          <motion.div
                                            layout
                                            initial={{
                                              opacity: 0,
                                              scale: 0.9,
                                              filter: "blur(4px)",
                                            }}
                                            animate={{
                                              opacity: 1,
                                              scale: 1,
                                              filter: "blur(0px)",
                                            }}
                                            exit={{
                                              opacity: 0,
                                              scale: 0.9,
                                              filter: "blur(4px)",
                                            }}
                                            transition={{
                                              type: "spring",
                                              bounce: 0,
                                              duration: 0.3,
                                            }}
                                            className="flex items-center gap-1.5 text-slate-700 px-2.5 py-1.5 rounded-full text-xs sm:text-sm font-semibold ml-1 hover:bg-slate-100/80 transition-colors cursor-default"
                                          >
                                            <span className="opacity-70">
                                              {activeInputCommand.icon(false)}
                                            </span>
                                            <span className="hidden sm:inline-block">
                                              {activeInputCommand.label}
                                            </span>
                                            <button
                                              onClick={() => {
                                                setSelectedCommand(null);
                                                if (isVibeWorkspace) {
                                                  setActiveWorkspaceTab("chat");
                                                }
                                              }}
                                              className="ml-1 -mr-1 text-slate-400 hover:text-slate-600 rounded-full p-0.5 hover:bg-slate-100 transition-colors"
                                            >
                                              <XIcon className="w-3.5 h-3.5" />
                                            </button>
                                          </motion.div>
                                        )}
                                      </AnimatePresence>
                                    </div>

                                    <div className="flex items-center gap-2">
                                      <AnimatePresence mode="wait">
                                        {commandPaletteEnabled &&
                                        (value.trim() || selectedCommand) ? (
                                          <motion.div
                                            key="send-hint"
                                            initial={{ opacity: 0, x: 5 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            exit={{ opacity: 0, x: 5 }}
                                            className="hidden sm:flex items-center gap-2 text-[10px] text-slate-400/80 font-medium mr-1"
                                          >
                                            <span className="flex items-center gap-1">
                                              <kbd className="font-sans px-1 py-[1.5px] rounded-sm bg-slate-100/50 border border-slate-200/50 shadow-[0_1px_0.5px_rgba(0,0,0,0.02)] text-slate-400">
                                                Esc
                                              </kbd>
                                              to clear
                                            </span>
                                            <span className="text-slate-300">
                                              •
                                            </span>
                                            <span className="flex items-center gap-1">
                                              <kbd className="font-sans px-1 py-[1.5px] rounded-sm bg-slate-100/50 border border-slate-200/50 shadow-[0_1px_0.5px_rgba(0,0,0,0.02)] text-slate-400">
                                                ↵
                                              </kbd>
                                              to send
                                            </span>
                                          </motion.div>
                                        ) : commandPaletteEnabled ? (
                                          <motion.div
                                            key="cmd-hint"
                                            initial={{ opacity: 0, x: 5 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            exit={{ opacity: 0, x: 5 }}
                                            className="hidden sm:flex items-center gap-1.5 text-[10px] text-slate-400/80 font-medium mr-1"
                                          >
                                            <span className="flex items-center gap-1">
                                              <kbd className="font-sans px-1 py-[1.5px] rounded-sm bg-slate-100/50 border border-slate-200/50 shadow-[0_1px_0.5px_rgba(0,0,0,0.02)] text-slate-400">
                                                Ctrl/⌘K
                                              </kbd>
                                              for commands
                                            </span>
                                          </motion.div>
                                        ) : null}
                                      </AnimatePresence>
                                      <motion.button
                                        type="button"
                                        onClick={handleSendMessage}
                                        aria-label="Send message"
                                        whileHover={{ scale: 1.05 }}
                                        whileTap={{ scale: 0.95 }}
                                        disabled={
                                          value.trim().length === 0 &&
                                          !selectedCommand
                                        }
                                        className={cn(
                                          "p-2.5 rounded-full transition-all duration-200 shrink-0",
                                          "flex items-center justify-center shadow-sm",
                                          value.trim() || selectedCommand
                                            ? "bg-slate-900 text-white shadow-md hover:bg-slate-800 hover:shadow-lg"
                                            : "bg-slate-100 text-slate-400 cursor-not-allowed",
                                        )}
                                      >
                                        <ArrowUpIcon className="w-5 h-5" />
                                      </motion.button>
                                    </div>
                                  </div>
                                )}
                              </motion.div>
                            </motion.div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                      <AnimatePresence>
                        {false && isVibeWorkspace && messages.length === 0 && (
                          <motion.div
                            key="vibe-recent-projects"
                            initial={{ opacity: 0, y: 14, scale: 0.985 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 8, scale: 0.99 }}
                            transition={{
                              duration: 0.46,
                              ease: [0.22, 1, 0.36, 1],
                            }}
                            className="mx-auto grid w-full max-w-[1046px] grid-cols-1 gap-3.5 px-5 pb-8 sm:grid-cols-3 sm:px-8"
                          >
                            {getRecentVibeProjects.length === 0 ? (
                              <div className="col-span-full rounded-[28px] border border-dashed border-slate-200/80 bg-white/70 px-5 py-5 text-center shadow-[0_18px_45px_rgba(15,23,42,0.04)] backdrop-blur-xl">
                                <p className="text-[13px] font-semibold tracking-[-0.01em] text-slate-600">
                                  No recent projects yet
                                </p>
                                <p className="mt-1 text-[12px] font-medium text-slate-400">
                                  Start typing above and Clyra will save your
                                  Vibe projects here.
                                </p>
                              </div>
                            ) : (
                              getRecentVibeProjects.map((project, index) => (
                                <motion.button
                                  key={project.id}
                                  type="button"
                                  initial={{ opacity: 0, y: 12 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  transition={{
                                    delay: index * 0.05,
                                    duration: 0.34,
                                    ease: [0.22, 1, 0.36, 1],
                                  }}
                                  onClick={() => {
                                    const chat = chats.find(
                                      (c) => c.id === project.id,
                                    );
                                    if (chat) {
                                      setIsInputExpanded(false);
                                      openChatSession(chat);
                                    }
                                  }}
                                  className="group relative flex aspect-square min-h-[150px] flex-col justify-between overflow-hidden rounded-[30px] border border-white/80 bg-white/[0.72] p-[18px] text-left shadow-[0_22px_54px_rgba(15,23,42,0.055),inset_0_1px_0_rgba(255,255,255,0.92)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-slate-200 hover:bg-white/[0.88] hover:shadow-[0_26px_64px_rgba(15,23,42,0.085),inset_0_1px_0_rgba(255,255,255,0.95)] active:scale-[0.985]"
                                >
                                  <span className="pointer-events-none absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-white to-transparent" />
                                  <div className="flex items-center justify-between gap-3">
                                    <span className="grid h-9 w-9 place-items-center rounded-[18px] border border-slate-200/70 bg-slate-50 text-slate-700 shadow-[0_8px_22px_rgba(15,23,42,0.045)] transition-all duration-300 group-hover:bg-slate-950 group-hover:text-white">
                                      <SquarePen className="h-4 w-4" />
                                    </span>
                                    {project.isRunning ? (
                                      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200/70 bg-emerald-50/80 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-emerald-600">
                                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                        Running
                                      </span>
                                    ) : (
                                      <span className="h-2 w-2 rounded-full bg-slate-200/90 transition-colors group-hover:bg-slate-400" />
                                    )}
                                  </div>
                                  <div>
                                    <p
                                      className="text-[15px] font-semibold leading-snug tracking-[-0.02em] text-slate-800"
                                      style={{
                                        display: "-webkit-box",
                                        WebkitLineClamp: 2,
                                        WebkitBoxOrient: "vertical",
                                        overflow: "hidden",
                                      }}
                                    >
                                      {project.title}
                                    </p>
                                    <p className="mt-2 flex items-center gap-1.5 text-[11.5px] font-semibold text-slate-400 transition-colors group-hover:text-slate-600">
                                      Open project
                                      <ChevronRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-0.5" />
                                    </p>
                                  </div>
                                </motion.button>
                              ))
                            )}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  </AnimatePresence>
                </div>
              </div>
              <div
                className={cn(
                  "flex min-h-0 min-w-0 flex-col overflow-hidden bg-white transition-opacity duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
                  showWorkspaceLivePreview
                    ? "pointer-events-auto opacity-100"
                    : "pointer-events-none opacity-0",
                )}
                aria-hidden={!showWorkspaceLivePreview}
              >
                {showWorkspaceLivePreview ? (
                  <VibeLivePreviewPanel
                    filesByPath={vibePreviewFiles!}
                    onAutoFix={handleAutoFix}
                    setToastMessage={setToastMessage}
                    onReferenceElement={handlePreviewElementReference}
                  />
                ) : null}
              </div>
            </div>
          </motion.div>
          <AnimatePresence>
            {toastMessage && (
              <motion.div
                initial={{ opacity: 0, y: -40, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9, y: -20 }}
                transition={{
                  type: "spring",
                  stiffness: 400,
                  damping: 25,
                  mass: 0.8,
                }}
                className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] px-3.5 py-3 bg-white text-slate-700 text-sm font-medium rounded-[32px] shadow-[0_8px_30px_rgb(0,0,0,0.08)] border border-slate-200/60 flex items-center gap-3.5 max-w-[90vw]"
              >
                <div className="relative flex items-center justify-center w-8 h-8 rounded-full shrink-0 ml-1">
                  <MessageCircleDashed className="w-5 h-5 text-slate-600 stroke-[1.5]" />
                  <motion.div
                    initial={{ scale: 1, opacity: 1, y: 0 }}
                    animate={{ scale: 0, opacity: 0, y: -5 }}
                    transition={{ duration: 0.3, delay: 0.4, ease: "backIn" }}
                    className="absolute inset-0 flex items-center justify-center pointer-events-none"
                  >
                    <div className="flex items-center justify-center w-full h-full bg-white rounded-full">
                      <Check className="w-4 h-4 stroke-[3] text-slate-500" />
                    </div>
                  </motion.div>
                </div>
                <div className="flex flex-col pr-3">
                  <span className="font-semibold text-slate-800 tracking-tight leading-tight mb-[3px]">
                    Temporary chat disabled
                  </span>
                  <span className="text-slate-500 text-[13px] leading-tight font-normal">
                    This conversation is saved to your history.
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      <ChatSearchModal
        isOpen={isSearchModalOpen}
        onClose={() => setIsSearchModalOpen(false)}
        chats={chats}
        currentChatId={currentChatId}
        onSelectChat={(id) => {
          handleChatSelect(id);
          setIsSearchModalOpen(false);
        }}
        onNewChat={() => {
          handleNewChat();
          setIsSearchModalOpen(false);
        }}
      />
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        theme={theme}
        setTheme={setTheme}
        sendOnEnter={sendOnEnter}
        setSendOnEnter={setSendOnEnter}
        fontSize={fontSize}
        setFontSize={setFontSize}
        autoScroll={autoScroll}
        setAutoScroll={setAutoScroll}
        animationSpeed={animationSpeed}
        setAnimationSpeed={setAnimationSpeed}
        codeHighlighting={codeHighlighting}
        setCodeHighlighting={setCodeHighlighting}
        markdownSupport={markdownSupport}
        setMarkdownSupport={setMarkdownSupport}
        systemPrompt={systemPrompt}
        setSystemPrompt={setSystemPrompt}
        temperature={temperature}
        setTemperature={setTemperature}
        userBubbleColor={userBubbleColor}
        setUserBubbleColor={setUserBubbleColor}
        orbColorTheme={orbColorTheme}
        setOrbColorTheme={setOrbColorTheme}
        chats={chats}
        clearChats={() => {
          setChats([]);
          setMessages([]);
          setCurrentChatId(null);
          setIsSettingsOpen(false);
          setToastMessage("All chats cleared");
        }}
      />
    </FullscreenContext.Provider>
  );
}

export async function streamOpenAI(
  systemInstruction: string | null,
  messages: any[],
  onChunk: (text: string, isReasoning?: boolean) => void,
  temperature: number = 0.7,
  maxTokens: number = 8000,
  model: string = "deepseek-reasoner",
  signal?: AbortSignal,
) {
  const formattedMessages = systemInstruction
    ? [{ role: "system", content: systemInstruction }, ...messages]
    : messages;

  const response = await fetch("/api/deepseek/chat", {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: formattedMessages,
      temperature,
      stream: true,
      max_tokens: maxTokens,
    }),
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const errBody = await response.json();
      if (errBody?.error) detail = String(errBody.error);
    } catch {
      /* ignore */
    }
    throw new Error(`Chat API error: ${response.status} ${detail}`);
  }

  const reader = response.body?.getReader();
  const decoder = new TextDecoder("utf-8");
  if (!reader) return;

  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (let line of lines) {
      line = line.trim();
      if (!line) continue;
      if (line === "data: [DONE]") return;
      if (line.startsWith("data: ")) {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.choices && data.choices[0] && data.choices[0].delta) {
            const delta = data.choices[0].delta;
            if (delta.reasoning_content) {
              onChunk(delta.reasoning_content, true);
            }
            if (delta.content) {
              onChunk(delta.content, false);
            }
          }
        } catch (e) {
          // Ignore parse errors
        }
      }
    }
  }
}

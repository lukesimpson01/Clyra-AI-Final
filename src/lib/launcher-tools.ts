import { useCallback, useEffect, useState } from "react";

export type LauncherToolId =
  | "chat"
  | "vibe"
  | "clip"
  | "browser"
  | "forge"
  | "roleplay"
  | "tools"
  | "system-care"
  | "would-rather"
  | "fake-text";

const STORAGE_KEY = "clyra:launcher-wheel-v1";

/**
 * One description of what each Clyra app *is*, shared by the launcher wheel and
 * the Marketplace. Keeping it here means a tool cannot be labelled one way on
 * the wheel and another way on the page that adds it back.
 */
export const LAUNCHER_CATALOGUE: Array<{
  id: LauncherToolId;
  label: string;
  shortLabel: string;
  detail: string;
}> = [
  { id: "vibe", label: "Vibe Coder", shortLabel: "Vibe Coder", detail: "Build and preview production applications" },
  { id: "chat", label: "Chat", shortLabel: "Chat", detail: "Think, write and reason with Clyra" },
  { id: "clip", label: "AI Clipper", shortLabel: "Clip", detail: "Turn long videos into polished social clips" },
  { id: "forge", label: "Game Maker", shortLabel: "Games", detail: "Describe a game and build, play and publish it in the browser" },
  { id: "would-rather", label: "Would You Rather", shortLabel: "Would You Rather", detail: "Make narrated choice and poll videos" },
  { id: "fake-text", label: "Text Story", shortLabel: "Text Story", detail: "Generate narrated iMessage-style stories" },
  { id: "browser", label: "AI Browser", shortLabel: "Browser", detail: "Research and act across live websites" },
  { id: "roleplay", label: "AI Roleplay", shortLabel: "Roleplay", detail: "Chat with persistent, web-researched characters" },
  { id: "tools", label: "Tool Library", shortLabel: "Tools", detail: "Discover, install and create native Clyra capabilities" },
  { id: "system-care", label: "Clyra System Care", shortLabel: "System Care", detail: "Understand device health, storage and performance" },
];

/**
 * The wheel's default membership and, just as importantly, its order.
 *
 * Order is part of the data rather than a sort applied later: the wheel is a
 * spatial control, and people learn where a tool sits on it. Re-sorting it
 * alphabetically or by recency after someone has built that muscle memory
 * would make the launcher slower to use, not faster.
 */
export const DEFAULT_LAUNCHER_TOOLS: LauncherToolId[] = [
  "vibe",
  "chat",
  "clip",
  "forge",
  "would-rather",
  "fake-text",
  "browser",
  "roleplay",
  "tools",
  "system-care",
];

/**
 * The wheel needs at least a couple of slices to remain a wheel, and the
 * Marketplace has to stay reachable from it — otherwise removing the last tool
 * leaves no route back to add anything again.
 */
export const MIN_LAUNCHER_TOOLS = 2;
export const PINNED_LAUNCHER_TOOLS: LauncherToolId[] = ["tools"];

function read(): LauncherToolId[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...DEFAULT_LAUNCHER_TOOLS];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_LAUNCHER_TOOLS];
    const valid = parsed.filter((id): id is LauncherToolId =>
      DEFAULT_LAUNCHER_TOOLS.includes(id as LauncherToolId));
    // A stored list that has lost its pinned entries (older build, hand-edited
    // storage) is repaired rather than rejected.
    for (const pinned of PINNED_LAUNCHER_TOOLS) {
      if (!valid.includes(pinned)) valid.push(pinned);
    }
    return valid.length >= MIN_LAUNCHER_TOOLS ? valid : [...DEFAULT_LAUNCHER_TOOLS];
  } catch {
    return [...DEFAULT_LAUNCHER_TOOLS];
  }
}

function write(ids: LauncherToolId[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    /* storage unavailable — the wheel still works for this session */
  }
  // Other mounted surfaces (the Marketplace, a second launcher) update in the
  // same tick; `storage` only fires for *other* tabs, never the one that wrote.
  window.dispatchEvent(new CustomEvent(LAUNCHER_TOOLS_EVENT));
}

const LAUNCHER_TOOLS_EVENT = "clyra:launcher-tools-changed";

/** Shared, persisted membership of the launcher wheel. */
export function useLauncherTools() {
  const [ids, setIds] = useState<LauncherToolId[]>(read);

  useEffect(() => {
    const sync = () => setIds(read());
    window.addEventListener(LAUNCHER_TOOLS_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(LAUNCHER_TOOLS_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const add = useCallback((id: LauncherToolId) => {
    const next = read();
    if (next.includes(id)) return;
    // New tools join at the end so nothing already on the wheel moves.
    next.push(id);
    write(next);
    setIds(next);
  }, []);

  const remove = useCallback((id: LauncherToolId) => {
    if (PINNED_LAUNCHER_TOOLS.includes(id)) return;
    const next = read().filter((item) => item !== id);
    if (next.length < MIN_LAUNCHER_TOOLS) return;
    write(next);
    setIds(next);
  }, []);

  const reset = useCallback(() => {
    write([...DEFAULT_LAUNCHER_TOOLS]);
    setIds([...DEFAULT_LAUNCHER_TOOLS]);
  }, []);

  const canRemove = useCallback(
    (id: LauncherToolId) => !PINNED_LAUNCHER_TOOLS.includes(id) && ids.length > MIN_LAUNCHER_TOOLS,
    [ids.length],
  );

  return { ids, add, remove, reset, canRemove };
}

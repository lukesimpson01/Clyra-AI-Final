import { useSyncExternalStore } from "react";

/* Which of Clyra's own apps the agent is working in right now, and where its pointer is. The app's window reads this to
   paint the blue field, the pointer and the "working" lock, wherever that window is shown: in the workspace, or as a
   live tile in Task View. */
export type ToolAgentState = {
  busy: boolean;
  tool: string | null;
  label: string;
  cursor: { x: number; y: number; kind?: string; id: number } | null;
  /** when the last run ended (ms), so a window can play its "done" release once */
  finishedAt: number;
};

let state: ToolAgentState = { busy: false, tool: null, label: "", cursor: null, finishedAt: 0 };
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export const getToolAgent = () => state;
export function setToolAgent(patch: Partial<ToolAgentState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}
export const useToolAgent = () => useSyncExternalStore(subscribe, getToolAgent, getToolAgent);

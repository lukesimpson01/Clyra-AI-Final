export const COMPUTER_USE_STATUSES = [
  "IDLE", "PLANNING", "OBSERVING", "ACTING", "WAITING", "VERIFYING",
  "RECOVERING", "NEEDS_APPROVAL", "NEEDS_USER", "USER_CONTROL", "PAUSED",
  "COMPLETED", "FAILED", "CANCELLED",
] as const;

export type ComputerUseStatus = (typeof COMPUTER_USE_STATUSES)[number];
export type DesktopRole = "button" | "checkbox" | "radio" | "textfield" | "textarea" |
  "link" | "menu" | "menuitem" | "tab" | "list" | "listitem" | "tree" |
  "treeitem" | "table" | "row" | "cell" | "slider" | "combobox" | "toolbar" |
  "dialog" | "window" | "document" | "image" | "statictext" | "unknown";
export type DesktopActionCapability = "invoke" | "focus" | "setValue" | "click" |
  "toggle" | "select" | "expand" | "collapse" | "scroll";

export interface DesktopBounds { x: number; y: number; width: number; height: number }
export interface DesktopElement {
  id: string; platformId?: string; appId: string; windowId: string;
  role: DesktopRole; subrole?: string; name?: string; value?: string;
  placeholder?: string; description?: string; bounds?: DesktopBounds;
  enabled: boolean; focused: boolean; selected?: boolean; expanded?: boolean;
  actions: DesktopActionCapability[]; parentId?: string; childIds?: string[];
  confidence: number; sensitive?: boolean;
}
export interface DesktopWindow { id: string; appId: string; title: string; bounds?: DesktopBounds; active: boolean }
export interface SemanticDesktopSnapshot {
  revision: number; capturedAt: number; activeApp?: string; activeWindow?: string;
  windows: DesktopWindow[]; elements: DesktopElement[]; changedElementIds: string[];
  modalElementId?: string;
}
export type ComputerActionName = "invoke" | "focus" | "set_value" | "click" |
  "double_click" | "right_click" | "hover" | "drag" | "scroll" | "type" |
  "keypress" | "select" | "toggle" | "expand" | "collapse" | "move_cursor" |
  "launch_app" | "activate_app" | "close_window" | "minimize_window" |
  "maximize_window" | "wait" | "observe";
export interface ComputerAction {
  name: ComputerActionName; elementId?: string; value?: string; keys?: string[];
  point?: { x: number; y: number }; destination?: { x: number; y: number };
  expected?: ActionPostcondition; timeoutMs?: number;
}
export interface ActionPostcondition { windowTitleContains?: string; focusedElementId?: string; elementExists?: string; valueEquals?: string; screenChanged?: boolean }
export interface ProposedComputerAction {
  userGoal: string; action: ComputerActionName; targetApp: string; targetDescription: string;
  externalSideEffect: boolean; destructive: boolean; sendsData: boolean;
  changesAccount: boolean; financial: boolean; securitySensitive: boolean;
  credentialRelated: boolean; reversible: boolean;
  sourceOfInstruction: "USER" | "PLAN" | "SCREEN_CONTENT" | "INFERRED";
  amount?: number; currency?: string; merchant?: string; recurring?: boolean;
}
export type ReviewDecision = "ALLOW" | "ALLOW_WITH_LOG" | "REQUIRE_USER_CONFIRMATION" | "REQUIRE_USER_TAKEOVER" | "DENY";
export interface TaskStep { id: string; description: string; status: "pending" | "active" | "complete" | "failed" }
export interface TaskPlan { goal: string; steps: TaskStep[] }
export interface ActionRecord { at: number; action: ComputerAction; result: "success" | "failed" | "denied"; stateSignature?: string; detail?: string }
export interface ComputerUseSession {
  id: string; status: ComputerUseStatus; userGoal: string; createdAt: number;
  currentPlan: TaskPlan; activeApp?: string; activeWindow?: string;
  approvals: Array<{ at: number; action: ComputerActionName; scope: string }>;
  recentActions: ActionRecord[]; checkpoints: Array<{ at: number; revision: number; note: string }>;
  takeoverActive: boolean; failedStrategies: string[];
}
export interface NativeComputerAdapter {
  observe(signal?: AbortSignal): Promise<SemanticDesktopSnapshot>;
  execute(action: ComputerAction, target: DesktopElement | undefined, signal: AbortSignal): Promise<{ success: boolean; detail?: string }>;
  releaseInput(): Promise<void>;
}

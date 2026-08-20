/**
 * Browser half of the AI protocol (spec §64, §145, §248).
 *
 * Opens the WebSocket, sends the frozen context, executes every tool the
 * orchestrator asks for against the live editor, and streams status back to
 * the UI. Tool execution stays here — in the browser — because the tools
 * touch the real editor scene and the sandboxed runtime.
 */
import type { ClientMessage, EffortLevel, ServerMessage } from "../../../../lib/game-maker/protocol";
import { activeScene } from "../ir/project";
import { formatSceneSummary } from "../scene/summary";
import { executeTool, type ToolContext } from "./executor";
import { canonicalToolName, toolCatalogue } from "./tools";
import { listGenerators } from "../procedural/registry";

export interface AgentEvents {
  onAccepted?: (effort: EffortLevel) => void;
  onState?: (state: string, detail?: string) => void;
  onPlan?: (plan: { goal: string; successCriteria: string[]; steps: { id: string; tool: string; intent: string }[] }) => void;
  onToolStart?: (requestId: string, tool: string, intent?: string) => void;
  onToolEnd?: (requestId: string, tool: string, ok: boolean, detail?: string) => void;
  onMessage?: (text: string) => void;
  onComplete?: (result: { summary: string; verified: boolean; toolCalls: number; repairs: number }) => void;
  onFailed?: (error: string) => void;
  onCancelled?: () => void;
  onApprovalRequest?: (requestId: string, tool: string, summary: string) => void;
}

let taskSequence = 0;

function agentUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/game-maker/agent`;
}

/**
 * The compact project brief the model receives instead of the scene JSON
 * (spec §246, §247). Everything else it must ask for.
 */
export function buildBrief(context: ToolContext): string {
  const project = context.getProject();
  const scene = activeScene(project);
  const frame = context.getContextFrame();
  const lines: string[] = [];

  lines.push(`PROJECT "${project.metadata.name}" — ${project.runtime.mode.toUpperCase()} ${project.metadata.genre}, ${project.metadata.camera} camera.`);
  lines.push(`Concept: ${project.metadata.concept}`);
  lines.push(`Art style: ${project.metadata.artStyle.name}, ${project.metadata.artStyle.geometry}, palette ${project.metadata.artStyle.palette.join(" ")}`);
  lines.push(`Core loop: ${project.metadata.coreLoop}`);
  lines.push(`Performance contract: ${project.performanceProfile.targetFPS} FPS target, ${project.performanceProfile.minimumFPS} minimum, profile ${project.performanceProfile.profile}.`);
  lines.push("");
  lines.push(`SCENE (id ${scene.id}, revision ${scene.revision})`);
  lines.push(formatSceneSummary(frame?.sceneSummary ?? { sceneId: scene.id, name: scene.name, entityCount: 0, regionCount: 0, tree: { label: scene.name, count: 0 }, systems: [], bounds: { min: [0, 0, 0], max: [0, 0, 0] } }));
  lines.push("");

  if (frame) {
    lines.push("EDITOR CONTEXT (frozen at the moment of this request)");
    if (frame.selected.length) {
      lines.push(`Selected: ${frame.selected.map((entity) => `${entity.name} [${entity.entityId}] at ${entity.position.map((value) => value.toFixed(1)).join(",")}`).join("; ")}`);
    } else {
      lines.push("Selected: nothing");
    }
    if (frame.cursor.hit) {
      lines.push(`Cursor is over ${frame.cursor.hit.entityId ?? "the ground"} at ${frame.cursor.hit.position.map((value) => value.toFixed(1)).join(",")} — this is what "here" means.`);
    } else {
      lines.push('Cursor is not over anything — "here" cannot be resolved; ask, or use an explicit anchor.');
    }
    if (frame.visible.length) {
      const onScreen = frame.visible.slice(0, 8).map((entity) => {
        const bounds = entity.screenBounds;
        const side = bounds ? (bounds[0] > 0.6 ? "right" : bounds[2] < 0.4 ? "left" : "centre") : "";
        return `${entity.name} [${entity.entityId}] ${side} (${entity.distance}m)`;
      });
      lines.push(`On screen, largest first: ${onScreen.join("; ")}`);
    }
  } else {
    lines.push("EDITOR CONTEXT: none was captured — relative words cannot be resolved.");
  }

  lines.push("");
  lines.push(`Generators available for this mode: ${listGenerators(project.runtime.mode).map((entry) => entry.name).join(", ")}. Call tool.discover for their schemas.`);
  const existingTests = project.tests.map((test) => test.name);
  if (existingTests.length) lines.push(`Saved playtests: ${existingTests.join(", ")}`);
  return lines.join("\n");
}

export class AgentClient {
  private socket: WebSocket | null = null;
  private currentTaskId: string | null = null;
  private connecting: Promise<WebSocket> | null = null;

  constructor(private readonly context: ToolContext, private readonly events: AgentEvents = {}) {}

  get busy() {
    return this.currentTaskId !== null;
  }

  private connect(): Promise<WebSocket> {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) return Promise.resolve(this.socket);
    if (this.connecting) return this.connecting;

    this.connecting = new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(agentUrl());
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error("Could not reach Clyra's game agent. Is the Clyra server running?"));
      }, 12_000);

      socket.onopen = () => {
        clearTimeout(timer);
        this.socket = socket;
        this.connecting = null;
        resolve(socket);
      };
      socket.onerror = () => {
        clearTimeout(timer);
        this.connecting = null;
        reject(new Error("The connection to Clyra's game agent failed."));
      };
      socket.onclose = () => {
        if (this.currentTaskId) {
          this.events.onFailed?.("The connection to the game agent dropped. Completed work is preserved — you can retry.");
          this.currentTaskId = null;
        }
        this.socket = null;
      };
      socket.onmessage = (event) => void this.receive(event.data);
    });
    return this.connecting;
  }

  private send(message: ClientMessage) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  private async receive(raw: unknown) {
    let message: ServerMessage;
    try {
      message = JSON.parse(String(raw)) as ServerMessage;
    } catch {
      return;
    }

    switch (message.type) {
      case "task.accepted":
        this.events.onAccepted?.(message.effort);
        break;
      case "task.state":
        this.events.onState?.(message.state, message.detail);
        break;
      case "plan.created":
        this.events.onPlan?.(message.plan);
        break;
      case "task.message":
        this.events.onMessage?.(message.text);
        break;
      case "approval.request":
        this.events.onApprovalRequest?.(message.requestId, message.tool, message.summary);
        break;
      case "tool.request": {
        const tool = canonicalToolName(message.tool);
        this.events.onToolStart?.(message.requestId, tool, message.intent);
        const result = await executeTool(this.context, tool, message.arguments);
        this.events.onToolEnd?.(
          message.requestId,
          tool,
          result.ok,
          result.ok
            ? [result.meta.changedEntities?.length ? `${result.meta.changedEntities.length} entities` : "", ...(result.meta.warnings ?? [])].filter(Boolean).join(" · ")
            : result.error?.message,
        );
        this.send({
          type: "tool.result",
          taskId: message.taskId,
          requestId: message.requestId,
          ok: result.ok,
          result: result.ok ? { data: result.data, meta: result.meta } : undefined,
          error: result.error,
        });
        break;
      }
      case "task.complete":
        this.currentTaskId = null;
        this.events.onComplete?.(message);
        break;
      case "task.failed":
        this.currentTaskId = null;
        this.events.onFailed?.(message.error);
        break;
      case "task.cancelled":
        this.currentTaskId = null;
        this.events.onCancelled?.();
        break;
    }
  }

  async start(request: string, effort?: EffortLevel) {
    if (this.currentTaskId) throw new Error("A task is already running. Stop it before starting another.");
    const project = this.context.getProject();
    await this.connect();

    taskSequence += 1;
    const taskId = `task-${Date.now().toString(36)}-${taskSequence.toString(36)}`;
    this.currentTaskId = taskId;

    this.send({
      type: "task.start",
      taskId,
      projectId: project.projectId,
      request,
      effort,
      context: {
        brief: buildBrief(this.context),
        tools: toolCatalogue(),
        mode: project.runtime.mode,
        sceneRevision: activeScene(project).revision,
      },
    });
    return taskId;
  }

  cancel() {
    if (!this.currentTaskId) return;
    this.send({ type: "task.cancel", taskId: this.currentTaskId });
  }

  pause() {
    if (this.currentTaskId) this.send({ type: "task.pause", taskId: this.currentTaskId });
  }

  resume() {
    if (this.currentTaskId) this.send({ type: "task.resume", taskId: this.currentTaskId });
  }

  approve(requestId: string, approved: boolean) {
    if (this.currentTaskId) this.send({ type: "approval.result", taskId: this.currentTaskId, requestId, approved });
  }

  dispose() {
    this.cancel();
    this.socket?.close();
    this.socket = null;
    this.currentTaskId = null;
  }
}

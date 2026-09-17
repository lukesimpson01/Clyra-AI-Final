/**
 * HTTP surface for Clyra Cowork.
 *
 * The capability handlers registered here are thin adapters onto Clyra's
 * existing implementations — web search, the workspace filesystem, the
 * terminal — so bots reuse the real tools rather than getting parallel
 * versions with their own bugs and their own missing permission checks.
 */
import type { Express } from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { BotStore, BotValidationError, type Bot } from "./store";
import { CapabilityGateway } from "./capability-gateway";
import { AgentMailbox, MailboxError, parseMentions } from "./mailbox";
import { normalisePermissions } from "./permissions";
import { ConversationError, ConversationStore } from "./conversations";
import { generateReply, selectResponders } from "./runtime";
import { ensureWorkspace, workspaceRoot, WorkspaceViolationError } from "./workspace";
import { CoworkTaskStore, CoworkTaskError } from "./tasks";
import { CoworkTaskRuntime } from "./task-runtime";
import type { BrowserAction } from "../openbrowser/browser-runtime";

export interface CoworkDeps {
  /** Clyra's existing research/web-search implementation. */
  runWebSearchResearch: (input: { query: string; maxResults?: number; fetchTop?: number }) => Promise<unknown>;
  /** Clyra's existing credit ledger. */
  recordUsage: (input: {
    provider: string; model: string; feature: string;
    usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  }) => void;
  /** Existing semantic Playwright browser. Cowork never uses screenshots. */
  browser: {
    observe: () => Promise<unknown>;
    navigate: (target: string) => Promise<unknown>;
    action: (action: BrowserAction) => Promise<unknown>;
    assist: (task: string, onProgress?: (event: unknown) => void) => Promise<unknown>;
    control: (manual: boolean) => Promise<unknown>;
  };
}

/** Commands refused outright — the damage is not worth an approval prompt. */
const FORBIDDEN_COMMAND = /(^|\s|;|&&|\|\|)(rm\s+-rf\s+\/(\s|$)|mkfs|dd\s+if=|shutdown|reboot|:\(\)\s*\{)/i;
/** Commands that are legitimate but need a human to say yes first. */
const DESTRUCTIVE_COMMAND = /(^|\s|;|&&|\|\|)(rm|rmdir|mv|chmod|chown|kill|pkill|curl|wget|npm\s+publish|git\s+push)(\s|$)/i;

export function registerCoworkRoutes(app: Express, deps: CoworkDeps) {
  const store = new BotStore();
  const conversations = new ConversationStore();
  const gateway = new CapabilityGateway();
  const tasks = new CoworkTaskStore();
  const mailbox = new AgentMailbox({
    resolveName: async (name) => {
      const bots = await store.list();
      const found = bots.find(
        (bot) => bot.name.toLowerCase() === name.toLowerCase() || bot.slug.toLowerCase() === name.toLowerCase(),
      );
      return found ? { id: found.id, name: found.name, slug: found.slug } : null;
    },
  });

  // ── Capability handlers: adapters onto existing Clyra tools ──────────
  gateway.register("web_search", async (input) =>
    deps.runWebSearchResearch({
      query: String(input.query || ""),
      maxResults: Number(input.maxResults ?? 6),
      fetchTop: Number(input.fetchTop ?? 3),
    }));
  gateway.register("research", async (input) =>
    deps.runWebSearchResearch({ query: String(input.query || ""), maxResults: 8, fetchTop: 4 }));

  gateway.register("browser", async (input, context) => {
    const operation = String(input.operation || "observe");
    if (operation === "observe") return deps.browser.observe();
    if (operation === "navigate") {
      const target = String(input.target || input.url || "").trim();
      if (!target || target.length > 2_000) throw new Error("A valid browser target is required.");
      return deps.browser.navigate(target);
    }
    if (operation === "action") {
      const action = input.action as BrowserAction | undefined;
      if (!action || typeof action !== "object" || typeof action.type !== "string") throw new Error("A structured browser action is required.");
      return deps.browser.action(action);
    }
    if (operation === "assist") {
      const task = String(input.task || "").trim();
      if (!task || task.length > 8_000) throw new Error("A valid browser task is required.");
      // The existing browser runner gives semantic observation, state
      // verification, and selector recovery. Its progress becomes Cowork's
      // real activity record through the gateway output.
      return deps.browser.assist(task);
    }
    if (operation === "take_control") return deps.browser.control(true);
    if (operation === "resume_agent") return deps.browser.control(false);
    throw new Error(`Unsupported browser operation "${operation}".`);
  });

  gateway.register("files", async (input, context) => {
    const operation = String(input.operation || "read");
    // Every path goes through the workspace jail, never through cwd.
    const target = gateway.resolvePath(context, String(input.path || ""));
    if (operation === "read") return await fs.readFile(target, "utf8");
    if (operation === "write") {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, String(input.content ?? ""), "utf8");
      return { written: true };
    }
    if (operation === "list") {
      const entries = await fs.readdir(target, { withFileTypes: true });
      return entries.map((entry) => ({ name: entry.name, directory: entry.isDirectory() }));
    }
    if (operation === "delete") {
      await fs.rm(target, { recursive: true, force: true });
      return { deleted: true };
    }
    throw new Error(`Unsupported file operation "${operation}".`);
  });

  gateway.register("terminal", async (input, context) => {
    const command = String(input.command || "").trim();
    if (!command) throw new Error("No command given.");
    if (FORBIDDEN_COMMAND.test(command)) {
      throw new Error("That command is blocked because it is unrecoverable.");
    }
    const cwd = await ensureWorkspace(context.slug);
    return await new Promise((resolve, reject) => {
      // Rooted at the workspace and given a bounded lifetime: an agent's
      // runaway process must not outlive the request or hold the machine.
      const child = spawn(command, { cwd, shell: true, env: { ...process.env, CLYRA_BOT_SLUG: context.slug } });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Command timed out after 120s.")); }, 120_000);
      child.stdout.on("data", (chunk) => { stdout = `${stdout}${chunk}`.slice(-200_000); });
      child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-50_000); });
      child.on("error", (error) => { clearTimeout(timer); reject(error); });
      child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    });
  });

  let runtime: CoworkTaskRuntime;
  runtime = new CoworkTaskRuntime({
    tasks, gateway, getBot: async (id) => store.get(id),
    delegate: async (from, parent, name, request) => {
      const candidates = await store.list();
      const target = candidates.find((item) => item.name.toLowerCase() === name.toLowerCase() || item.slug.toLowerCase() === name.toLowerCase());
      if (!target || target.id === from.id) return null;
      const child = await tasks.create({ conversationId: parent.conversationId, projectId: parent.projectId, parentId: parent.id, botId: target.id, title: request.slice(0, 100), objective: request });
      void runtime.run(child.id);
      return child.id;
    },
  });

  const findBot = async (id: string): Promise<Bot | null> => store.get(String(id));
  const fail = (res: any, status: number, error: unknown) =>
    res.status(status).json({ ok: false, error: error instanceof Error ? error.message : String(error) });

  // ── Bots ────────────────────────────────────────────────────────────
  app.get("/api/bots", async (_req, res) => {
    try {
      res.json({ ok: true, bots: await store.list(), capabilities: gateway.registered() });
    } catch (error) { fail(res, 500, error); }
  });

  app.post("/api/bots", async (req, res) => {
    try {
      res.json({ ok: true, bot: await store.create(req.body) });
    } catch (error) {
      fail(res, error instanceof BotValidationError || error instanceof WorkspaceViolationError ? 400 : 500, error);
    }
  });

  app.put("/api/bots/:id", async (req, res) => {
    try {
      res.json({ ok: true, bot: await store.update(String(req.params.id), req.body) });
    } catch (error) { fail(res, error instanceof BotValidationError ? 400 : 500, error); }
  });

  app.delete("/api/bots/:id", async (req, res) => {
    try {
      const result = await store.remove(String(req.params.id));
      if (!result.removed) { fail(res, 404, new Error("That bot no longer exists.")); return; }
      // The workspace is deliberately left on disk; the path is returned so
      // the UI can tell the user where their files still are.
      res.json({ ok: true, workspace: result.workspace });
    } catch (error) { fail(res, 500, error); }
  });

  app.get("/api/bots/:id/log", async (req, res) => {
    res.json({ ok: true, entries: gateway.recentLog(String(req.params.id), 200) });
  });

  // ── Durable task graph ──────────────────────────────────────────────
  app.get("/api/cowork/tasks", async (req, res) => {
    try {
      res.json({ ok: true, tasks: await tasks.list({
        conversationId: typeof req.query.conversationId === "string" ? req.query.conversationId : undefined,
        botId: typeof req.query.botId === "string" ? req.query.botId : undefined,
      }) });
    } catch (error) { fail(res, 500, error); }
  });

  app.get("/api/cowork/tasks/:id", async (req, res) => {
    try {
      const task = await tasks.get(String(req.params.id));
      if (!task) { fail(res, 404, new Error("That task no longer exists.")); return; }
      res.json({ ok: true, task, children: (await tasks.list()).filter((item) => item.parentId === task.id) });
    } catch (error) { fail(res, 500, error); }
  });

  app.post("/api/cowork/tasks/:id/:operation", async (req, res) => {
    try {
      const id = String(req.params.id); const operation = String(req.params.operation);
      const task = await tasks.get(id); if (!task) { fail(res, 404, new Error("That task no longer exists.")); return; }
      if (operation === "pause") { runtime.pause(id); res.json({ ok: true, task: await tasks.transition(id, "paused", { currentStep: "Paused — resume performs a fresh observation" }, { kind: "thinking", label: "Task paused" }) }); return; }
      if (operation === "stop") { runtime.stop(id); res.json({ ok: true, task: await tasks.transition(id, "cancelled", { currentStep: "Stopped by user" }, { kind: "error", label: "Task stopped" }) }); return; }
      if (operation === "resume") {
        const next = task.state === "paused" ? await tasks.transition(id, "running", { currentStep: "Resuming with a fresh observation" }, { kind: "thinking", label: "Task resumed" }) : task;
        void runtime.run(id); res.json({ ok: true, task: next }); return;
      }
      if (operation === "retry") { const next = await tasks.retry(id); void runtime.run(id); res.json({ ok: true, task: next }); return; }
      if (operation === "approve") { if (task.state !== "awaiting_approval") { fail(res, 400, new Error("That task is not awaiting approval.")); return; } void runtime.run(id, true); res.json({ ok: true, task }); return; }
      if (operation === "reject") { if (task.state !== "awaiting_approval") { fail(res, 400, new Error("That task is not awaiting approval.")); return; } res.json({ ok: true, task: await tasks.transition(id, "blocked", { currentStep: "Approval rejected", error: "The requested action was rejected.", pendingAction: null }, { kind: "approval", label: "Approval rejected" }) }); return; }
      fail(res, 400, new Error("Unsupported task operation."));
    } catch (error) { fail(res, error instanceof CoworkTaskError ? 400 : 500, error); }
  });

  // ── Capability invocation ───────────────────────────────────────────
  app.post("/api/bots/:id/call", async (req, res) => {
    try {
      const bot = await findBot(String(req.params.id));
      if (!bot) { fail(res, 404, new Error("That bot no longer exists.")); return; }

      const capability = String(req.body?.capability || "");
      const input = (req.body?.input && typeof req.body.input === "object" ? req.body.input : {}) as Record<string, unknown>;

      // A destructive shell command is classified here, at the boundary, so
      // the bot cannot avoid the approval gate by omitting the action name.
      let action = typeof req.body?.action === "string" ? req.body.action : undefined;
      if (capability === "terminal" && DESTRUCTIVE_COMMAND.test(String(input.command || ""))) {
        action = "destructive_command";
      }
      if (capability === "files" && String(input.operation || "") === "delete") {
        action = "file_delete_outside_project";
      }

      await store.setStatus(bot.id, capability === "browser" ? "browsing" : capability === "terminal" ? "coding" : "thinking",
        String(input.command || input.query || input.path || ""));

      const result = await gateway.call(
        { capability: capability as never, action, input },
        { botId: bot.id, slug: bot.slug, permissions: bot.permissions, approved: req.body?.approved === true },
      );

      await store.setStatus(bot.id, result.ok ? "done" : result.needsApproval ? "needs_approval" : "error",
        result.ok ? "" : result.error);

      res.status(result.ok ? 200 : result.needsApproval ? 202 : 400).json(result);
    } catch (error) { fail(res, 500, error); }
  });

  // ── Agent-to-agent messaging ────────────────────────────────────────
  app.get("/api/bots/:id/inbox", async (req, res) => {
    try {
      const bot = await findBot(String(req.params.id));
      if (!bot) { fail(res, 404, new Error("That bot no longer exists.")); return; }
      res.json({ ok: true, packets: await mailbox.inbox(bot.slug) });
    } catch (error) { fail(res, 500, error); }
  });

  app.post("/api/bots/:id/mention", async (req, res) => {
    try {
      const bot = await findBot(String(req.params.id));
      if (!bot) { fail(res, 404, new Error("That bot no longer exists.")); return; }
      const text = String(req.body?.text || "");
      const result = await mailbox.dispatchMentions({
        from: { id: bot.id, name: bot.name, slug: bot.slug, permissions: bot.permissions },
        text,
      });
      res.json({ ok: true, mentions: parseMentions(text), ...result });
    } catch (error) { fail(res, error instanceof MailboxError ? 400 : 500, error); }
  });

  app.post("/api/bots/:id/handoff/:packetId", async (req, res) => {
    try {
      const bot = await findBot(String(req.params.id));
      if (!bot) { fail(res, 404, new Error("That bot no longer exists.")); return; }
      const state = String(req.body?.state || "accepted") as never;
      const packet = await mailbox.setState(bot.slug, String(req.params.packetId), state, req.body?.result);
      if (!packet) { fail(res, 404, new Error("That handoff no longer exists.")); return; }
      res.json({ ok: true, packet });
    } catch (error) { fail(res, 500, error); }
  });

  // ── Workspace browsing (for the UI) ─────────────────────────────────
  app.get("/api/bots/:id/files", async (req, res) => {
    try {
      const bot = await findBot(String(req.params.id));
      if (!bot) { fail(res, 404, new Error("That bot no longer exists.")); return; }
      await ensureWorkspace(bot.slug);
      const target = gateway.resolvePath(
        { botId: bot.id, slug: bot.slug, permissions: bot.permissions },
        String(req.query.path || ""),
      );
      const entries = await fs.readdir(target, { withFileTypes: true });
      res.json({
        ok: true,
        root: workspaceRoot(bot.slug),
        entries: entries.map((entry) => ({ name: entry.name, directory: entry.isDirectory() })),
      });
    } catch (error) { fail(res, error instanceof WorkspaceViolationError ? 400 : 500, error); }
  });

  // ── Conversations ───────────────────────────────────────────────────
  app.get("/api/cowork/conversations", async (_req, res) => {
    try {
      const [threads, bots] = await Promise.all([conversations.list(), store.list()]);
      const byId = new Map(bots.map((bot) => [bot.id, bot]));
      res.json({
        ok: true,
        conversations: threads.map((thread) => ({
          ...thread,
          // The sidebar needs avatars and live status without a second call.
          participants: thread.botIds
            .map((id) => byId.get(id))
            .filter(Boolean)
            .map((bot) => ({ id: bot!.id, name: bot!.name, avatar: bot!.avatar, status: bot!.status })),
        })),
      });
    } catch (error) { fail(res, 500, error); }
  });

  app.post("/api/cowork/conversations", async (req, res) => {
    try {
      const botIds: string[] = Array.isArray(req.body?.botIds) ? req.body.botIds.map(String) : [];
      const bots = await store.list();
      const chosen = bots.filter((bot) => botIds.includes(bot.id));
      if (!chosen.length) { fail(res, 400, new Error("Pick at least one bot to message.")); return; }
      const isGroup = chosen.length > 1;
      const title = String(req.body?.title || "").trim()
        || (isGroup ? chosen.map((bot) => bot.name).join(", ") : chosen[0].name);
      res.json({ ok: true, conversation: await conversations.create({ botIds: chosen.map((b) => b.id), title, isGroup }) });
    } catch (error) { fail(res, error instanceof ConversationError ? 400 : 500, error); }
  });

  app.get("/api/cowork/conversations/:id", async (req, res) => {
    try {
      const thread = await conversations.get(String(req.params.id));
      if (!thread) { fail(res, 404, new Error("That conversation no longer exists.")); return; }
      await conversations.markRead(thread.id);
      const bots = await store.list();
      res.json({
        ok: true,
        conversation: thread,
        messages: await conversations.messages(thread.id),
        participants: bots.filter((bot) => thread.botIds.includes(bot.id)),
      });
    } catch (error) { fail(res, 500, error); }
  });

  app.put("/api/cowork/conversations/:id", async (req, res) => {
    try {
      const thread = await conversations.rename(String(req.params.id), String(req.body?.title || ""));
      // A rename is part of the transcript, exactly as it reads in the UI.
      await conversations.append(thread.id, {
        author: "system", botId: null, botName: null,
        text: `Renamed to ${thread.title}`, addressed: [],
      });
      res.json({ ok: true, conversation: thread });
    } catch (error) { fail(res, error instanceof ConversationError ? 400 : 500, error); }
  });

  app.delete("/api/cowork/conversations/:id", async (req, res) => {
    try {
      const removed = await conversations.remove(String(req.params.id));
      if (!removed) { fail(res, 404, new Error("That conversation no longer exists.")); return; }
      res.json({ ok: true });
    } catch (error) { fail(res, 500, error); }
  });

  /**
   * Send a message and let the addressed bots answer.
   *
   * Replies are generated sequentially so each bot sees what the previous one
   * said — that is what makes a group read like a conversation rather than
   * several bots talking past each other. A bot that @mentions a peer also
   * gets a real handoff delivered to that peer's mailbox.
   */
  app.post("/api/cowork/conversations/:id/messages", async (req, res) => {
    try {
      const thread = await conversations.get(String(req.params.id));
      if (!thread) { fail(res, 404, new Error("That conversation no longer exists.")); return; }
      const text = String(req.body?.text || "").trim();
      if (!text) { fail(res, 400, new Error("Type a message first.")); return; }

      const allBots = await store.list();
      const participants = allBots.filter((bot) => thread.botIds.includes(bot.id));
      if (!participants.length) { fail(res, 400, new Error("This conversation has no bots left in it.")); return; }

      const responders = thread.isGroup ? selectResponders(participants, text) : participants;
      await conversations.append(thread.id, {
        author: "user", botId: null, botName: null,
        text, addressed: responders.map((bot) => bot.id),
      });

      // Start a durable background job for each addressed coworker. The HTTP
      // response remains quick, while every meaningful action is checkpointed
      // and visible to the renderer through the task endpoints.
      const launched = await Promise.all(responders.map(async (bot) => {
        const task = await tasks.create({ conversationId: thread.id, botId: bot.id, title: text.slice(0, 100), objective: text });
        void runtime.run(task.id);
        return task;
      }));

      const replies = [];
      for (const bot of responders) {
        await store.setStatus(bot.id, "thinking", "Replying");
        const history = await conversations.messages(thread.id);
        const peers = participants.filter((peer) => peer.id !== bot.id);
        const result = await generateReply(bot, peers, history, thread.isGroup, { recordUsage: deps.recordUsage });

        if (!result.ok) {
          await store.setStatus(bot.id, "error", result.error || "Reply failed");
          // Surfaced in the thread rather than swallowed, so a silent bot is
          // never mistaken for a bot that had nothing to say.
          const note = await conversations.append(thread.id, {
            author: "system", botId: bot.id, botName: bot.name,
            text: `${bot.name} could not reply: ${result.error}`, addressed: [],
          });
          replies.push(note);
          continue;
        }

        const message = await conversations.append(thread.id, {
          author: "bot", botId: bot.id, botName: bot.name, text: result.text, addressed: [],
        });
        replies.push(message);
        await store.setStatus(bot.id, "done", "");

        // A bot addressing a peer produces a real handoff packet, not just
        // text, so the work is tracked in the peer's mailbox too.
        if (thread.isGroup) {
          await mailbox.dispatchMentions({
            from: { id: bot.id, name: bot.name, slug: bot.slug, permissions: bot.permissions },
            text: result.text,
          }).catch(() => undefined);
        }
      }

      res.json({ ok: true, messages: await conversations.messages(thread.id), replies, tasks: launched });
    } catch (error) { fail(res, 500, error); }
  });

  return { store, gateway, mailbox, conversations, normalisePermissions };
}

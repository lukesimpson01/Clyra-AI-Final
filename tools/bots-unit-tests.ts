/**
 * Clyra Cowork: store, permissions, capability gateway and mailbox.
 *
 * The emphasis is on the guarantees that matter if an agent goes wrong:
 * ungranted capabilities are unavailable, consequential actions cannot run
 * unapproved, credentials never reach a log, and one bot cannot read or
 * share another bot's files.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(tmpdir(), "clyra-cowork-"));
process.env.CLYRA_DATA_ROOT = root;

const { BotStore, BotValidationError } = await import("../lib/bots/store");
const {
  checkPermission, defaultPermissions, normalisePermissions, canMessage, approvalFor,
} = await import("../lib/bots/permissions");
const { CapabilityGateway, redact } = await import("../lib/bots/capability-gateway");
const { AgentMailbox, parseMentions, MailboxError } = await import("../lib/bots/mailbox");
const { workspaceRoot } = await import("../lib/bots/workspace");

let assertions = 0;
const check = (value: unknown, message: string) => { assert.ok(value, message); assertions += 1; };

try {
  // ── Store ───────────────────────────────────────────────────────────
  const store = new BotStore(path.join(root, "registry"));
  check((await store.list()).length === 0, "a new install has no bots");

  const coder = await store.create({ name: "Coder", role: "Developer", instructions: "Write code.", avatar: "🛠" });
  check(coder.slug === "Coder", "the slug follows the name");
  check(coder.status === "idle", "a new bot starts idle");
  check(coder.permissions.granted.includes("web_search"), "defaults grant research-shaped tools");
  check(!coder.permissions.granted.includes("terminal"), "defaults do NOT grant the terminal");
  check(coder.permissions.canMessage === "none", "a new bot cannot message others by default");

  await assert.rejects(() => store.create({ name: "Coder" }), BotValidationError, "duplicate folder names are refused");
  assertions += 1;
  await assert.rejects(() => store.create({}), BotValidationError, "a nameless bot is refused");
  assertions += 1;
  await assert.rejects(() => store.create({ name: ".." }), Error, "a traversal name is refused");
  assertions += 1;

  const researcher = await store.create({
    name: "Researcher", role: "Research",
    permissions: { granted: ["web_search", "files", "terminal"], canMessage: "all" },
  });

  // Slug is frozen so the workspace on disk is never orphaned by a rename.
  const renamed = await store.update(coder.id, { name: "Coder Prime" });
  check(renamed.slug === "Coder", "renaming a bot keeps its workspace slug");
  check(renamed.name === "Coder Prime", "the display name does change");
  check(renamed.createdAt === coder.createdAt, "createdAt is preserved");

  const busy = await store.setStatus(coder.id, "coding", "Fixing login");
  check(busy?.status === "coding" && busy.statusDetail === "Fixing login", "status and detail persist");
  check(Boolean(busy?.lastActiveAt), "activity timestamps update");

  check((await new BotStore(path.join(root, "registry")).get(coder.id))?.name === "Coder Prime",
    "bots survive a fresh store instance");

  // Corrupt registry must not stop Cowork opening.
  await writeFile(path.join(root, "registry", "bots.json"), "{{{ not json", "utf8");
  check((await new BotStore(path.join(root, "registry")).list()).length === 0, "a corrupt registry reads as empty");

  // ── Permissions ─────────────────────────────────────────────────────
  const perms = normalisePermissions({ granted: ["terminal", "browser", "nonsense"], canMessage: ["bot-1"] });
  check(!perms.granted.includes("nonsense" as never), "unknown capabilities are dropped");
  check(perms.granted.length === 2, "only real capabilities survive");

  const denied = checkPermission(perms, "computer_control");
  check(denied.allowed === false, "an ungranted capability is unavailable, not merely gated");

  const terminalUse = checkPermission(perms, "terminal");
  check(terminalUse.allowed && terminalUse.requiresApproval, "the terminal asks by default");
  check(approvalFor(perms, "browser") === "never_ask", "browsing does not nag by default");

  // Silencing a capability must not silence a destructive action.
  const silenced = normalisePermissions({ granted: ["terminal"], approvals: { terminal: "never_ask" } });
  const quiet = checkPermission(silenced, "terminal");
  check(quiet.allowed && !quiet.requiresApproval, "an ordinary terminal call is silent once allowed");
  const destructive = checkPermission(silenced, "terminal", "destructive_command");
  check(destructive.allowed && destructive.requiresApproval,
    "a destructive command still needs approval even when the capability is silenced");

  check(canMessage(normalisePermissions({ canMessage: "all" }), "anyone"), "'all' can message anyone");
  check(!canMessage(defaultPermissions(), "anyone"), "'none' can message nobody");

  // ── Redaction ───────────────────────────────────────────────────────
  const cleaned = redact({ apiKey: "sk-live-123", nested: { authorization: "Bearer x", safe: "keep" } }) as any;
  check(cleaned.apiKey === "[redacted]", "an api key is redacted");
  check(cleaned.nested.authorization === "[redacted]", "nested credentials are redacted");
  check(cleaned.nested.safe === "keep", "ordinary values survive redaction");

  // ── Capability gateway ──────────────────────────────────────────────
  const gateway = new CapabilityGateway();
  let ran = 0;
  gateway.register("terminal", async (input) => { ran += 1; return { echoed: input.command }; });
  gateway.register("files", async () => "file contents");

  const ctx = { botId: coder.id, slug: "Coder", permissions: silenced };

  const missingHandler = await gateway.call({ capability: "browser", input: {} }, ctx);
  check(!missingHandler.ok, "an unregistered capability fails rather than silently passing");

  const ungranted = await gateway.call({ capability: "files", input: {} }, ctx);
  check(!ungranted.ok && ungranted.log.outcome === "denied", "an ungranted capability is denied and logged");
  check(ran === 0, "a denied call never reaches the handler");

  const ok = await gateway.call({ capability: "terminal", input: { command: "ls" } }, ctx);
  check(ok.ok && ran === 1, "a granted, non-consequential call runs");

  const gated = await gateway.call(
    { capability: "terminal", action: "destructive_command", input: { command: "rm -rf /" } }, ctx);
  check(!gated.ok && gated.needsApproval === true, "a destructive call is held for approval");
  check(ran === 1, "a call awaiting approval does not execute");

  const approvedRun = await gateway.call(
    { capability: "terminal", action: "destructive_command", input: { command: "rm -rf build" } },
    { ...ctx, approved: true });
  check(approvedRun.ok && ran === 2, "the same call runs once approved");

  // Secrets in tool input must not survive into the execution log.
  await gateway.call({ capability: "terminal", input: { command: "deploy", api_key: "sk-secret" } }, ctx);
  const logged = gateway.recentLog(coder.id).at(-1);
  check(logged?.input.api_key === "[redacted]", "the execution log never stores a credential");
  check(JSON.stringify(gateway.recentLog()).includes("sk-secret") === false, "no secret appears anywhere in the log");

  // A handler throwing a workspace violation surfaces as a clean error.
  gateway.register("files", async (input, context) => gateway.resolvePath(context, String(input.path)));
  const escaping = await gateway.call(
    { capability: "files", input: { path: "../../etc/passwd" } },
    { ...ctx, permissions: normalisePermissions({ granted: ["files"] }) });
  check(!escaping.ok && /outside this bot's workspace/i.test(escaping.error), "path escapes are refused at the gateway");

  // ── Mentions ────────────────────────────────────────────────────────
  check(parseMentions("@Coder fix it").join() === "Coder", "a leading mention parses");
  check(parseMentions("ask @Researcher and @Writer").length === 2, "multiple mentions parse");
  check(parseMentions("mail me at hi@example.com").length === 0, "an email address is not a mention");
  check(parseMentions("no mentions here").length === 0, "plain text yields nothing");

  // ── Mailbox ─────────────────────────────────────────────────────────
  const directory = new Map([
    ["Coder", { id: coder.id, name: "Coder Prime", slug: "Coder" }],
    ["Researcher", { id: researcher.id, name: "Researcher", slug: "Researcher" }],
  ]);
  const mailbox = new AgentMailbox({ resolveName: async (name) => directory.get(name) ?? null });

  const senderNoPerms = { id: coder.id, name: "Coder", slug: "Coder", permissions: defaultPermissions() };
  await assert.rejects(
    () => mailbox.send({ from: senderNoPerms, toBotId: researcher.id, toSlug: "Researcher", task: "help" }),
    MailboxError, "a bot without messaging permission cannot hand off");
  assertions += 1;

  const sender = { id: researcher.id, name: "Researcher", slug: "Researcher", permissions: normalisePermissions({ granted: ["files"], canMessage: "all" }) };
  await assert.rejects(
    () => mailbox.send({ from: sender, toBotId: researcher.id, toSlug: "Researcher", task: "self" }),
    MailboxError, "a bot cannot hand off to itself");
  assertions += 1;

  // Attachments are validated against the SENDER's workspace.
  await assert.rejects(
    () => mailbox.send({
      from: sender, toBotId: coder.id, toSlug: "Coder", task: "review",
      attachments: [path.join(workspaceRoot("Coder"), "files", "private.txt")],
    }),
    Error, "a bot cannot attach a file from another bot's workspace");
  assertions += 1;

  const packet = await mailbox.send({
    from: sender, toBotId: coder.id, toSlug: "Coder",
    task: "Review the findings", context: "Competitor analysis done.",
    attachments: ["files/report.md"], expectedResult: "A summary.",
  });
  check(packet.state === "queued", "a new handoff is queued");

  const inbox = await mailbox.inbox("Coder");
  check(inbox.length === 1 && inbox[0].task === "Review the findings", "the handoff lands in the receiver's inbox");
  check(inbox[0].attachments[0] === "files/report.md", "explicitly shared attachments carry across");

  const done = await mailbox.setState("Coder", packet.id, "completed", "Summary: looks good.");
  check(done?.state === "completed" && done.result?.includes("looks good"), "a handoff can be completed with a result");

  // Inboxes are per-bot files, so the sender's own inbox stays empty.
  check((await mailbox.inbox("Researcher")).length === 0, "a handoff does not appear in the sender's inbox");

  const dispatch = await mailbox.dispatchMentions({ from: sender, text: "@Coder please fix, cc @Nobody" });
  check(dispatch.sent.length === 1, "a known mention produces one handoff");
  check(dispatch.unknown.includes("Nobody"), "an unknown mention is reported, not silently dropped");

  // Mailbox files live inside the bot's own workspace.
  const mailboxFile = path.join(workspaceRoot("Coder"), "logs", "mailbox.json");
  check(JSON.parse(await readFile(mailboxFile, "utf8")).length >= 1, "the mailbox persists in the bot's workspace");

  console.log(`bots-unit-tests: ${assertions} assertions passed`);
} finally {
  await rm(root, { recursive: true, force: true });
}

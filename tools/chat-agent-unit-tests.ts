/** Chat agent: evidence engine and tool loop. A scripted model drives the loop; the retrieval pieces are exercised for real. */
import assert from "node:assert/strict";
import { EvidenceLedger, canonicalUrl, extractReadable, findInSource, fuseRankings, openPage, rankPassages, splitPassages, validateCitations } from "../lib/chat-agent/web-engine";
import { runChatAgent, type AgentEvent, type ModelCall } from "../lib/chat-agent/agent";
import { parsePublicRepo, isSafePublicCodePath, inspectPublicGitHubRepo, readPublicGitHubFile } from "../lib/chat-agent/github-reader";

const results: string[] = [];
const test = async (name: string, fn: () => unknown | Promise<unknown>) => { await fn(); results.push(name); };

await test("canonical urls drop tracking, www, fragments", () => {
  assert.equal(canonicalUrl("https://www.Example.com/a/?utm_source=x&id=2#top"), "https://example.com/a?id=2");
});

await test("rank fusion rewards agreement, not provider score scale", () => {
  const fused = fuseRankings([
    { provider: "a", hits: [{ url: "https://x.com/1", title: "1", snippet: "" }, { url: "https://y.com/2", title: "2", snippet: "" }] },
    { provider: "b", hits: [{ url: "https://y.com/2?utm_source=z", title: "2", snippet: "" }, { url: "https://z.com/3", title: "3", snippet: "" }] },
  ]);
  assert.equal(canonicalUrl(fused[0].url), "https://y.com/2");
  assert.deepEqual(fused[0].providers.sort(), ["a", "b"]);
});

const html = `<html><head><title>Release 4.2 notes</title><meta property="article:published_time" content="2026-09-01"></head><body>
<nav>Home About</nav><article><h1>Release 4.2</h1><p>Version 4.2 requires at least 8 GB of RAM and a 64-bit processor for the desktop build to run correctly.</p>
<h2>Pricing</h2><p>The Pro plan costs 12 dollars per month, billed annually, and includes priority support for every seat on the account.</p>
<p>See the <a href="https://example.org/spec">full specification</a> for details about supported platforms and memory.</p></article><footer>copyright</footer><script>alert(1)</script></body></html>`;

await test("extracts readable text, title, date and links; drops chrome and scripts", () => {
  const out = extractReadable(html, "https://example.com/r");
  assert.equal(out.title, "Release 4.2 notes");
  assert.equal(out.publishedAt, "2026-09-01");
  assert.ok(out.text.includes("8 GB of RAM"));
  assert.ok(!out.text.includes("alert(1)") && !out.text.includes("copyright"));
  assert.equal(out.links[0].url, "https://example.org/spec");
});

await test("passages carry headings and BM25 finds the answering one", () => {
  const out = extractReadable(html, "https://example.com/r");
  const passages = splitPassages(out.text);
  const best = rankPassages(passages, "minimum RAM requirement")[0];
  assert.ok(best.text.includes("8 GB"));
  const price = rankPassages(passages, "how much does Pro cost per month")[0];
  assert.equal(price.heading, "Pricing");
});

await test("only authorised addresses are fetched; private networks are refused", async () => {
  const ledger = new EvidenceLedger();
  const invented = await openPage(ledger, "https://made-up-by-model.example/page");
  assert.equal(invented.ok, false);
  ledger.allowUserUrls("look at http://127.0.0.1:3000/api/secrets and http://169.254.169.254/latest/meta-data");
  for (const url of ["http://127.0.0.1:3000/api/secrets", "http://169.254.169.254/latest/meta-data", "http://localhost/x"]) {
    const result = await openPage(ledger, url);
    assert.equal(result.ok, false, url);
  }
  const bad = await openPage(ledger, "file:///etc/passwd");
  assert.equal(bad.ok, false);
});

await test("citations: unknown markers are removed, cited list is exact", () => {
  const ledger = new EvidenceLedger();
  ledger.sources.set("S1", { id: "S1" } as never);
  const out = validateCitations("A [S1] and B [S7] and C [S1].", ledger);
  assert.equal(out.text, "A [S1] and B and C [S1].");
  assert.deepEqual(out.cited, ["S1"]);
  assert.deepEqual(out.invalid, ["S7"]);
});

await test("find works inside an opened source without refetching", () => {
  const ledger = new EvidenceLedger();
  const out = extractReadable(html, "https://example.com/r");
  ledger.sources.set("S1", { id: "S1", title: out.title, finalUrl: "https://example.com/r", passages: splitPassages(out.text) } as never);
  const found = findInSource(ledger, "S1", ["RAM"], "pro plan price");
  assert.ok(found.ok && found.matches.length >= 2);
  assert.equal(findInSource(ledger, "S9", ["x"]).ok, false);
});

await test("public GitHub reader validates the domain and blocks credential files", () => {
  assert.equal(parsePublicRepo("https://github.com/example/repo/tree/main")?.fullName, "example/repo");
  assert.equal(parsePublicRepo("example/repo")?.fullName, "example/repo");
  assert.equal(parsePublicRepo("https://github.com.evil.example/example/repo"), null);
  assert.equal(parsePublicRepo("https://evil.example/example/repo"), null);
  assert.equal(parsePublicRepo("example/../repo"), null);
  assert.equal(isSafePublicCodePath("src/App.tsx"), true);
  assert.equal(isSafePublicCodePath(".chromium-google-profile/Default/Cookies"), false);
  assert.equal(isSafePublicCodePath("playwright/.auth/session.json"), false);
  assert.equal(isSafePublicCodePath("../.env"), false);
});

await test("GitHub tool retrieves actual metadata and line-numbered source, never fabricated text", async () => {
  const originalFetch = globalThis.fetch;
  const visited: string[] = [];
  try {
    globalThis.fetch = async (input) => {
      const url = String(input);
      visited.push(url);
      const payload = url.endsWith("/repos/example/repo")
        ? { full_name: "example/repo", html_url: "https://github.com/example/repo", description: "Example", default_branch: "main", updated_at: "2026-10-01T00:00:00Z", private: false, archived: false, size: 200 }
        : url.includes("/git/trees/main")
          ? { tree: [{ path: "README.md", type: "blob" }, { path: "src/chat.ts", type: "blob" }, { path: ".chromium-google-profile/Default/Cookies", type: "blob" }], truncated: false }
          : { type: "file", name: "chat.ts", path: "src/chat.ts", sha: "abc123", size: 14, encoding: "base64", content: Buffer.from("hello\nworld\n").toString("base64"), html_url: "https://github.com/example/repo/blob/main/src/chat.ts" };
      return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
    };
    const info = await inspectPublicGitHubRepo("example/repo", "chat");
    assert.deepEqual(info.matchingPaths, ["src/chat.ts"]);
    assert.equal(info.totalPublicReadableFiles, 2);
    const file = await readPublicGitHubFile("example/repo", "src/chat.ts");
    assert.ok(file.content.includes("1: hello") && file.content.includes("2: world"));
    assert.ok(visited.every((url) => url.startsWith("https://api.github.com/")));
  } finally { globalThis.fetch = originalFetch; }
});

/* ----- the loop, driven by a scripted model ----- */
const script = (rounds: Array<{ text?: string; calls?: Array<{ name: string; args: unknown }> }>): ModelCall => {
  let i = 0;
  return async ({ onText }) => {
    const round = rounds[Math.min(i, rounds.length - 1)];
    i += 1;
    if (round.text) onText(round.text);
    return { content: round.text ?? "", toolCalls: (round.calls ?? []).map((c, n) => ({ id: `c${i}-${n}`, type: "function" as const, function: { name: c.name, arguments: JSON.stringify(c.args) } })) };
  };
};

await test("a plain message runs no tools and emits just the answer", async () => {
  const events: AgentEvent[] = [];
  await runChatAgent([{ role: "user", content: "hey" }], { createNote: () => ({ id: "n", title: "t" }), callModel: script([{ text: "Hey! What's up?" }]) }, (e) => events.push(e));
  assert.deepEqual(events.map((e) => e.type), ["text", "done"]);
  assert.equal((events[1] as Extract<AgentEvent, { type: "done" }>).text, "Hey! What's up?");
});

await test("todos, steps, note creation and unknown citations flow through in order", async () => {
  const events: AgentEvent[] = [];
  const notes: Array<{ title: string; markdown: string }> = [];
  await runChatAgent(
    [{ role: "user", content: "make a doc about X" }],
    {
      createNote: (n) => { notes.push(n); return { id: "page-1", title: n.title }; },
      callModel: script([
        { calls: [{ name: "update_todos", args: { todos: [{ content: "Write the note", status: "in_progress" }] } }] },
        { calls: [{ name: "create_note", args: { title: "About X", markdown: "# X\n\nFact [S3]." } }] },
        { calls: [{ name: "update_todos", args: { todos: [{ content: "Write the note", status: "completed" }] } }] },
        { text: "I made a note about X [S4]." },
      ]),
    },
    (e) => events.push(e),
  );
  const types = events.map((e) => e.type);
  assert.deepEqual(types.slice(0, 1), ["todos"]);
  const steps = events.filter((e): e is Extract<AgentEvent, { type: "step" }> => e.type === "step");
  assert.deepEqual(steps.map((s) => s.state), ["running", "done"]);
  assert.equal(steps[1].document?.id, "page-1");
  assert.ok(!notes[0].markdown.includes("[S3]"), "an unread source cannot be cited in a note");
  const done = events[events.length - 1] as Extract<AgentEvent, { type: "done" }>;
  assert.equal(done.text, "I made a note about X.");
  assert.deepEqual(done.citations, []);
});

await test("a model that asks for an invented url is refused and the failure is reported", async () => {
  const events: AgentEvent[] = [];
  await runChatAgent([{ role: "user", content: "read it" }], { createNote: () => ({ id: "n", title: "t" }), callModel: script([{ calls: [{ name: "web_open", args: { url: "https://invented.example/x" } }] }, { text: "I couldn't open that." }]) }, (e) => events.push(e));
  const steps = events.filter((e): e is Extract<AgentEvent, { type: "step" }> => e.type === "step");
  assert.equal(steps[steps.length - 1].state, "failed");
});

await test("credits exhaustion becomes a credits error, cancellation stops the loop", async () => {
  const { CreditsError } = await import("../lib/chat-agent/agent");
  const events: AgentEvent[] = [];
  await runChatAgent([{ role: "user", content: "hi" }], { createNote: () => ({ id: "n", title: "t" }), callModel: async () => { throw new CreditsError("credits"); } }, (e) => events.push(e));
  assert.deepEqual(events.map((e) => (e as { code?: string }).code ?? e.type), ["credits"]);
  const controller = new AbortController();
  controller.abort();
  const stopped: AgentEvent[] = [];
  await runChatAgent([{ role: "user", content: "hi" }], { createNote: () => ({ id: "n", title: "t" }), callModel: script([{ text: "x" }]) }, (e) => stopped.push(e), { signal: controller.signal });
  assert.equal((stopped[0] as { code?: string }).code, "cancelled");
});

await test("unfinished tasks trigger a continuation instead of premature completion", async () => {
  const events: AgentEvent[] = [];
  let calls = 0;
  await runChatAgent(
    [{ role: "user", content: "write two sections" }],
    {
      createNote: () => ({ id: "n", title: "t" }),
      callModel: async ({ messages }) => {
        calls += 1;
        if (calls === 1) return { content: "", toolCalls: [{ id: "t1", type: "function", function: { name: "update_todos", arguments: JSON.stringify({ todos: [{ content: "Finish second section", status: "in_progress" }] }) } }] };
        if (calls === 2) return { content: "Done", toolCalls: [] };
        assert.ok(messages.some((message) => message.role === "user" && typeof message.content === "string" && message.content.includes("not finished yet")));
        if (calls === 3) return { content: "", toolCalls: [{ id: "t2", type: "function", function: { name: "update_todos", arguments: JSON.stringify({ todos: [{ content: "Finish second section", status: "completed" }] }) } }] };
        return { content: "Both sections are complete.", toolCalls: [] };
      },
    },
    (event) => events.push(event),
  );
  assert.equal(calls, 4, "model should be given a chance to complete its work");
  const result = events.find((event): event is Extract<AgentEvent, { type: "done" }> => event.type === "done");
  assert.equal(result?.text, "Both sections are complete.");
  assert.equal(result?.diagnostics.completionStatus, "no_known_blockers");
  assert.equal(result?.diagnostics.completionRetries, 1);
});

await test("unresolved tool failure and pending checklist are clearly marked incomplete", async () => {
  const events: AgentEvent[] = [];
  await runChatAgent(
    [{ role: "user", content: "inspect my project" }],
    {
      createNote: () => ({ id: "n", title: "t" }),
      nativeTools: [{ id: "git.status", name: "Git status", description: "Read git status", riskLevel: "safe", inputSchema: { type: "object" } }],
      invokeNativeTool: async () => ({ ok: false, error: { code: "TOOL_CRASH", message: "No repository at this location." } }),
      callModel: script([
        { calls: [{ name: "update_todos", args: { todos: [{ content: "Inspect repository", status: "in_progress" }] } }] },
        { calls: [{ name: "clyra_git_status", args: {} }] },
        { text: "I inspected the repository." },
      ]),
    },
    (event) => events.push(event),
    { maxSteps: 5 },
  );
  const result = events.find((event): event is Extract<AgentEvent, { type: "done" }> => event.type === "done");
  assert.ok(result?.text.includes("Not fully completed"));
  assert.equal(result?.diagnostics.completionStatus, "incomplete");
  assert.equal((result?.diagnostics.unresolvedToolFailures as unknown[])?.length, 1);
});

await test("only safe registered native capabilities reach DeepSeek and results generate real tool events", async () => {
  const events: AgentEvent[] = [];
  let invoked = "";
  let modelRound = 0;
  await runChatAgent(
    [{ role: "user", content: "what is the git status?" }],
    {
      createNote: () => ({ id: "n", title: "t" }),
      nativeTools: [
        { id: "git.status", name: "Git status", description: "Read status", riskLevel: "safe", inputSchema: { type: "object" } },
        { id: "files.delete", name: "Delete files", description: "Delete", riskLevel: "sensitive", inputSchema: { type: "object" } },
      ],
      invokeNativeTool: async (id) => { invoked = id; return { ok: true, data: { output: "main clean" }, evidence: [{ kind: "log", value: "git status" }] }; },
      callModel: async ({ tools }) => {
        const names = (tools as Array<{ function?: { name: string } }>).map((tool) => tool.function?.name);
        assert.ok(names.includes("clyra_git_status"));
        assert.ok(!names.includes("clyra_files_delete"));
        modelRound += 1;
        return modelRound === 1
          ? { content: "", toolCalls: [{ id: "git1", type: "function", function: { name: "clyra_git_status", arguments: "{}" } }] }
          : { content: "The working tree is clean.", toolCalls: [] };
      },
    },
    (event) => events.push(event),
  );
  assert.equal(invoked, "git.status");
  const step = events.find((event): event is Extract<AgentEvent, { type: "step" }> => event.type === "step" && event.state === "done");
  assert.equal(step?.tool, "git.status");
  assert.equal(step?.detail, "Verified by Clyra");
});

console.log(JSON.stringify({ passed: results.length, tests: results }, null, 1));

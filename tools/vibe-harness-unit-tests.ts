import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { AgentStateMachine } from "../lib/vibe-coder/runtime/state-machine";
import { inferProjectIntent, requestsIosProject } from "../lib/vibe-coder/runtime/ios-intent";
import { classifyCommand, PermissionService } from "../lib/vibe-coder/runtime/permission-service";
import { HarnessWorkspaceRuntime } from "../lib/vibe-coder/runtime/harness-runtime";
import type { AgentEvent } from "../lib/vibe-coder/runtime/types";
import { prepareIosAgentWorkspace, seedIosStarterIfEmpty } from "../lib/opencode/opencode-routes";

function sse(res: import("node:http").ServerResponse, values: unknown[]) {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const value of values) res.write(`data: ${JSON.stringify(value)}\n\n`);
  res.end("data: [DONE]\n\n");
}

async function main() {
  assert.equal(inferProjectIntent("Give this website an iOS theme"), "unspecified");
  assert.equal(inferProjectIntent("Give this website an iOS theme", "web-app"), "web-app");
  assert.equal(requestsIosProject("Build a native iOS app in SwiftUI"), true);
  assert.equal(requestsIosProject("Use an iOS-inspired design for this React app"), false);
  assert.equal(classifyCommand("npm run build"), "moderate");
  assert.equal(classifyCommand("rm -rf ."), "dangerous");

  const machine = new AgentStateMachine();
  machine.transition("PREPARING"); machine.transition("OBSERVING"); machine.transition("EDITING"); machine.transition("VERIFYING"); machine.transition("COMPLETED");
  assert.equal(machine.state, "COMPLETED");
  assert.throws(() => new AgentStateMachine().transition("EDITING"), /Invalid agent transition/);

  // Preserve and verify the real SwiftUI project-generation path. A true iOS
  // app request creates compilable Swift package metadata, multiple source
  // files, repository instructions, and the installed Apple-agent skills.
  const iosRoot = await mkdtemp(path.join(os.tmpdir(), "clyra-ios-fixture-"));
  await prepareIosAgentWorkspace(iosRoot);
  await seedIosStarterIfEmpty(iosRoot, "Build a native iOS SwiftUI app called Orbit Notes");
  const iosFiles = await readdir(iosRoot, { recursive: true });
  assert(iosFiles.includes("Package.swift"));
  assert(iosFiles.includes("AGENTS.md"));
  assert(iosFiles.filter((file) => file.endsWith(".swift")).length >= 4);
  assert(iosFiles.some((file) => file.endsWith("SKILL.md")));
  execFileSync("swift", ["package", "dump-package"], { cwd: iosRoot, stdio: ["ignore", "ignore", "inherit"] });

  let requestCount = 0;
  const server = createServer((req, res) => {
    if (req.method !== "POST") { res.writeHead(404).end(); return; }
    req.resume();
    req.on("end", () => {
      requestCount += 1;
      if (requestCount === 1) {
        sse(res, [
          { choices: [{ delta: { tool_calls: [{ index: 0, id: "write-1", function: { name: "write", arguments: '{"file_path":"hello.txt","content":"hello from harness\\n"}' } }] }, finish_reason: null }] },
          { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
          { choices: [], usage: { prompt_tokens: 12, completion_tokens: 8 } },
        ]);
      } else {
        sse(res, [
          { choices: [{ delta: { content: "Implemented and verified the file change." }, finish_reason: null }] },
          { choices: [{ delta: {}, finish_reason: "stop" }] },
          { choices: [], usage: { prompt_tokens: 18, completion_tokens: 7 } },
        ]);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  const oldBase = process.env.MY_LLM_BASE_URL;
  const oldKey = process.env.MY_LLM_API_KEY;
  const oldModel = process.env.MY_LLM_MODEL;
  process.env.MY_LLM_BASE_URL = `http://127.0.0.1:${address.port}`;
  process.env.MY_LLM_API_KEY = "test-existing-provider-key";
  process.env.MY_LLM_MODEL = "test-model";

  const root = await mkdtemp(path.join(os.tmpdir(), "clyra-harness-"));
  execFileSync("git", ["init", "--initial-branch=main"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@clyra.local"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Clyra Test"], { cwd: root });
  await writeFile(path.join(root, "README.md"), "# Fixture\n");
  await symlink(os.tmpdir(), path.join(root, "outside-link"));
  const permissions = new PermissionService(root);
  assert.equal((await permissions.decide({ name: "write", arguments: { file_path: "outside-link/escaped.txt" } } as never)).kind, "deny");
  assert.equal((await permissions.decide({ name: "bash", arguments: { command: "rm -rf ." } } as never)).kind, "ask");
  execFileSync("git", ["add", "README.md"], { cwd: root });
  execFileSync("git", ["commit", "-m", "baseline"], { cwd: root, stdio: "ignore" });

  const runtime = new HarnessWorkspaceRuntime("fixture", root);
  const events: AgentEvent[] = [];
  await runtime.start();
  const dispose = runtime.subscribe((event) => events.push(event));
  const session = await runtime.createSession("Write a fixture");
  const finished = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Harness integration timed out")), 15_000);
    const off = runtime.subscribe((event) => {
      if (event.type === "run.completed") { clearTimeout(timeout); off(); resolve(); }
      if (event.type === "run.failed") { clearTimeout(timeout); off(); reject(new Error(event.error)); }
    });
  });
  await runtime.prompt(session.id, "Create hello.txt with a short greeting.");
  await finished;
  assert.equal(await readFile(path.join(root, "hello.txt"), "utf8"), "hello from harness\n");
  assert(events.some((event) => event.type === "tool.started" && event.tool === "write"));
  assert(events.some((event) => event.type === "tool.completed"));
  assert(events.some((event) => event.type === "message.delta"));
  assert(events.some((event) => event.type === "run.completed"));
  assert.equal(requestCount, 2);
  assert((await runtime.checkpoints()).length >= 1);

  dispose();
  await runtime.stop();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (oldBase === undefined) delete process.env.MY_LLM_BASE_URL; else process.env.MY_LLM_BASE_URL = oldBase;
  if (oldKey === undefined) delete process.env.MY_LLM_API_KEY; else process.env.MY_LLM_API_KEY = oldKey;
  if (oldModel === undefined) delete process.env.MY_LLM_MODEL; else process.env.MY_LLM_MODEL = oldModel;
  console.log("vibe-harness-unit-tests: ok");
}

await main();

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ensureComponentMcpConfig } from "../lib/clyra-code/component-library";

const root = await mkdtemp(path.join(tmpdir(), "clyra-component-mcp-"));
const original = process.env.API_KEY_21ST;
try {
  delete process.env.API_KEY_21ST;
  await ensureComponentMcpConfig(root);
  let config = JSON.parse(await readFile(path.join(root, "opencode.json"), "utf8"));
  assert.deepEqual(config.mcp.servers.shadcn.command, ["npx", "-y", "shadcn@latest", "mcp"]);
  assert.equal(config.mcp.servers["21st"].disabled, true);
  assert.equal(config.mcp.servers["21st"].headers["x-api-key"], "{env:API_KEY_21ST}");
  assert.ok(!JSON.stringify(config).includes("test-secret"));

  process.env.API_KEY_21ST = "test-secret";
  await ensureComponentMcpConfig(root);
  config = JSON.parse(await readFile(path.join(root, "opencode.json"), "utf8"));
  assert.equal(config.mcp.servers["21st"].disabled, false);
  assert.ok(!JSON.stringify(config).includes("test-secret"), "secret must never be serialised");

  await writeFile(path.join(root, "opencode.json"), JSON.stringify({
    model: "deepseek/example", mcp: { servers: { internal: { type: "remote", url: "https://example.test/mcp" } } },
  }), "utf8");
  await ensureComponentMcpConfig(root);
  config = JSON.parse(await readFile(path.join(root, "opencode.json"), "utf8"));
  assert.equal(config.model, "deepseek/example");
  assert.equal(config.mcp.servers.internal.url, "https://example.test/mcp");
  assert.equal(Object.keys(config.mcp.servers).length, 3);

  await writeFile(path.join(root, "opencode.json"), "{not-json}", "utf8");
  await assert.rejects(ensureComponentMcpConfig(root), SyntaxError);
  assert.equal(await readFile(path.join(root, "opencode.json"), "utf8"), "{not-json}", "must not overwrite invalid user config");
  console.log("Component MCP configuration and credentials: PASS");
} finally {
  if (original === undefined) delete process.env.API_KEY_21ST;
  else process.env.API_KEY_21ST = original;
  await rm(root, { recursive: true, force: true });
}

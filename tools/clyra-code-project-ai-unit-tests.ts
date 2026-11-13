import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createProjectAiToken, isDotenvPath, readProjectAiConfig, restoreMaskedDotenv, verifyProjectAiToken, writeProjectEnv } from "../lib/clyra-code/security/project-ai";
import { sanitizeToolOutputForModel } from "../lib/clyra-code/security/environment";

let passed = 0;
async function test(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`PASS  ${name}`);
}

const SECRET_KEY = "sk-test-deepseek-1234567890abcdef";
const env = { DEEPSEEK_API_KEY: SECRET_KEY } as NodeJS.ProcessEnv;

await test("a project token verifies for its own project only and never contains the model key", () => {
  const token = createProjectAiToken("proj-1", env)!;
  assert.ok(token.startsWith("clyra_ai_proj-1."));
  assert.ok(!token.includes(SECRET_KEY) && !token.includes("1234567890abcdef"));
  assert.equal(verifyProjectAiToken(token, env), "proj-1");
  assert.equal(verifyProjectAiToken(token.replace("proj-1", "proj-2"), env), null);
  assert.equal(verifyProjectAiToken(`${token}x`, env), null);
  assert.equal(verifyProjectAiToken("sk-anything", env), null);
});

await test("no token can be minted when the server has no key", () => {
  assert.equal(createProjectAiToken("proj-1", {} as NodeJS.ProcessEnv), null);
});

await test("the project env file gets the proxy address and token, merged with existing lines, and no model key", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "clyra-ai-test-"));
  try {
    await writeProjectEnv(dir, { FOO: "bar" });
    const token = createProjectAiToken("proj-1", env)!;
    await writeProjectEnv(dir, { OPENAI_BASE_URL: "http://localhost:3000/api/clyra-ai/v1", OPENAI_API_KEY: token });
    await writeProjectEnv(dir, { OPENAI_API_KEY: token });
    const text = await readFile(path.join(dir, ".env.local"), "utf8");
    assert.match(text, /^FOO=bar$/m);
    assert.equal((text.match(/^OPENAI_API_KEY=/gm) ?? []).length, 1);
    assert.ok(!text.includes(SECRET_KEY));
    assert.deepEqual(await readProjectAiConfig(dir, env), { mode: "clyra", hasKey: true });
    await writeProjectEnv(dir, { OPENAI_API_KEY: "sk-user-own-key-123456" });
    assert.deepEqual(await readProjectAiConfig(dir, env), { mode: "own", hasKey: true });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

await test("switching to the user's own key drops the Clyra proxy address so the key is never sent to it", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "clyra-ai-test-"));
  try {
    const token = createProjectAiToken("proj-1", env)!;
    await writeProjectEnv(dir, { FOO: "bar", CLYRA_AI_BASE_URL: "http://localhost:3000/api/clyra-ai/v1", OPENAI_BASE_URL: "http://localhost:3000/api/clyra-ai/v1", OPENAI_API_BASE: "http://localhost:3000/api/clyra-ai/v1", OPENAI_API_KEY: token, CLYRA_AI_MODEL: "m" });
    await writeProjectEnv(dir, { OPENAI_API_KEY: "sk-user-own-key-123456" }, ["CLYRA_AI_BASE_URL", "CLYRA_AI_MODEL", "OPENAI_BASE_URL", "OPENAI_API_BASE"]);
    const text = await readFile(path.join(dir, ".env.local"), "utf8");
    assert.match(text, /^FOO=bar$/m);
    assert.match(text, /^OPENAI_API_KEY=sk-user-own-key-123456$/m);
    assert.ok(!/CLYRA_AI_|OPENAI_BASE_URL|OPENAI_API_BASE|clyra-ai/.test(text));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

await test("env files shown in the Files workbench are masked, including the user's own key and the model key", () => {
  const shown = sanitizeToolOutputForModel(`OPENAI_API_KEY=sk-user-own-key-123456\nCLYRA_AI_BASE_URL=http://localhost:3000/api/clyra-ai/v1\nNOTE=${SECRET_KEY}\n`, env);
  assert.ok(!shown.includes("sk-user-own-key-123456"));
  assert.ok(!shown.includes(SECRET_KEY));
  assert.match(shown, /CLYRA_AI_BASE_URL=http:\/\/localhost:3000/);
});

await test("saving a masked env file restores the stored secret instead of the placeholder", () => {
  const onDisk = "OPENAI_API_KEY=sk-user-own-key-123456\nFOO=bar\n";
  const masked = sanitizeToolOutputForModel(onDisk, env).replace("FOO=bar", "FOO=changed");
  const saved = restoreMaskedDotenv(onDisk, masked);
  assert.match(saved, /^OPENAI_API_KEY=sk-user-own-key-123456$/m);
  assert.match(saved, /^FOO=changed$/m);
  assert.ok(isDotenvPath(".env.local") && isDotenvPath("apps/web/.env") && !isDotenvPath("src/env.ts"));
});

console.log(`\n${passed} Clyra Code project-AI checks passed.`);

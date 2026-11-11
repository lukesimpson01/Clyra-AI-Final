import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createProcessEnvironment, sanitizeToolOutputForModel } from "../lib/clyra-code/security/environment";
import { runWorkspaceValidation } from "../lib/vibe-runtime/validation";

const fakeSecret = "sk-unit-test-never-a-real-credential-123456789";
const previous = process.env.DEEPSEEK_API_KEY;
const previousHarness = process.env.DSH_INTERNAL_SECRET;
process.env.DEEPSEEK_API_KEY = fakeSecret;
process.env.DSH_INTERNAL_SECRET = "harness-unit-test-only";

try {
  const childEnv = createProcessEnvironment();
  assert.equal(childEnv.DEEPSEEK_API_KEY, undefined);
  assert.equal(childEnv.DSH_INTERNAL_SECRET, undefined);
  assert.equal(childEnv.PATH, process.env.PATH);
  assert.ok(!sanitizeToolOutputForModel("DEEPSEEK_API_KEY=" + fakeSecret).includes(fakeSecret));
  console.log("PASS child environment strips host credentials and tool output redacts values");

  const fixture = await mkdtemp(path.join(os.tmpdir(), "clyra-secret-isolation-"));
  try {
    // This simulates a third-party build/test script trying to read Clyra's
    // provider key. Running it must return false, without any key printed.
    await writeFile(path.join(fixture, "package.json"), JSON.stringify({
      private: true,
      scripts: { test: "node -e \\"console.log('provider-secret-present=' + Boolean(process.env.DEEPSEEK_API_KEY))\\"" },
    }));
    const evidence = await runWorkspaceValidation(fixture);
    const testEvidence = evidence.find((item) => item.name === "test");
    assert.equal(testEvidence?.status, "passed", JSON.stringify(evidence));
    assert.match(testEvidence?.output || "", /provider-secret-present=false/);
    assert.ok(!JSON.stringify(evidence).includes(fakeSecret));
    console.log("PASS third-party validation process cannot read DEEPSEEK_API_KEY");
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
} finally {
  if (previous === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = previous;
  if (previousHarness === undefined) delete process.env.DSH_INTERNAL_SECRET;
  else process.env.DSH_INTERNAL_SECRET = previousHarness;
}

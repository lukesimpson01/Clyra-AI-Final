import assert from "node:assert/strict";
import { classifyCommand } from "../lib/clyra-code/security/command-risk";
import {
  REDACTED_RUNTIME_FACT,
  REDACTED_SECRET,
  classifyEnvKey,
  createProcessEnvironment,
  environmentVariableStatus,
  localSecretRegistry,
  sanitizeToolOutputForModel,
  sanitizeToolPayloadForModel,
} from "../lib/clyra-code/security/environment";

let assertions = 0;
let failures = 0;
const test = (name: string, fn: () => void) => {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL  ${name}\n      ${error instanceof Error ? error.message : String(error)}`);
  }
};
const equal = (actual: unknown, expected: unknown, message?: string) => { assertions += 1; assert.deepEqual(actual, expected, message); };
const ok = (value: unknown, message?: string) => { assertions += 1; assert.ok(value, message); };

const DUMPS = [
  "env",
  "printenv",
  "env | grep DSH_",
  "printenv | sort",
  "export -p",
  "declare -x",
  "set",
  "set | grep TOKEN",
  "Get-ChildItem Env:",
  "dir env:",
  "Get-Item Env:*",
  "gci env:*",
  'echo "DSH vars:"; env | grep DSH_ 2>/dev/null | sort',
];

const ORDINARY = [
  "set -e",
  "printenv PATH",
  "npm run settings",
  'echo "set the timeout"',
  "env NODE_ENV=test npm test",
  "export FOO=bar",
  "npm test && git status",
  "swift build",
  "ls -la",
];

test("every environment dump form is classified as environment-inspection", () => {
  for (const command of DUMPS) {
    equal(classifyCommand(command).risk, "environment-inspection", `expected a dump: ${command}`);
  }
});

test("ordinary uses of the same tools are not flagged as dumps", () => {
  for (const command of ORDINARY) {
    const risk = classifyCommand(command).risk;
    ok(risk !== "environment-inspection", `must not flag: ${command} (got ${risk})`);
  }
});

test("credential reads are classified as credential-access", () => {
  equal(classifyCommand("cat ~/.ssh/id_rsa").risk, "credential-access");
  equal(classifyCommand("cat .env").risk, "credential-access");
  equal(classifyCommand("security find-generic-password -s svc").risk, "credential-access");
  equal(classifyCommand("cat /proc/self/environ").risk, "credential-access");
});

test("destructive commands are classified as destructive", () => {
  equal(classifyCommand("rm -rf dist").risk, "destructive");
  equal(classifyCommand("git reset --hard HEAD").risk, "destructive");
  equal(classifyCommand("sudo make install").risk, "destructive");
});

test("publishing and deploying are classified as external-write", () => {
  equal(classifyCommand("git push origin main").risk, "external-write");
  equal(classifyCommand("npm publish").risk, "external-write");
  equal(classifyCommand("curl -X POST https://example.com/api").risk, "external-write");
});

test("the highest-risk segment wins across a compound command", () => {
  equal(classifyCommand("env | grep X; rm -rf build").risk, "destructive");
  equal(classifyCommand("npm test && env").risk, "environment-inspection");
});

test("a quoted separator does not split a command", () => {
  equal(classifyCommand('echo "a | env"').risk, "normal");
});

const SAMPLE_ENV = {
  PATH: "/usr/bin:/bin",
  HOME: "/Users/example",
  TMPDIR: "/var/folders/x",
  NODE_ENV: "development",
  DEEPSEEK_API_KEY: "sk-live-abcdefghijklmnop",
  GITHUB_TOKEN: "ghp_exampleexampleexample",
  CLYRA_TEST_SECRET: "super-secret-value",
  DSH_HOME: "/Users/example/.clyra/dsh-home",
  DSH_SESSION_ID: "session-1234567890",
  PWD: "/Users/example/project",
};

test("child environment keeps build variables and drops secrets and harness facts", () => {
  const env = createProcessEnvironment({ base: SAMPLE_ENV, forward: ["DEEPSEEK_API_KEY"] });
  equal(env.PATH, "/usr/bin:/bin");
  equal(env.HOME, "/Users/example");
  equal(env.PWD, "/Users/example/project", "PWD is the working directory, not a credential");
  equal(env.DEEPSEEK_API_KEY, "sk-live-abcdefghijklmnop", "an explicitly forwarded key still reaches the runtime");
  ok(!("GITHUB_TOKEN" in env), "tokens are removed");
  ok(!("CLYRA_TEST_SECRET" in env), "secret-named variables are removed");
  ok(!("DSH_HOME" in env) && !("DSH_SESSION_ID" in env), "DSH_* facts are removed");
});

test("project-defined patterns extend the sensitive set", () => {
  const env = createProcessEnvironment({ base: { ACME_ACCOUNT: "x", NODE_ENV: "dev" }, extraPatterns: [/ACME/] });
  ok(!("ACME_ACCOUNT" in env));
  equal(env.NODE_ENV, "dev");
});

test("classification of individual names", () => {
  equal(classifyEnvKey("DSH_TEST_TOKEN"), "harness-internal");
  equal(classifyEnvKey("API_KEY"), "sensitive");
  equal(classifyEnvKey("DATABASE_PASSWORD"), "sensitive");
  equal(classifyEnvKey("SSH_AUTH_SOCK"), "sensitive");
  equal(classifyEnvKey("PWD"), "public");
  equal(classifyEnvKey("PATH"), "public");
  equal(classifyEnvKey("MONKEY_PATCH"), "public", "a key fragment inside a word is not a key");
});

test("sanitising removes secret values and harness facts from text", () => {
  const env = {
    CLYRA_TEST_SECRET: "super-secret-value",
    DSH_TEST_TOKEN: "another-secret-value",
    DSH_HOME: "/Users/example/.clyra/dsh-home",
    NODE_ENV: "development",
  };
  const text = [
    "CLYRA_TEST_SECRET=super-secret-value",
    "DSH_TEST_TOKEN=another-secret-value",
    "DSH_HOME=/Users/example/.clyra/dsh-home",
    "NODE_ENV=development",
    "the value super-secret-value appears in logs",
  ].join("\n");
  const out = sanitizeToolOutputForModel(text, env);
  ok(!out.includes("super-secret-value"), "secret value must not survive");
  ok(!out.includes("another-secret-value"), "DSH_ secret value must not survive");
  ok(!out.includes("/Users/example/.clyra/dsh-home"), "DSH_ fact value must not survive");
  ok(out.includes(REDACTED_SECRET), "secret is replaced with the placeholder");
  ok(out.includes(REDACTED_RUNTIME_FACT), "runtime fact is replaced with the placeholder");
  ok(out.includes("NODE_ENV=development"), "ordinary variables stay visible");
  ok(out.includes("CLYRA_TEST_SECRET="), "the name stays visible, the value does not");
});

test("a runtime fact whose value contains spaces is redacted to the end of its line", () => {
  const line = "DSH_SESSION_JSONL=/Users/example/Documents/Coding Projects/Clyra/session.jsonl.zstd";
  const out = sanitizeToolOutputForModel(line, {});
  equal(out, `DSH_SESSION_JSONL=${REDACTED_RUNTIME_FACT}`, "no fragment of the path may remain");
});

test("a runtime fact keeps its runtime-fact placeholder even when its name contains SESSION", () => {
  const out = sanitizeToolOutputForModel("DSH_SESSION_ID=session-1234567890abcdef", {});
  equal(out, `DSH_SESSION_ID=${REDACTED_RUNTIME_FACT}`);
  ok(!out.includes(REDACTED_SECRET), "the secret placeholder must not overwrite the runtime-fact placeholder");
});

test("a sensitive-named variable whose value is a path does not redact ordinary paths", () => {
  const env = { SSH_AUTH_SOCK: "/private/tmp/com.apple.launchd.abc/Listeners" };
  const out = sanitizeToolOutputForModel("opened /private/tmp/com.apple.launchd.abc/Listeners today", env);
  equal(out, "opened /private/tmp/com.apple.launchd.abc/Listeners today");
});

test("key-shaped literals are redacted even when they are not in the environment", () => {
  const out = sanitizeToolOutputForModel("token sk-abcdefghijklmnopqrstuv was printed", {});
  ok(!out.includes("sk-abcdefghijklmnopqrstuv"));
  ok(out.includes(REDACTED_SECRET));
});

test("short values are not redacted, so ordinary words survive", () => {
  const out = sanitizeToolOutputForModel("status ok with mode dev", { API_KEY: "dev" });
  equal(out, "status ok with mode dev");
});

test("structured payloads are sanitised in every string, keeping structure", () => {
  const payload = { command: "echo super-secret-value", output: ["ok", "DSH_HOME=/x/y/z"], meta: { count: 2 } };
  const out = sanitizeToolPayloadForModel(payload, { CLYRA_TEST_SECRET: "super-secret-value", DSH_HOME: "/x/y/z" });
  ok(!JSON.stringify(out).includes("super-secret-value"));
  ok(!JSON.stringify(out).includes("/x/y/z"));
  equal(out.meta.count, 2);
});

test("the secret registry covers sensitive and harness values but not public ones", () => {
  const registry = localSecretRegistry({ API_KEY: "abcdefgh", DSH_SHELL: "/bin/zsh", PATH: "/usr/bin" });
  equal(registry.sensitive, ["abcdefgh"]);
  equal(registry.harness, ["/bin/zsh"]);
});

test("environment status reports presence only and never a value", () => {
  const status = environmentVariableStatus(["PATH", "JAVA_HOME", "NOT A NAME", "EMPTY"], { PATH: "/usr/bin", EMPTY: "" });
  equal(status, { PATH: "present", JAVA_HOME: "missing", EMPTY: "missing" });
  ok(!JSON.stringify(status).includes("/usr/bin"));
});

console.log(`\nClyra Code security — ${assertions} assertions`);
console.log(`\n${failures ? `${failures} FAILURES` : "all checks passed"}`);
process.exit(failures ? 1 : 0);

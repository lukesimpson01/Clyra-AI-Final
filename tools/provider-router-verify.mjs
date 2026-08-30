// Ad hoc verification for lib/ai/provider-router.ts — real API call plus a
// synthetic-failure retry/circuit-breaker check. Not a permanent test suite
// entry (no npm script wired), just proof this session's new infra works.
import { spawn } from "node:child_process";

const child = spawn("npx", ["tsx", "tools/provider-router-verify.ts"], {
  cwd: process.cwd(),
  stdio: "inherit",
  env: process.env,
});
child.on("exit", (code) => process.exit(code ?? 1));

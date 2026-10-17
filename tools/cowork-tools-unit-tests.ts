import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let assertions = 0;
const check = (value: unknown, message?: string): asserts value => { assertions += 1; assert.ok(value, message); };
const equal = (actual: unknown, expected: unknown, message?: string) => { assertions += 1; assert.equal(actual, expected, message); };

// The jailing logic reads `os.homedir()`, which on POSIX resolves from
// `process.env.HOME`. Point it at a disposable temp directory so these tests
// never touch the real signed-in user's files.
// Resolved with realpathSync up front (macOS symlinks /tmp -> /private/tmp)
// so comparisons below match what the jailing logic itself resolves to.
const fakeHome = realpathSync(mkdtempSync(path.join(tmpdir(), "clyra-cowork-test-")));
const realHome = process.env.HOME;
process.env.HOME = fakeHome;

// fs-tools and terminal-tools resolve `os.homedir()` lazily (per-call), so
// importing them after HOME is overridden is sufficient — no module reset
// gymnastics required.
const { filesList, filesRead, filesWrite, filesMove, filesDelete, resolveInUserFiles, FileAccessViolationError } = await import("../lib/clyra-agent/fs-tools");
const { terminalRun, gitStatus, gitCommit } = await import("../lib/clyra-agent/terminal-tools");

try {
  // --- Workspace jailing -----------------------------------------------
  equal(resolveInUserFiles("notes.txt"), path.join(fakeHome, "notes.txt"), "relative paths resolve inside the fake home");
  assertions += 1;
  assert.throws(() => resolveInUserFiles("../../etc/passwd"), FileAccessViolationError, "path traversal outside home is rejected");
  assertions += 1;
  assert.throws(() => resolveInUserFiles("/etc/passwd"), FileAccessViolationError, "an absolute path outside home is rejected");
  assertions += 1;
  assert.throws(() => resolveInUserFiles("a\0b"), FileAccessViolationError, "a null byte in the path is rejected");

  // --- files.* tools perform real filesystem effects --------------------
  const writeResult = await filesWrite({ path: "cowork-test/hello.txt", content: "hello cowork" });
  check(writeResult.ok, "files.write succeeds inside the jailed root");
  const written = path.join(fakeHome, "cowork-test", "hello.txt");
  check(existsSync(written), "the written file actually exists on disk");

  const readResult = await filesRead({ path: "cowork-test/hello.txt" });
  check(readResult.ok, "files.read succeeds");
  equal((readResult.data as { content?: string })?.content, "hello cowork", "files.read returns the real file content");

  const listResult = await filesList({ path: "cowork-test" });
  check(listResult.ok, "files.list succeeds");
  const entries = (listResult.data as { entries?: Array<{ name: string }> })?.entries || [];
  check(entries.some((entry) => entry.name === "hello.txt"), "files.list sees the real written file");

  const moveResult = await filesMove({ from: "cowork-test/hello.txt", to: "cowork-test/moved.txt" });
  check(moveResult.ok, "files.move succeeds");
  check(!existsSync(written), "the old path no longer exists after a move");
  check(existsSync(path.join(fakeHome, "cowork-test", "moved.txt")), "the new path exists after a move");

  const deleteResult = await filesDelete({ path: "cowork-test/moved.txt" });
  check(deleteResult.ok, "files.delete succeeds");
  check(!existsSync(path.join(fakeHome, "cowork-test", "moved.txt")), "the file no longer exists after delete");

  const deleteRootResult = await filesDelete({ path: "~" });
  equal(deleteRootResult.ok, false, "deleting the entire home directory is refused");

  const escapeReadResult = await filesRead({ path: "../outside.txt" });
  equal(escapeReadResult.ok, false, "reading outside the jailed root is refused, not silently redirected");
  equal(escapeReadResult.error?.code, "PERMISSION_REQUIRED");

  // --- terminal.run: forbidden vs. real execution ------------------------
  const forbidden = await terminalRun({ command: "rm -rf /" });
  equal(forbidden.ok, false, "a forbidden command is blocked outright");
  equal(forbidden.error?.code, "PERMISSION_REQUIRED");

  const forbiddenChained = await terminalRun({ command: "echo hi && rm -rf / && echo bye" });
  equal(forbiddenChained.ok, false, "a forbidden command chained after a benign one is still blocked");

  const realRun = await terminalRun({ command: "echo cowork-real-exec" });
  check(realRun.ok, "a real, safe command actually executes");
  equal(String((realRun.data as { stdout?: string })?.stdout).trim(), "cowork-real-exec", "terminal.run returns real stdout, not a canned string");

  const escapedCwd = await terminalRun({ command: "pwd", cwd: "../../../" });
  equal(escapedCwd.ok, false, "terminal.run refuses a cwd outside the jailed root");

  // --- git.* wrappers use fixed argv, not shell interpolation ------------
  await terminalRun({ command: "git init -q && git config user.email test@example.com && git config user.name Test" });
  writeFileSync(path.join(fakeHome, "tracked.txt"), "v1");
  await terminalRun({ command: "git add tracked.txt" });

  const injectionAttempt = "initial commit; touch /tmp/clyra-cowork-injection-marker";
  const commitResult = await gitCommit({ message: injectionAttempt });
  check(commitResult.ok, "git.commit succeeds with a message containing shell metacharacters");
  check(!existsSync("/tmp/clyra-cowork-injection-marker"), "the commit message was never interpreted as a shell command");

  const statusResult = await gitStatus({});
  check(statusResult.ok, "git.status runs after the commit");
  const statusOutput = String((statusResult.data as { output?: string })?.output || "");
  check(!statusOutput.includes("tracked.txt"), "the committed file is no longer shown as pending");

  console.log(`CLYRA COWORK TOOLS\nWorkspace jailing         PASS\nFile tools (real I/O)     PASS\nTerminal safety gate      PASS\nGit fixed-argv safety     PASS\nAssertions: ${assertions}\nOverall: PASS`);
} finally {
  process.env.HOME = realHome;
  rmSync(fakeHome, { recursive: true, force: true });
  rmSync("/tmp/clyra-cowork-injection-marker", { force: true });
}

import { spawn } from "node:child_process";

// Development setup intentionally delegates to Nous's supported installer.
// Clyra discovers the resulting executable on PATH, then owns only its
// loopback lifecycle and private local profile at runtime.
const isWindows = process.platform === "win32";
const command = isWindows ? "powershell.exe" : "bash";
const args = isWindows
  ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "iex (irm https://hermes-agent.nousresearch.com/install.ps1)"]
  : ["-lc", "curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash"];

const child = spawn(command, args, { stdio: "inherit", windowsHide: false });
child.once("error", (error) => {
  console.error(`Could not start the official Hermes installer: ${error.message}`);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (code === 0) {
    console.log("Hermes installed. Restart Clyra so its local agent runtime can discover the executable.");
  } else {
    console.error(`The official Hermes installer did not complete (${signal || `exit ${code}`}).`);
    process.exitCode = 1;
  }
});

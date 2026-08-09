import { spawn } from "node:child_process";
import process from "node:process";

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const children = [
  spawn(npmCmd, ["run", "dev:source"], { stdio: "inherit", env: process.env, shell: process.platform === "win32" }),
  spawn(npmCmd, ["run", "dev:openpencil"], { stdio: "inherit", env: process.env, shell: process.platform === "win32" }),
];

let stopping = false;
const stopAll = (signal = "SIGTERM") => {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
};

process.on("SIGINT", () => stopAll("SIGINT"));
process.on("SIGTERM", () => stopAll("SIGTERM"));

for (const child of children) {
  child.once("exit", (code, signal) => {
    if (stopping) return;
    stopAll(signal || "SIGTERM");
    process.exitCode = code ?? 1;
  });
}

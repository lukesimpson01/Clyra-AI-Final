/**
 * Windows-only smoke test: compile the C# SendInput declarations used by the
 * live desktop service and verify native ABI layout. Never inject input here.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
if (process.platform !== "win32") {
  console.log("Windows pointer ABI test skipped on non-Windows host.");
} else {
  const code = readFileSync(new URL("../electron/desktop-control.mjs", import.meta.url), "utf8");
  const match = code.match(/const WINDOWS_INPUT = String.raw`([\s\S]*?)`;/);
  assert.ok(match, "Windows input must contain a native C# declaration");
  const ps = match[1] + String.raw`
$ErrorActionPreference = 'Stop'
$size = [System.Runtime.InteropServices.Marshal]::SizeOf([type][ClyraWindowsInput+INPUT])
$expected = if ([IntPtr]::Size -eq 8) { 40 } else { 28 }
if ($size -ne $expected) { throw "Incorrect SendInput INPUT size: $size expected $expected" }
$point = New-Object ClyraWindowsInput+POINT
if (-not [ClyraWindowsInput]::GetCursorPos([ref]$point)) { throw "Could not read the OS pointer" }
Write-Output 'CLYRA_POINTER_ABI_OK'
`;
  const { stdout, stderr } = await promisify(execFile)("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", ps,
  ], { timeout: 30_000, windowsHide: true });
  assert.match(stdout, /CLYRA_POINTER_ABI_OK/, stderr);
  console.log("Windows cursor native SendInput ABI: OK");
}

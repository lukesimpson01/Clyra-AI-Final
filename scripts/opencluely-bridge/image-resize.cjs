/**
 * CommonJS ImageMagick resize helper (safe on Windows — never calls convert.exe).
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

function resizeImageBuffer(inputBuffer, { maxEdge = 1280, quality = 85 } = {}) {
  if (!inputBuffer?.length) return inputBuffer;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clyra-img-"));
  const input = path.join(dir, "in.png");
  const output = path.join(dir, "out.jpg");
  try {
    fs.writeFileSync(input, inputBuffer);
    const args = [input, "-resize", `${maxEdge}x${maxEdge}>`, "-quality", String(quality), output];
    const attempts =
      process.platform === "win32"
        ? [["magick", args]]
        : [
            ["magick", args],
            ["convert", args],
          ];
    for (const [bin, binArgs] of attempts) {
      try {
        execFileSync(bin, binArgs, { timeout: 15_000, windowsHide: true });
        if (fs.existsSync(output)) return fs.readFileSync(output);
      } catch {
        /* next */
      }
    }
    return inputBuffer;
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

module.exports = { resizeImageBuffer };

/**
 * Shared Gemini vision helper for Clyra server + Electron companion calls.
 * Offline Ollama/gemma3 path removed — requires GEMINI_API_KEY.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);

export function visionModelName() {
  return (
    process.env.GEMINI_VISION_MODEL ||
    process.env.OPENCLUELY_VISION_MODEL ||
    "gemini-2.0-flash"
  );
}

export function geminiApiKey() {
  return String(process.env.GEMINI_API_KEY || "").trim();
}

/** @deprecated Ollama removed — kept for import compatibility */
export function ollamaBaseUrl() {
  return "";
}

async function resizeImageBuffer(buffer, maxEdge = 1280) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "clyra-gemini-vision-"));
  const input = path.join(dir, "in.png");
  const output = path.join(dir, "out.jpg");
  try {
    await fs.writeFile(input, buffer);
    const args = [input, "-resize", `${maxEdge}x${maxEdge}>`, "-quality", "85", output];
    // Prefer IM7 `magick`. Never call bare `convert` on Windows (filesystem tool).
    const bins = process.platform === "win32" ? ["magick"] : ["magick", "convert"];
    for (const bin of bins) {
      try {
        await execFileAsync(bin, args, { timeout: 15_000, windowsHide: true });
        return await fs.readFile(output);
      } catch {
        /* try next */
      }
    }
    return buffer;
  } finally {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

async function resolvePythonBin() {
  const candidates =
    process.platform === "win32"
      ? ["py", "python", "python3"]
      : ["python3", "python"];
  for (const bin of candidates) {
    try {
      if (bin === "py") {
        await execFileAsync("py", ["-3", "-c", "print(1)"], { timeout: 4_000, windowsHide: true });
        return { command: "py", prefix: ["-3"] };
      }
      await execFileAsync(bin, ["-c", "print(1)"], { timeout: 4_000, windowsHide: true });
      return { command: bin, prefix: [] };
    } catch {
      /* next */
    }
  }
  return { command: process.platform === "win32" ? "python" : "python3", prefix: [] };
}

function extractGeminiText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => String(p?.text || "")).join(" ").trim();
}

/**
 * @param {Buffer} imageBuffer
 * @param {string} [prompt]
 * @param {{ model?: string, timeoutMs?: number }} [opts]
 */
export async function callGeminiVision(imageBuffer, prompt, opts = {}) {
  if (!imageBuffer?.length) throw new Error("Image buffer is required");
  const apiKey = geminiApiKey();
  if (!apiKey) throw new Error("GEMINI_API_KEY is required for image analysis");

  const model = opts.model || visionModelName();
  const resized = await resizeImageBuffer(imageBuffer);
  const base64 = resized.toString("base64");
  const question =
    prompt ||
    "Look at this image carefully. Describe what is visible and answer any clear question on screen. Be concise and literal.";

  const models = [model, "gemini-2.0-flash", "gemini-1.5-flash"].filter(
    (m, i, arr) => m && arr.indexOf(m) === i,
  );

  let lastError = null;
  for (const candidate of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(candidate)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { text: question },
                { inline_data: { mime_type: "image/jpeg", data: base64 } },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.3,
            topK: 32,
            topP: 0.9,
            maxOutputTokens: 1024,
          },
        }),
        signal: AbortSignal.timeout(opts.timeoutMs || 90_000),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          `Gemini vision failed (${response.status}): ${String(json?.error?.message || JSON.stringify(json)).slice(0, 240)}`,
        );
      }
      const text = extractGeminiText(json);
      if (!text) throw new Error(`Vision model ${candidate} returned an empty reply`);
      return { ok: true, summary: text, text, model: candidate, source: "gemini-vision" };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Gemini vision failed");
}

/** @deprecated Use callGeminiVision — kept so existing imports keep working */
export async function callOllamaVision(imageBuffer, prompt, opts = {}) {
  return callGeminiVision(imageBuffer, prompt, opts);
}

/**
 * Analyse a data-URL frame with Gemini vision, falling back to RapidOCR script.
 */
export async function analyseVisionFrame(dataUrl, question = "") {
  const match = /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i.exec(String(dataUrl || ""));
  if (!match) throw new Error("A data-URL image is required.");
  const ext = match[1].toLowerCase() === "png" ? "png" : "jpg";
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.byteLength > 8 * 1024 * 1024) throw new Error("Frame too large.");

  const prompt =
    question ||
    "What is visible in this camera or screen share? Answer any question the user is asking about it. Be concise and helpful.";

  try {
    const vlm = await callGeminiVision(buffer, prompt);
    return {
      ok: true,
      summary: vlm.summary,
      text: vlm.summary,
      ocrText: vlm.summary,
      model: vlm.model,
      source: "gemini-vision",
      engine: "gemini",
    };
  } catch (vlmError) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "clyra-vision-frame-"));
    const filePath = path.join(dir, `frame.${ext}`);
    try {
      await fs.writeFile(filePath, buffer);
      const script = path.join(process.cwd(), "tools", "companion-vision.py");
      const py = await resolvePythonBin();
      const { stdout } = await execFileAsync(
        py.command,
        [...py.prefix, script, filePath, "--question", prompt],
        { timeout: 45_000, maxBuffer: 4 * 1024 * 1024, env: process.env, windowsHide: true },
      );
      const payload = JSON.parse(String(stdout || "{}"));
      return {
        ...payload,
        ok: payload.ok !== false,
        summary: payload.summary || payload.text || "",
        source: payload.source || "rapidocr-fallback",
        engine: "rapidocr",
        vlmError: vlmError instanceof Error ? vlmError.message : String(vlmError),
      };
    } finally {
      try {
        await fs.rm(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

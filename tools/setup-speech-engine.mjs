#!/usr/bin/env node
/** Build the tiny local whisper.cpp runtime once. No Python service stays alive. */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
const root = process.cwd();
const whisper = path.join(root, "vendor", "whisper.cpp");
if (!existsSync(whisper)) throw new Error("vendor/whisper.cpp is missing; restore the bundled source before setup.");
const run = (bin, args) => execFileSync(bin, args, { cwd: whisper, stdio: "inherit" });
const metal = process.platform === "darwin" ? "ON" : "OFF";
run("cmake", ["-B", "build", `-DGGML_METAL=${metal}`, "-DWHISPER_CURL=OFF"]);
run("cmake", ["--build", "build", "--config", "Release", "-j"]);
const profile = process.env.CLYRA_WHISPER_PROFILE || "base.en";
const model = path.join(whisper, "models", `ggml-${profile}.bin`);
if (!existsSync(model)) {
  await mkdir(path.dirname(model), { recursive: true });
  const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${profile}.bin?download=true`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download ${profile} Whisper model (${response.status}).`);
  await writeFile(model, Buffer.from(await response.arrayBuffer()));
}
const quantized = path.join(whisper, "models", `ggml-${profile}-q5_1.bin`);
if (!existsSync(quantized)) run(path.join(whisper, "build", "bin", process.platform === "win32" ? "whisper-quantize.exe" : "whisper-quantize"), [model, quantized, "q5_1"]);
// Default engine: NVIDIA Parakeet-TDT 0.6B v3 (CC-BY-4.0), 4-bit k-quant, ~416MB.
// Warm worker used for instant dictation; built every run (incremental).
if (process.env.CLYRA_SKIP_PARAKEET !== "1") run("cmake", ["--build", "build", "--config", "Release", "--target", "parakeet-cli", "parakeet-daemon", "-j"]);
const parakeetModel = path.join(whisper, "models", "ggml-parakeet-tdt-0.6b-v3-q4_k.bin");
if (!existsSync(parakeetModel) && process.env.CLYRA_SKIP_PARAKEET !== "1") {
  run("cmake", ["--build", "build", "--config", "Release", "--target", "parakeet-cli", "-j"]);
  const parakeetResponse = await fetch("https://huggingface.co/ggml-org/parakeet-GGUF/resolve/main/ggml-parakeet-tdt-0.6b-v3-q4_k.bin?download=true");
  if (!parakeetResponse.ok) throw new Error(`Could not download the Parakeet model (${parakeetResponse.status}).`);
  await writeFile(parakeetModel, Buffer.from(await parakeetResponse.arrayBuffer()));
}
console.log(`Clyra local speech is ready with quantized ${profile}. Select tiny/base/small in Advanced settings with CLYRA_WHISPER_PROFILE.`);

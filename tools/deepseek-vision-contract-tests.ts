/** Offline contracts for the server-owned DeepSeek Flash vision request. */
import assert from "node:assert/strict";
import { analyseDeepseekVisionFrame, buildDeepseekVisionRequest, VisionInputError } from "../lib/ai/vision-router";
import { getConfiguredProviders, selectProvider } from "../lib/ai/model-capability-registry";

const SAMPLE_IMAGE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const previous = {
  key: process.env.DEEPSEEK_API_KEY,
  model: process.env.DEEPSEEK_MODEL,
  base: process.env.DEEPSEEK_BASE_URL,
};

async function main() {
  process.env.DEEPSEEK_API_KEY = "sk-live-clyra-vision-contract-0123456789";
  process.env.DEEPSEEK_MODEL = "deepseek-flash";
  process.env.DEEPSEEK_BASE_URL = "https://vision.example.test/v1";

  const config = selectProvider("image-understanding");
  assert.equal(config.provider, "deepseek");
  assert.ok(getConfiguredProviders().find((provider) => provider.provider === "deepseek")?.capabilities.includes("image-understanding"));

  const request = buildDeepseekVisionRequest(config, SAMPLE_IMAGE, "What is visible?", { detail: "high", maxTokens: 777 });
  assert.equal(request.url, "https://vision.example.test/v1/chat/completions");
  assert.equal(request.body.model, "deepseek-flash");
  assert.equal(request.body.messages[1].role, "user");
  const content = request.body.messages[1].content as Array<any>;
  assert.equal(content[0].type, "text");
  assert.match(content[0].text, /What is visible\?/);
  assert.equal(content[1].image_url.url, SAMPLE_IMAGE);
  assert.equal(content[1].image_url.detail, "high");
  assert.equal(request.body.max_tokens, 777);

  let captured: any;
  const result = await analyseDeepseekVisionFrame(SAMPLE_IMAGE, "Read the control", {
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return new Response(JSON.stringify({
        choices: [{ message: { content: "The screen shows a visible Stop control." } }],
        usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  assert.equal(result.source, "deepseek-vision");
  assert.equal(result.text, "The screen shows a visible Stop control.");
  assert.equal(result.usage?.totalTokens, 18);
  assert.equal(captured.init.method, "POST");
  const sent = JSON.parse(String(captured.init.body));
  assert.equal(sent.messages[1].content[1].type, "image_url");
  assert.equal(sent.messages[1].content[1].image_url.url, SAMPLE_IMAGE);

  await assert.rejects(
    () => analyseDeepseekVisionFrame("https://example.test/not-a-frame.png", "bad"),
    VisionInputError,
  );

  console.log("PASS deepseek vision contracts (15 assertions)");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  if (previous.key === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = previous.key;
  if (previous.model === undefined) delete process.env.DEEPSEEK_MODEL; else process.env.DEEPSEEK_MODEL = previous.model;
  if (previous.base === undefined) delete process.env.DEEPSEEK_BASE_URL; else process.env.DEEPSEEK_BASE_URL = previous.base;
});

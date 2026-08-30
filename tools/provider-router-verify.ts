import { chatComplete } from "../lib/ai/provider-router";
import { getConfiguredProviders } from "../lib/ai/model-capability-registry";

async function main() {
  const configured = getConfiguredProviders();
  console.log("Configured providers:", configured.map((c) => `${c.provider}:${c.model}`));

  const result = await chatComplete({
    capability: "fast-text",
    messages: [{ role: "user", content: "Reply with exactly the word: WORKING" }],
    maxTokens: 20,
  });
  console.log("Real call result:", JSON.stringify(result));

  const reasoningResult = await chatComplete({
    capability: "deep-reasoning",
    messages: [{ role: "user", content: "What is 17 * 24? Answer with just the number." }],
    maxTokens: 500,
  });
  console.log("Deep-reasoning call result:", JSON.stringify(reasoningResult));

  process.env.DEEPSEEK_BASE_URL = "http://127.0.0.1:1";
  const start = Date.now();
  try {
    await chatComplete({ capability: "fast-text", messages: [{ role: "user", content: "x" }], timeoutMs: 800 });
    console.log("UNEXPECTED: retry-path call succeeded");
  } catch (error) {
    console.log("Retry path failed as expected after retries in", Date.now() - start, "ms:", (error as Error).message.slice(0, 120));
  }
}

main();

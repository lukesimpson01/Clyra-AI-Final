import { detectResearchIntent } from "../src/lib/researchDetect.ts";

const cases = [
  ["what is fable 5 ai", "web"],
  ["/research what is openai gpt 5", "web"],
  ["what is 25 + 17", "none"],
  ["solve for x: 2x + 5 = 15", "none"],
  ["how are you?", "none"],
  ["hello there", "none"],
  ["analyse this youtube video https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube"],
  ["write me a poem about cats", "none"],
  ["can you help me with my homework on fractions", "none"],
];

let passed = 0;
for (const [query, expected] of cases) {
  const result = detectResearchIntent(query);
  const ok = result.kind === expected;
  if (ok) passed += 1;
  console.log(`${ok ? "✓" : "✗"} "${query}" => ${result.kind} (expected ${expected})`);
}
console.log(`\n${passed}/${cases.length} passed`);
process.exit(passed === cases.length ? 0 : 1);

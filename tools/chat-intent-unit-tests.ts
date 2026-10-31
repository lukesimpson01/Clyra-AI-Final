import assert from "node:assert/strict";
import {
  extractLocationQuery,
  extractWeatherLocation,
  isVibeBuildRequest,
  looksLikeLocationQuery,
  looksLikeWeatherQuery,
} from "../src/lib/chatIntent";
import { chatReplyFailureText } from "../src/lib/chatReplyErrors";

// Clyra Code (Vibe Coder) is a heavyweight path that creates a real project.
// A writing request that merely names a technology must stay in chat.
assert.equal(isVibeBuildRequest("Write a long, detailed guide to learning TypeScript in 12 sections."), false, "technology name alone must not create a project");
assert.equal(isVibeBuildRequest("Explain how TypeScript generics work."), false);
assert.equal(isVibeBuildRequest("Write a long, detailed guide to learning Python in 12 sections."), false);
assert.equal(isVibeBuildRequest("What is 27 × 19?"), false);
assert.equal(isVibeBuildRequest("Create a folder for this project"), false);
assert.equal(isVibeBuildRequest("Explain how this function works."), false);

// Real coding work still reaches the harness.
assert.equal(isVibeBuildRequest("Fix the TypeScript errors in this project."), true);
assert.equal(isVibeBuildRequest("Debug my React project"), true);
assert.equal(isVibeBuildRequest("Open my project, fix the build error and run it."), true);
assert.equal(isVibeBuildRequest("Refactor this function to use async/await"), true);
assert.equal(isVibeBuildRequest("Make me a web app for tracking habits"), true);
assert.equal(isVibeBuildRequest("Build a landing page for my bakery"), true);
assert.equal(isVibeBuildRequest(""), false);

// Map queries: a place asked for by its position must reach geocoding, not
// the generic model answer (which produced prose and a fake coordinate block).
assert.equal(looksLikeLocationQuery("Show me where the Sydney Opera House is."), true);
assert.equal(extractLocationQuery("Show me where the Sydney Opera House is."), "Sydney Opera House");
assert.equal(looksLikeLocationQuery("Where is the Eiffel Tower?"), true);
assert.equal(extractLocationQuery("Where is the Eiffel Tower?"), "Eiffel Tower");
assert.equal(looksLikeLocationQuery("Where's Uluru?"), true);
assert.equal(extractLocationQuery("Where's Uluru?"), "Uluru");

// Non-location "where" questions must not be hijacked by the map path.
assert.equal(looksLikeLocationQuery("Show me where the bug is in my code."), false);
assert.equal(looksLikeLocationQuery("Explain where the TypeScript compiler caches its output."), false);
assert.equal(looksLikeLocationQuery("What is 27 × 19?"), false);
assert.equal(looksLikeLocationQuery("Explain how DNS works."), false);

// Weather stays on its own path and is never a map query.
assert.equal(looksLikeWeatherQuery("What's the weather tomorrow in Sydney?"), true);
assert.equal(looksLikeLocationQuery("What's the weather tomorrow in Sydney?"), false);
assert.equal(extractWeatherLocation("What's the weather tomorrow in Sydney?"), "Sydney");
assert.equal(looksLikeWeatherQuery("Explain how DNS works."), false);

// Failed replies say what happened and what to do next. The provider's raw
// detail stays out of the conversation.
assert.match(chatReplyFailureText(new Error("Chat API error: 429 Too Many Requests")), /rate-limited/);
assert.match(chatReplyFailureText(new Error("Chat API error: 402 PROVIDER_CREDITS_EXHAUSTED")), /out of credits/);
assert.match(chatReplyFailureText(new Error("Chat API error: 429 insufficient_quota")), /out of credits/);
assert.match(chatReplyFailureText(new Error("Chat API error: 401 Unauthorized")), /API key in Settings/);
assert.match(chatReplyFailureText(new Error("Chat API error: 503 Service Unavailable")), /isn't responding/);
assert.match(chatReplyFailureText(new TypeError("Failed to fetch")), /reach the model/);
assert.match(chatReplyFailureText(new Error("boom")), /Press Retry/);
assert.doesNotMatch(chatReplyFailureText(new Error("Chat API error: 500 secret-provider-detail")), /secret-provider-detail|500/);

console.log("chat intent unit tests passed");

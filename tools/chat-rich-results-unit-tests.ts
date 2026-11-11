/** Pure parsers + mocked providers: no network, credentials, or expensive model calls. */
import assert from "node:assert/strict";
import {
  inferRichSearchIntent, inspectGitHubRepository, parseCommonsImages, parseOpenverseImages,
  parseGitHubRepositories, searchGitHubRepositories, searchResearchImages,
} from "../lib/chat-agent/rich-search";
import { shouldUseChatAgent } from "../src/lib/chatAgentClient";

const goodImage = {
  pageid: 42, title: "File:Sydney Opera House.jpg",
  imageinfo: [{
    mime: "image/jpeg",
    url: "https://upload.wikimedia.org/wikipedia/commons/a/abc/Sydney.jpg",
    thumburl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/abc/Sydney.jpg/920px-Sydney.jpg",
    descriptionurl: "https://commons.wikimedia.org/wiki/File:Sydney_Opera_House.jpg",
    extmetadata: { Artist: { value: "Photographer" }, LicenseShortName: { value: "CC BY-SA 4.0" } },
  }],
};
const goodRepo = {
  full_name: "openai/openai-cookbook", html_url: "https://github.com/openai/openai-cookbook",
  description: "Example code", stargazers_count: 17000, language: "Python",
  license: { spdx_id: "MIT" }, updated_at: "2026-11-11T00:00:00Z",
  owner: { avatar_url: "https://avatars.githubusercontent.com/u/123?v=4" },
};
const images = parseCommonsImages({ query: { pages: [
  goodImage,
  { ...goodImage, pageid: 43, title: "File:Unsafe", imageinfo: [{ ...goodImage.imageinfo[0], thumburl: "javascript:alert(1)" }] },
  { pageid: 44, title: "File:SVG", imageinfo: [{ ...goodImage.imageinfo[0], mime: "image/svg+xml" }] },
] } });
assert.equal(images.length, 1);
assert.equal(images[0].licence, "CC BY-SA 4.0");
assert.ok(images[0].sourceUrl.includes("commons.wikimedia.org"));
assert.deepEqual(parseCommonsImages({ error: "no provider" }), []);
const openverse = parseOpenverseImages({ results: [{ id: "123e4567-e89b-12d3-a456-426614174000", title: "Sydney", url: "https://example.org/sydney.jpg", thumbnail: "https://example.org/thumb.jpg", foreign_landing_url: "https://example.org/sydney", license: "cc-by", license_version: "4.0", creator: "Researcher", mature: false }] });
assert.equal(openverse.length, 1);
assert.ok(openverse[0].thumbnailUrl.startsWith("https://api.openverse.org/v1/images/"));
const repos = parseGitHubRepositories({ items: [
  goodRepo,
  { ...goodRepo, full_name: "hacker/evil", html_url: "javascript:alert(1)" },
] });
assert.equal(repos.length, 1);
assert.equal(repos[0].stars, 17000);
assert.equal(repos[0].licence, "MIT");
assert.equal(parseGitHubRepositories({ items: [{ ...goodRepo, license: null }] })[0].licence, undefined);

const routes = [
  ["Find me some photos of Sydney Opera House", true, false],
  ["show me GitHub repos for a note app", false, true],
  ["check https://github.com/openai/openai-cookbook", false, false],
  ["generate an image of a castle", false, false],
  ["what does open source mean", false, false],
] as const;
for (const [text, imagesExpected, githubExpected] of routes) {
  const result = inferRichSearchIntent(text);
  assert.equal(result.images, imagesExpected, text + " image intent");
  assert.equal(result.github, githubExpected, text + " GitHub intent");
}
assert.equal(inferRichSearchIntent("https://github.com/openai/openai-cookbook").repository, "openai/openai-cookbook");
assert.equal(shouldUseChatAgent("Find photos of the Opera House"), true);
assert.equal(shouldUseChatAgent("Find github repos for calendar apps"), true);
assert.equal(shouldUseChatAgent("Hey, how are you?"), false);

const requests: string[] = [];
const fetcher = (async (input: string | URL | Request) => {
  const url = String(input);
  requests.push(url);
  const payload = url.includes("commons.wikimedia.org") ? { query: { pages: [goodImage] } }
    : url.includes("api.openverse.org") ? { results: [{ id: "123e4567-e89b-12d3-a456-426614174000", title: "Sydney", url: "https://example.org/image.jpg", thumbnail: "https://example.org/thumb.jpg", foreign_landing_url: "https://example.org/image", license: "cc0", mature: false }] }
    : url.endsWith("/readme") ? { encoding: "base64", content: Buffer.from("# Verified README").toString("base64") }
    : url.endsWith("/contents") ? [{ name: "LICENSE" }, { name: "src" }]
    : url.includes("/search/repositories?") ? { items: [goodRepo] } : goodRepo;
  return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
}) as typeof fetch;
assert.equal((await searchResearchImages("Sydney Opera House", { fetcher })).length, 2, "Distinct Openverse and Wikimedia Commons images are both returned");
assert.equal((await searchGitHubRepositories("openai", { fetcher })).length, 1);
assert.ok(!requests.some((url) => /sort=best-match/.test(url)), "GitHub best-match ranking is the default");
const inspected = await inspectGitHubRepository("openai/openai-cookbook", { fetcher });
assert.equal(inspected.readme, "# Verified README");
assert.deepEqual(inspected.files, ["LICENSE", "src"]);
await assert.rejects(inspectGitHubRepository("../../../secret", { fetcher }));
assert.equal(requests.length, 6, "Openverse, Commons, GitHub search, repository metadata, README and tree");

console.log("Chat rich search: parsers, intent, provider URLs, metadata and safety passed.");

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  BrandKitStore,
  BrandKitValidationError,
  brandKitToClipConfig,
  normaliseBrandKit,
} from "../lib/clipper/brand-kits";

let assertions = 0;
const check = (value: unknown, message?: string) => {
  assert.ok(value, message);
  assertions += 1;
};

const run = async () => {
  const root = await mkdtemp(path.join(tmpdir(), "clyra-brand-kits-"));
  try {
    const store = new BrandKitStore(root);

    // ── Empty store ─────────────────────────────────────────────────────
    check((await store.list()).length === 0, "a fresh store has no kits");
    check((await store.get("missing")) === null, "an unknown id reads as null");

    // ── Validation ──────────────────────────────────────────────────────
    await assert.rejects(() => store.save({}), BrandKitValidationError, "a nameless kit is rejected");
    assertions += 1;

    // ── Defaults ────────────────────────────────────────────────────────
    const defaults = normaliseBrandKit({ name: "Defaults" });
    check(defaults.captions.font === "Impact", "caption font defaults");
    check(defaults.aspectRatio === "9:16", "vertical is the default delivery");
    check(defaults.logo === null, "no logo unless one is supplied");
    check(defaults.accentColour === "#4169F6", "Clyra blue is the default accent");

    // ── Coercion: bad values are corrected, not fatal ────────────────────
    const coerced = normaliseBrandKit({
      name: "  Podcast Kit  ",
      captions: { font: "Helvetica", fontSize: 9_000, colour: "not-a-colour", position: "sideways", style: "nonsense" },
      aspectRatio: "21:9",
      layout: "hologram",
      accentColour: "#00ff00",
    });
    check(coerced.name === "Podcast Kit", "the name is trimmed");
    check(coerced.captions.fontSize === 160, "an absurd font size clamps to the maximum");
    check(coerced.captions.colour === "#FFFFFF", "an invalid colour falls back to white");
    check(coerced.captions.position === "bottom", "an unknown position falls back to bottom");
    check(coerced.captions.style === "phrase-highlight", "an unknown caption style falls back");
    check(coerced.aspectRatio === "9:16", "an unsupported ratio falls back to vertical");
    check(coerced.layout === "auto", "an unknown layout falls back to auto");
    check(coerced.accentColour === "#00FF00", "a valid colour is upper-cased and kept");

    // ── Logo path safety ────────────────────────────────────────────────
    const traversal = normaliseBrandKit({ name: "Bad logo", logo: { file: "../../../etc/passwd" } });
    check(traversal.logo === null, "a traversal logo path is refused");
    const absolute = normaliseBrandKit({ name: "Bad logo", logo: { file: "/etc/passwd" } });
    check(absolute.logo === null, "an absolute logo path is refused");
    const goodLogo = normaliseBrandKit({
      name: "Logo kit",
      logo: { file: "logo.png", corner: "top-left", scalePercent: 99, opacity: 5 },
    });
    check(goodLogo.logo?.file === "logo.png", "a relative logo path is kept");
    check(goodLogo.logo?.corner === "top-left", "the logo corner is honoured");
    check(goodLogo.logo?.scalePercent === 40, "logo scale clamps to the maximum");
    check(goodLogo.logo?.opacity === 1, "logo opacity clamps to 1");

    // ── Persistence ─────────────────────────────────────────────────────
    const saved = await store.save({ name: "Show Kit", captions: { colour: "#FF0000" } });
    check(Boolean(saved.id), "a saved kit gets an id");
    const reloaded = await new BrandKitStore(root).get(saved.id);
    check(reloaded?.name === "Show Kit", "a kit survives a fresh store instance");
    check(reloaded?.captions.colour === "#FF0000", "saved values round-trip");

    // ── Update keeps id and createdAt, refreshes updatedAt ───────────────
    await new Promise((resolve) => setTimeout(resolve, 5));
    const updated = await store.save({ name: "Show Kit v2" }, saved.id);
    check(updated.id === saved.id, "updating preserves the id");
    check(updated.createdAt === saved.createdAt, "updating preserves createdAt");
    check(updated.updatedAt >= saved.updatedAt, "updating refreshes updatedAt");
    check(updated.captions.colour === "#FF0000", "unspecified fields carry over from the existing kit");
    check((await store.list()).length === 1, "an update does not create a duplicate");

    await assert.rejects(() => store.save({ name: "Ghost" }, "no-such-id"), BrandKitValidationError,
      "updating a missing kit is rejected");
    assertions += 1;

    // ── Delete ──────────────────────────────────────────────────────────
    check((await store.remove(saved.id)) === true, "delete reports success");
    check((await store.remove(saved.id)) === false, "deleting twice reports not-found");
    check((await store.list()).length === 0, "the store is empty again");

    // ── Corrupt file degrades to empty rather than throwing ──────────────
    await writeFile(path.join(root, "brand-kits.json"), "{ not json", "utf8");
    check((await new BrandKitStore(root).list()).length === 0, "a corrupt store reads as empty");
    const afterCorruption = await store.save({ name: "Recovered" });
    check(afterCorruption.name === "Recovered", "the store recovers by overwriting corrupt data");

    // ── Pipeline mapping ────────────────────────────────────────────────
    const config = brandKitToClipConfig(coerced);
    check(config.font === "Helvetica", "mapping carries the font to the pipeline field");
    check(config.font_size === 160, "mapping uses the pipeline's snake_case size field");
    check(config.text_colour === "#FFFFFF", "mapping uses the pipeline's colour field");
    check(config.aspect_ratio === "9:16", "mapping carries the aspect ratio");

    console.log(`clipper-brand-kit-unit-tests: ${assertions} assertions passed`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

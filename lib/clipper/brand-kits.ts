/**
 * Brand kits for Clyra Clipper.
 *
 * A brand kit is the reusable half of a clip's look — the decisions a creator
 * makes once and then wants applied to every clip they ever export: caption
 * font and colours, the logo and where it sits, the aspect ratio and speaker
 * layout they publish in.
 *
 * Deliberately stored as plain JSON next to Clyra's other clipper state rather
 * than in a database: kits are small, per-user, and must survive an app
 * reinstall being restored from a data-directory backup.
 */
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export const CAPTION_POSITIONS = ["top", "centre", "bottom"] as const;
export const BRAND_ASPECT_RATIOS = ["9:16", "1:1", "16:9"] as const;
export const LOGO_CORNERS = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;

export type CaptionPosition = (typeof CAPTION_POSITIONS)[number];
export type BrandAspectRatio = (typeof BRAND_ASPECT_RATIOS)[number];
export type LogoCorner = (typeof LOGO_CORNERS)[number];

export interface BrandKitCaptions {
  font: string;
  fontSize: number;
  colour: string;
  position: CaptionPosition;
  /** Word-by-word karaoke highlight vs. one active phrase. */
  style: "word" | "phrase-highlight";
}

export interface BrandKitLogo {
  /** Path relative to the brand-kit asset directory, never an absolute host path. */
  file: string;
  corner: LogoCorner;
  /** Width as a percentage of the output frame, 2–40. */
  scalePercent: number;
  opacity: number;
}

export interface BrandKit {
  id: string;
  name: string;
  captions: BrandKitCaptions;
  aspectRatio: BrandAspectRatio;
  /** Preferred speaker layout when the footage supports it. */
  layout: "auto" | "single" | "split";
  accentColour: string;
  logo: BrandKitLogo | null;
  createdAt: string;
  updatedAt: string;
}

export class BrandKitValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrandKitValidationError";
  }
}

const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/;

const clampNumber = (value: unknown, low: number, high: number, fallback: number) => {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(high, Math.max(low, parsed));
};

const readString = (value: unknown, fallback: string, maxLength = 120) => {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : fallback;
};

const readColour = (value: unknown, fallback: string) => {
  if (typeof value === "string" && HEX_COLOUR.test(value.trim())) return value.trim().toUpperCase();
  return fallback;
};

const readEnum = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => {
  if (typeof value === "string") {
    const match = allowed.find((item) => item === value.trim().toLowerCase());
    if (match) return match;
  }
  return fallback;
};

/**
 * Coerce arbitrary client input into a valid kit.
 *
 * Every field falls back to a sane default rather than rejecting the whole
 * payload: a brand kit is a preferences record, and losing an entire save
 * because one colour was malformed would be worse than correcting it. The one
 * hard requirement is a name, because a kit the user cannot identify in a list
 * is useless to them.
 */
export function normaliseBrandKit(input: unknown, existing?: BrandKit): BrandKit {
  const source = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const name = readString(source.name, existing?.name ?? "", 80);
  if (!name) throw new BrandKitValidationError("Give the brand kit a name.");

  const captionSource = (source.captions && typeof source.captions === "object"
    ? source.captions
    : {}) as Record<string, unknown>;

  let logo: BrandKitLogo | null = existing?.logo ?? null;
  if (source.logo === null) {
    logo = null;
  } else if (source.logo && typeof source.logo === "object") {
    const logoSource = source.logo as Record<string, unknown>;
    const file = readString(logoSource.file, existing?.logo?.file ?? "", 200);
    // A logo path must stay inside the kit's own asset directory; a traversal
    // or absolute path would let a saved kit read arbitrary host files at
    // render time.
    if (file && !file.includes("..") && !path.isAbsolute(file)) {
      logo = {
        file,
        corner: readEnum(logoSource.corner, LOGO_CORNERS, existing?.logo?.corner ?? "bottom-right"),
        scalePercent: clampNumber(logoSource.scalePercent, 2, 40, existing?.logo?.scalePercent ?? 12),
        opacity: clampNumber(logoSource.opacity, 0.05, 1, existing?.logo?.opacity ?? 0.9),
      };
    }
  }

  const now = new Date().toISOString();
  return {
    id: existing?.id ?? crypto.randomUUID(),
    name,
    captions: {
      font: readString(captionSource.font, existing?.captions.font ?? "Impact", 60),
      fontSize: Math.round(clampNumber(captionSource.fontSize, 20, 160, existing?.captions.fontSize ?? 74)),
      colour: readColour(captionSource.colour, existing?.captions.colour ?? "#FFFFFF"),
      position: readEnum(captionSource.position, CAPTION_POSITIONS, existing?.captions.position ?? "bottom"),
      style: readEnum(captionSource.style, ["word", "phrase-highlight"] as const, existing?.captions.style ?? "phrase-highlight"),
    },
    aspectRatio: readEnum(source.aspectRatio, BRAND_ASPECT_RATIOS, existing?.aspectRatio ?? "9:16"),
    layout: readEnum(source.layout, ["auto", "single", "split"] as const, existing?.layout ?? "auto"),
    accentColour: readColour(source.accentColour, existing?.accentColour ?? "#4169F6"),
    logo,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

export class BrandKitStore {
  private readonly file: string;

  constructor(private readonly root: string) {
    this.file = path.join(root, "brand-kits.json");
  }

  private async readAll(): Promise<BrandKit[]> {
    try {
      const raw = await fs.readFile(this.file, "utf8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      // A missing or corrupt store is an empty store, never a hard failure:
      // the clipper must still open and render without any saved kits.
      return [];
    }
  }

  private async writeAll(kits: BrandKit[]): Promise<void> {
    await fs.mkdir(this.root, { recursive: true });
    // Write-then-rename so an interrupted save cannot truncate the existing
    // kits into an unreadable file.
    const temporary = `${this.file}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(kits, null, 2), "utf8");
    await fs.rename(temporary, this.file);
  }

  async list(): Promise<BrandKit[]> {
    const kits = await this.readAll();
    return kits.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string): Promise<BrandKit | null> {
    const kits = await this.readAll();
    return kits.find((kit) => kit.id === id) ?? null;
  }

  async save(input: unknown, id?: string): Promise<BrandKit> {
    const kits = await this.readAll();
    const existing = id ? kits.find((kit) => kit.id === id) : undefined;
    if (id && !existing) throw new BrandKitValidationError("That brand kit no longer exists.");
    const kit = normaliseBrandKit(input, existing);
    const next = existing ? kits.map((item) => (item.id === kit.id ? kit : item)) : [...kits, kit];
    await this.writeAll(next);
    return kit;
  }

  async remove(id: string): Promise<boolean> {
    const kits = await this.readAll();
    const next = kits.filter((kit) => kit.id !== id);
    if (next.length === kits.length) return false;
    await this.writeAll(next);
    return true;
  }
}

/** Map a stored kit onto the clipper pipeline's own config field names. */
export function brandKitToClipConfig(kit: BrandKit) {
  return {
    font: kit.captions.font,
    font_size: kit.captions.fontSize,
    text_colour: kit.captions.colour,
    position: kit.captions.position,
    subtitle_style: kit.captions.style,
    aspect_ratio: kit.aspectRatio,
  };
}

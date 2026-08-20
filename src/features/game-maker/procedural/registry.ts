/**
 * Generator registry + tool discovery (spec §67, §71).
 *
 * The model sees a short list of generator names and one-line summaries.
 * It asks for a schema only when it has decided to use one, which keeps the
 * tool surface small enough for a modest model to stay reliable.
 */
import { z } from "zod";
import type { GeneratorDefinition, GeneratorContext, GeneratorOutput } from "./generator";
import { buildingGenerator } from "./building";
import { settlementGenerator } from "./settlement";
import { fortressGenerator } from "./fortress";
import { dungeonGenerator } from "./dungeon";
import { terrainGenerator } from "./terrain";
import { roadGenerator } from "./roads";
import { vegetationGenerator } from "./vegetation";
import { characterGenerator } from "./characters";
import { tilemap2DGenerator } from "./tilemap2d";
import { voxelGenerator } from "./voxel";
import { propGenerator } from "./props";

const ALL: GeneratorDefinition[] = [
  terrainGenerator as GeneratorDefinition,
  settlementGenerator as GeneratorDefinition,
  fortressGenerator as GeneratorDefinition,
  dungeonGenerator as GeneratorDefinition,
  buildingGenerator as GeneratorDefinition,
  roadGenerator as GeneratorDefinition,
  vegetationGenerator as GeneratorDefinition,
  characterGenerator as GeneratorDefinition,
  propGenerator as GeneratorDefinition,
  tilemap2DGenerator as GeneratorDefinition,
  voxelGenerator as GeneratorDefinition,
];

const BY_NAME = new Map(ALL.map((generator) => [generator.name, generator]));

export function listGenerators(mode?: "3d" | "2d" | "voxel") {
  return ALL.filter((generator) => !mode || generator.modes.includes(mode)).map((generator) => ({
    name: generator.name,
    version: generator.version,
    summary: generator.summary,
    modes: generator.modes,
  }));
}

export function getGenerator(name: string): GeneratorDefinition | undefined {
  return BY_NAME.get(name);
}

/** JSON Schema for one generator, fetched only when the model commits to it. */
export function generatorSchema(name: string): unknown {
  const generator = BY_NAME.get(name);
  if (!generator) return undefined;
  return z.toJSONSchema(generator.schema, { io: "input" });
}

export class GeneratorError extends Error {
  code: string;
  hint?: string;
  constructor(code: string, message: string, hint?: string) {
    super(message);
    this.code = code;
    this.hint = hint;
    this.name = "GeneratorError";
  }
}

/** Validate parameters and run a generator. The only entry point tools use. */
export function runGenerator(
  name: string,
  context: GeneratorContext,
  rawParameters: unknown,
  seed: number,
): GeneratorOutput {
  const generator = BY_NAME.get(name);
  if (!generator) {
    throw new GeneratorError(
      "UNKNOWN_GENERATOR",
      `No generator named "${name}".`,
      `Available generators: ${ALL.map((entry) => entry.name).join(", ")}. Call tool.discover to see what each one does.`,
    );
  }
  const parsed = generator.schema.safeParse(rawParameters ?? {});
  if (!parsed.success) {
    const detail = parsed.error.issues.slice(0, 12).map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
    throw new GeneratorError(
      "INVALID_PARAMETERS",
      `Parameters for "${name}" failed validation — ${detail}`,
      `Fetch the exact schema with tool.discover({ generator: "${name}" }) and resend.`,
    );
  }
  return generator.run(context, parsed.data, Math.trunc(seed) || 1);
}

/**
 * Keyword search over generator summaries (spec §71). Deliberately simple:
 * the point is to narrow 11 generators to 2–3, not to be a search engine.
 */
export function discoverGenerators(need: string, mode?: "3d" | "2d" | "voxel") {
  const terms = need.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length > 2);
  const scored = listGenerators(mode).map((generator) => {
    const haystack = `${generator.name} ${generator.summary}`.toLowerCase();
    const score = terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
    return { ...generator, score };
  });
  const matched = scored.filter((generator) => generator.score > 0).sort((a, b) => b.score - a.score);
  return (matched.length ? matched : scored).slice(0, 5).map(({ score: _score, ...rest }) => rest);
}

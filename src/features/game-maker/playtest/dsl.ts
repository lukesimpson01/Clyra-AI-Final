/**
 * The playtest DSL (spec §127, §128).
 *
 * A test is a short script the bot executes against the *running* game:
 *
 *   spawn player at village_spawn
 *   move player to castle_gate
 *   assert player reached castle_gate
 *   interact castle_gate
 *   assert castle_gate.open == true
 *   assert runtime_errors == 0
 *
 * Parsed into a machine-readable instruction list here; executed by
 * runner.ts. Parsing is strict and reports the offending line, because a
 * silently-skipped assertion is worse than a failed one.
 */

export type Comparison = "==" | "!=" | ">" | ">=" | "<" | "<=";

export type Instruction =
  | { op: "spawn"; target: string; line: number }
  | { op: "move"; target: string; line: number }
  | { op: "moveTo"; position: [number, number, number]; line: number }
  | { op: "press"; action: string; line: number }
  | { op: "hold"; action: string; seconds: number; line: number }
  | { op: "interact"; target?: string; line: number }
  | { op: "attack"; target?: string; untilDead: boolean; line: number }
  | { op: "wait"; seconds: number; line: number }
  | { op: "look"; yawDegrees: number; pitchDegrees: number; line: number }
  | { op: "assertReached"; target: string; line: number }
  | { op: "assertProperty"; path: string; comparison: Comparison; value: string | number | boolean; line: number }
  | { op: "assertEvent"; event: string; atLeast: number; line: number }
  | { op: "assertNoEvent"; event: string; line: number };

export interface ParseError {
  line: number;
  text: string;
  message: string;
}

export interface ParsedTest {
  instructions: Instruction[];
  errors: ParseError[];
}

function parseValue(raw: string): string | number | boolean {
  const trimmed = raw.trim().replace(/^["']|["']$/g, "");
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) && trimmed !== "" ? numeric : trimmed;
}

const COMPARISONS: Comparison[] = ["==", "!=", ">=", "<=", ">", "<"];

export function parseTest(source: string): ParsedTest {
  const instructions: Instruction[] = [];
  const errors: ParseError[] = [];
  const lines = source.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = index + 1;
    const text = lines[index]!.split("#")[0]!.trim();
    if (!text) continue;

    const fail = (message: string) => errors.push({ line, text, message });

    // spawn player at <marker|x,y,z>
    let match = text.match(/^spawn\s+player\s+at\s+(.+)$/i);
    if (match) {
      instructions.push({ op: "spawn", target: match[1]!.trim(), line });
      continue;
    }

    // move player to <entity|region|x,y,z>
    match = text.match(/^move\s+(?:player\s+)?(?:to|into)\s+(.+)$/i);
    if (match) {
      const target = match[1]!.trim();
      const coordinates = target.match(/^\(?\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)?$/);
      if (coordinates) {
        instructions.push({ op: "moveTo", position: [Number(coordinates[1]), Number(coordinates[2]), Number(coordinates[3])], line });
      } else {
        instructions.push({ op: "move", target, line });
      }
      continue;
    }

    // press <action>  /  hold <action> for <n>s
    match = text.match(/^hold\s+(\w+)\s+for\s+([\d.]+)s?$/i);
    if (match) {
      instructions.push({ op: "hold", action: match[1]!, seconds: Number(match[2]), line });
      continue;
    }
    match = text.match(/^press\s+(\w+)$/i);
    if (match) {
      instructions.push({ op: "press", action: match[1]!, line });
      continue;
    }

    match = text.match(/^interact(?:\s+(.+))?$/i);
    if (match) {
      instructions.push({ op: "interact", target: match[1]?.trim(), line });
      continue;
    }

    match = text.match(/^attack\s+(\S+)(\s+until\s+dead)?$/i);
    if (match) {
      instructions.push({ op: "attack", target: match[1], untilDead: Boolean(match[2]), line });
      continue;
    }
    if (/^attack$/i.test(text)) {
      instructions.push({ op: "attack", untilDead: false, line });
      continue;
    }

    // look down 40 / look up 15 / look left 90 / look right 30
    match = text.match(/^look\s+(up|down|left|right)\s+([\d.]+)$/i);
    if (match) {
      const amount = Number(match[2]);
      const direction = match[1]!.toLowerCase();
      instructions.push({
        op: "look",
        yawDegrees: direction === "left" ? -amount : direction === "right" ? amount : 0,
        pitchDegrees: direction === "down" ? -amount : direction === "up" ? amount : 0,
        line,
      });
      continue;
    }

    match = text.match(/^wait\s+([\d.]+)s?$/i);
    if (match) {
      instructions.push({ op: "wait", seconds: Number(match[1]), line });
      continue;
    }

    if (/^assert\s+/i.test(text)) {
      const body = text.replace(/^assert\s+/i, "").trim();

      let assertion = body.match(/^player\s+reached\s+(.+)$/i);
      if (assertion) {
        instructions.push({ op: "assertReached", target: assertion[1]!.trim(), line });
        continue;
      }

      assertion = body.match(/^event\s+(\w+)(?:\s+at\s+least\s+(\d+))?$/i);
      if (assertion) {
        instructions.push({ op: "assertEvent", event: assertion[1]!, atLeast: Number(assertion[2] ?? 1), line });
        continue;
      }

      assertion = body.match(/^no\s+event\s+(\w+)$/i);
      if (assertion) {
        instructions.push({ op: "assertNoEvent", event: assertion[1]!, line });
        continue;
      }

      const comparison = COMPARISONS.find((candidate) => body.includes(` ${candidate} `));
      if (comparison) {
        const [path, value] = body.split(` ${comparison} `);
        instructions.push({ op: "assertProperty", path: path!.trim(), comparison, value: parseValue(value!), line });
        continue;
      }

      fail(`Could not read this assertion. Use "assert player reached X", "assert X.prop == value", "assert event NAME" or "assert no event NAME".`);
      continue;
    }

    fail(`Unknown instruction. Supported: spawn, move, press, hold, interact, attack, wait, look, assert.`);
  }

  return { instructions, errors };
}

/** Render a parsed test back to canonical DSL — used in diffs and docs. */
export function formatTest(instructions: Instruction[]): string {
  return instructions
    .map((instruction) => {
      switch (instruction.op) {
        case "spawn":
          return `spawn player at ${instruction.target}`;
        case "move":
          return `move player to ${instruction.target}`;
        case "moveTo":
          return `move player to ${instruction.position.join(", ")}`;
        case "press":
          return `press ${instruction.action}`;
        case "hold":
          return `hold ${instruction.action} for ${instruction.seconds}s`;
        case "interact":
          return instruction.target ? `interact ${instruction.target}` : "interact";
        case "attack":
          return `attack${instruction.target ? ` ${instruction.target}` : ""}${instruction.untilDead ? " until dead" : ""}`;
        case "wait":
          return `wait ${instruction.seconds}s`;
        case "look": {
          if (instruction.pitchDegrees) return `look ${instruction.pitchDegrees < 0 ? "down" : "up"} ${Math.abs(instruction.pitchDegrees)}`;
          return `look ${instruction.yawDegrees < 0 ? "left" : "right"} ${Math.abs(instruction.yawDegrees)}`;
        }
        case "assertReached":
          return `assert player reached ${instruction.target}`;
        case "assertProperty":
          return `assert ${instruction.path} ${instruction.comparison} ${String(instruction.value)}`;
        case "assertEvent":
          return `assert event ${instruction.event}${instruction.atLeast > 1 ? ` at least ${instruction.atLeast}` : ""}`;
        case "assertNoEvent":
          return `assert no event ${instruction.event}`;
      }
    })
    .join("\n");
}

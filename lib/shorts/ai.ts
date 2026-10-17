// Structured script generation for Shorts templates. DeepSeek writes the words;
// it never touches media. Output must match a strict per-kind schema, and every
// field is validated and bounded before it reaches a project. A malformed reply
// gets one retry with the validation error as correction. There is no canned
// fallback script: with no key configured, generation says so.

import { chatComplete } from "../ai/provider-router";
import type { ShortsKind } from "./schema";

export type GenerateInput = {
  kind: Extract<ShortsKind, "fake-text" | "would-rather" | "reddit-story" | "narrated-story" | "quiz" | "list" | "gameplay-story">;
  prompt: string;
  tone: string;
  count: number;
  mode?: string;
  participants?: string[];
  relationship?: string;
  ending?: string;
};

export type GeneratedMessage = { side: "left" | "right"; sender: string; text: string; reaction?: string };
export type GeneratedRound = { question: string; left: string; right: string; leftPercent: number };
export type GeneratedQuiz = { question: string; answers: string[]; correctIndex: number; explanation: string };
export type GeneratedScene = { role: "hook" | "setup" | "escalation" | "payoff" | "cta"; text: string };

export type GeneratedScript =
  | { kind: "fake-text"; title: string; participants: string[]; messages: GeneratedMessage[] }
  | { kind: "would-rather"; title: string; rounds: GeneratedRound[] }
  | { kind: "reddit-story"; title: string; author: string; body: string }
  | { kind: "gameplay-story"; title: string; author: string; body: string }
  | { kind: "narrated-story"; title: string; scenes: GeneratedScene[] }
  | { kind: "quiz"; title: string; questions: GeneratedQuiz[] }
  | { kind: "list"; title: string; items: Array<{ title: string; body: string }> };

export class ScriptGenerationError extends Error {
  constructor(message: string, readonly code: "no_key" | "invalid" | "provider") {
    super(message);
  }
}

const TONES = ["engaging", "funny", "dramatic", "wholesome", "dark-humor", "educational", "suspenseful"] as const;

function schemaFor(kind: GenerateInput["kind"], count: number) {
  switch (kind) {
    case "fake-text":
      return `{"title":"short title","participants":["name"],"messages":[{"side":"left|right","sender":"name","text":"message","reaction":"optional emoji or empty"}]}  — exactly ${count} messages, alternating naturally between the participants.`;
    case "would-rather":
      return `{"title":"short title","rounds":[{"question":"Would you rather...","left":"option A","right":"option B","leftPercent":55}]}  — exactly ${count} rounds. leftPercent is a simulated split between 20 and 80; it is not audience data.`;
    case "reddit-story":
      return `{"title":"post title","author":"u/username","body":"the story in 90-180 words, first person, with a clear turn near the end"}`;
    case "gameplay-story":
      return `{"title":"short title","author":"narrator name or handle","body":"the story in 90-180 words, first person, with a clear turn near the end, written to be read over gameplay footage"}`;
    case "narrated-story":
      return `{"title":"short title","scenes":[{"role":"hook|setup|escalation|payoff|cta","text":"one spoken sentence or two"}]}  — exactly ${count} scenes in order hook, setup, escalation, payoff, and optionally cta last.`;
    case "quiz":
      return `{"title":"quiz title","questions":[{"question":"question","answers":["a","b","c"],"correctIndex":0,"explanation":"one sentence why"}]}  — exactly ${count} questions, 2 to 4 answers each. Only use facts you are confident are correct; avoid anything disputed or time-sensitive.`;
    case "list":
      return `{"title":"list title","items":[{"title":"item name","body":"one or two sentences"}]}  — exactly ${count} items.`;
  }
}

function buildMessages(input: GenerateInput, correction?: string) {
  const system = [
    "You write concise vertical-video scripts for short-form social video.",
    "Return one JSON object only. No markdown, no commentary.",
    `Required schema: ${schemaFor(input.kind, input.count)}`,
    "Keep it family-friendly. Open with a strong hook. Make the payoff satisfying.",
    `Tone: ${input.tone}.`,
    input.mode ? `Mode: ${input.mode}.` : "",
    input.relationship ? `Relationship between participants: ${input.relationship}.` : "",
    input.ending ? `Ending to build toward: ${input.ending}.` : "",
    input.participants?.length ? `Participants to use: ${input.participants.join(", ")}.` : "",
    correction ? `Your previous reply was rejected: ${correction}. Fix it and return only valid JSON.` : "",
  ].filter(Boolean).join("\n");
  return [
    { role: "system" as const, content: system },
    { role: "user" as const, content: input.prompt },
  ];
}

export async function generateScript(input: GenerateInput): Promise<GeneratedScript> {
  if (!process.env.DEEPSEEK_API_KEY && !process.env.MY_LLM_API_KEY) {
    throw new ScriptGenerationError("Script generation needs a DeepSeek key. Add DEEPSEEK_API_KEY to .env.local, or write the text yourself.", "no_key");
  }
  let correction: string | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let raw: string;
    try {
      const completion = await chatComplete({
        capability: "fast-text",
        messages: buildMessages(input, correction),
        temperature: 0.7,
        maxTokens: 2_000,
        responseFormat: "json_object",
      });
      raw = completion.text;
    } catch (error) {
      throw new ScriptGenerationError(error instanceof Error ? error.message : "Script generation failed", "provider");
    }
    try {
      return validateScript(input, parseJsonObject(raw));
    } catch (error) {
      correction = error instanceof Error ? error.message : "invalid structure";
      if (attempt === 1) throw new ScriptGenerationError(`The script could not be validated: ${correction}`, "invalid");
    }
  }
  throw new ScriptGenerationError("The script could not be generated.", "invalid");
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  const candidate = fenced || (start >= 0 && end > start ? raw.slice(start, end + 1) : raw);
  const parsed = JSON.parse(candidate) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("the reply was not a JSON object");
  return parsed as Record<string, unknown>;
}

function text(value: unknown, max: number, field: string) {
  const out = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!out) throw new Error(`${field} is empty`);
  return out.slice(0, max);
}

function list<T>(value: unknown, field: string, min: number, max: number, map: (item: unknown) => T): T[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be a list`);
  const items = value.slice(0, max).map(map);
  if (items.length < min) throw new Error(`${field} needs at least ${min} entries`);
  return items;
}

export function validateScript(input: GenerateInput, data: Record<string, unknown>): GeneratedScript {
  const title = text(data.title, 120, "title");
  switch (input.kind) {
    case "fake-text": {
      const messages = list(data.messages, "messages", 2, 30, (raw) => {
        const row = raw as Record<string, unknown>;
        return {
          side: row.side === "right" ? ("right" as const) : ("left" as const),
          sender: text(row.sender || "Them", 40, "sender"),
          text: text(row.text, 280, "message text"),
          reaction: row.reaction ? String(row.reaction).slice(0, 4) : undefined,
        };
      });
      const participants = Array.from(new Set(messages.map((message) => message.sender))).slice(0, 4);
      return { kind: "fake-text", title, participants, messages };
    }
    case "would-rather": {
      const rounds = list(data.rounds, "rounds", 1, 12, (raw) => {
        const row = raw as Record<string, unknown>;
        const percent = Number(row.leftPercent);
        return {
          question: text(row.question, 160, "question"),
          left: text(row.left, 90, "option A"),
          right: text(row.right, 90, "option B"),
          leftPercent: Number.isFinite(percent) ? Math.min(80, Math.max(20, Math.round(percent))) : 50,
        };
      });
      return { kind: "would-rather", title, rounds };
    }
    case "reddit-story": {
      const body = text(data.body, 2_000, "story body");
      return { kind: "reddit-story", title, author: text(data.author || "u/anonymous", 40, "author"), body };
    }
    case "gameplay-story": {
      const body = text(data.body, 2_000, "story body");
      return { kind: "gameplay-story", title, author: text(data.author || "Narrator", 40, "author"), body };
    }
    case "narrated-story": {
      const scenes = list(data.scenes, "scenes", 3, 8, (raw) => {
        const row = raw as Record<string, unknown>;
        const role = ["hook", "setup", "escalation", "payoff", "cta"].includes(String(row.role)) ? (String(row.role) as GeneratedScene["role"]) : "setup";
        return { role, text: text(row.text, 320, "scene text") };
      });
      return { kind: "narrated-story", title, scenes };
    }
    case "quiz": {
      const questions = list(data.questions, "questions", 1, 12, (raw) => {
        const row = raw as Record<string, unknown>;
        const answers = list(row.answers, "answers", 2, 4, (answer) => text(answer, 90, "answer"));
        const correctIndex = Number(row.correctIndex);
        if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= answers.length) throw new Error("correctIndex is out of range");
        return {
          question: text(row.question, 180, "question"),
          answers,
          correctIndex,
          explanation: text(row.explanation, 240, "explanation"),
        };
      });
      return { kind: "quiz", title, questions };
    }
    case "list": {
      const items = list(data.items, "items", 2, 12, (raw) => {
        const row = raw as Record<string, unknown>;
        return { title: text(row.title, 100, "item title"), body: text(row.body, 240, "item body") };
      });
      return { kind: "list", title, items };
    }
  }
}

export function clampTone(value: unknown): string {
  const tone = String(value || "engaging");
  return (TONES as readonly string[]).includes(tone) ? tone : "engaging";
}

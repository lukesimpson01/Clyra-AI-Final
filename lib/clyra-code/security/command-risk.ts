/**
 * Classifies a shell command before Clyra runs it or records it. The classifier
 * splits a command into segments on pipes and separators, then judges each segment
 * by its executable and arguments, so a dump is recognised whether or not it is
 * piped into grep.
 *
 * It is an audit and policy input. Clyra cannot stop a command that the agent's
 * runtime executes itself, so the runtime enforcement is the environment scrub in
 * environment.ts. Commands Clyra runs directly use this classifier as a gate.
 */

export type CommandRisk =
  | "normal"
  | "environment-inspection"
  | "credential-access"
  | "external-write"
  | "destructive";

export type CommandClassification = {
  risk: CommandRisk;
  /** The segment that produced the classification, trimmed for display. */
  segment?: string;
  reason: string;
};

const PRIORITY: CommandRisk[] = ["destructive", "credential-access", "environment-inspection", "external-write", "normal"];

/** Splits on pipes, sequencing operators and newlines. Quoted content is not split. */
export function splitSegments(command: string): string[] {
  const segments: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    const pair = command.slice(i, i + 2);
    if (pair === "&&" || pair === "||") {
      segments.push(current);
      current = "";
      i += 1;
      continue;
    }
    if (ch === "|" || ch === ";" || ch === "\n") {
      segments.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  segments.push(current);
  return segments.map((segment) => segment.trim()).filter(Boolean);
}

/** Tokens of one segment, with leading `NAME=value` assignments removed. */
function tokens(segment: string): string[] {
  const parts = segment.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  while (parts.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(parts[0] ?? "")) parts.shift();
  return parts.map((part) => part.replace(/^["']|["']$/g, ""));
}

function environmentSegment(parts: string[]): string | null {
  const [head, ...args] = parts;
  if (!head) return null;
  const name = head.toLowerCase().replace(/\.exe$/, "");
  const flags = args.filter((arg) => arg.startsWith("-"));
  const operands = args.filter((arg) => !arg.startsWith("-"));

  // POSIX: bare env, printenv, export -p, declare -x / -p, bare set, compgen -e / -v
  if (name === "env" && operands.length === 0) return "env lists the whole environment";
  if (name === "printenv" && operands.length === 0) return "printenv lists the whole environment";
  if (name === "export" && (operands.length === 0 || flags.includes("-p"))) return "export lists exported variables";
  if (name === "declare" && (flags.includes("-x") || flags.includes("-p"))) return "declare lists exported variables";
  if (name === "set" && args.length === 0) return "set lists shell variables and the environment";
  if (name === "compgen" && (flags.includes("-e") || flags.includes("-v"))) return "compgen lists variables";

  // PowerShell and cmd: Get-ChildItem Env:, dir env:, Get-Item Env:*, gci env:*
  const listers = new Set(["get-childitem", "gci", "dir", "ls", "get-item", "gi", "get-content", "gc", "cat", "type"]);
  if (listers.has(name) && operands.some((arg) => /^env:/i.test(arg) || /^env:\*$/i.test(arg))) {
    return "PowerShell enumerates the Env: drive";
  }
  return null;
}

const CREDENTIAL = [
  /(^|[\s/"'])~?\/?\.ssh(\/|\s|$)/i,
  /id_(rsa|ed25519|ecdsa|dsa)\b/i,
  /\.aws\/credentials/i,
  /\.netrc\b/i,
  /\/proc\/[^\s]*\/environ/i,
  /\bsecurity\s+(find-generic-password|find-internet-password|dump-keychain)\b/i,
  /\bgh\s+auth\s+token\b/i,
  /(^|[\s/])\.env(\.[A-Za-z0-9_-]+)?($|\s)/i,
];

const DESTRUCTIVE = [
  /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r|-rf|-fr|--recursive)\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+clean\s+-[a-zA-Z]*[fd]/,
  /\bsudo\b/,
  /\bmkfs(\.|\s)/,
  /\bdd\b[^|;&]*\bof=/,
  /\brd\s+\/s\b/i,
  /\bdel\s+\/[sq]/i,
  /Remove-Item\b[^|;&]*-Recurse[^|;&]*-Force/i,
];

const EXTERNAL_WRITE = [
  /\bgit\s+push\b/,
  /\b(npm|pnpm|yarn)\s+publish\b/,
  /\bcurl\b[^|;&]*(-X\s*(POST|PUT|PATCH|DELETE)|--data|-d\s|-F\s|--form)/i,
  /\b(wrangler|vercel|netlify|fly|railway)\s+deploy\b/,
  /\bxcrun\s+(altool|notarytool)\b/,
  /\bfastlane\s+(pilot|deliver|upload)/,
  /\b(ssh|scp|sftp)\s/,
];

function firstMatch(patterns: RegExp[], text: string): RegExp | null {
  for (const pattern of patterns) if (pattern.test(text)) return pattern;
  return null;
}

/**
 * Classifies a whole command. The highest-priority risk across all segments wins,
 * so `env | grep DSH_` is environment-inspection and `rm -rf dist && env` is destructive.
 */
export function classifyCommand(command: string): CommandClassification {
  const findings: CommandClassification[] = [];
  for (const segment of splitSegments(command)) {
    const parts = tokens(segment);
    const env = environmentSegment(parts);
    if (env) findings.push({ risk: "environment-inspection", segment, reason: env });
    if (firstMatch(CREDENTIAL, segment)) findings.push({ risk: "credential-access", segment, reason: "reads a credential store or a sensitive file" });
    if (firstMatch(DESTRUCTIVE, segment)) findings.push({ risk: "destructive", segment, reason: "deletes, resets or overwrites data" });
    if (firstMatch(EXTERNAL_WRITE, segment)) findings.push({ risk: "external-write", segment, reason: "publishes, deploys or sends data outside this machine" });
  }
  // Whole-command checks for patterns that span segments.
  if (firstMatch(DESTRUCTIVE, command) && !findings.some((f) => f.risk === "destructive")) {
    findings.push({ risk: "destructive", reason: "deletes, resets or overwrites data" });
  }
  if (findings.length === 0) return { risk: "normal", reason: "No sensitive operation detected." };
  findings.sort((a, b) => PRIORITY.indexOf(a.risk) - PRIORITY.indexOf(b.risk));
  return findings[0];
}

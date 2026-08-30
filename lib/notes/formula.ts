/* Small expression language for database formula properties.

   Deliberately not eval(): formulas are user data and are evaluated on the
   server, so the grammar is closed — identifiers resolve only to declared
   functions and to properties of the record being evaluated. */

export type FormulaValue = number | string | boolean | Date | null;

type Token = { kind: "num" | "str" | "ident" | "op" | "punct"; value: string };

const OPERATORS = ["<=", ">=", "==", "!=", "&&", "||", "+", "-", "*", "/", "%", "<", ">", "="];

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index]!;
    if (/\s/.test(char)) { index += 1; continue; }
    if (char === '"' || char === "'") {
      let value = "";
      index += 1;
      while (index < source.length && source[index] !== char) {
        if (source[index] === "\\") index += 1;
        value += source[index++];
      }
      index += 1;
      tokens.push({ kind: "str", value });
      continue;
    }
    if (/[0-9]/.test(char) || (char === "." && /[0-9]/.test(source[index + 1] || ""))) {
      let value = "";
      while (index < source.length && /[0-9.]/.test(source[index]!)) value += source[index++];
      tokens.push({ kind: "num", value });
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      let value = "";
      while (index < source.length && /[A-Za-z0-9_]/.test(source[index]!)) value += source[index++];
      tokens.push({ kind: "ident", value });
      continue;
    }
    const operator = OPERATORS.find((candidate) => source.startsWith(candidate, index));
    if (operator) {
      tokens.push({ kind: "op", value: operator === "=" ? "==" : operator });
      index += operator.length;
      continue;
    }
    if ("(),".includes(char)) {
      tokens.push({ kind: "punct", value: char });
      index += 1;
      continue;
    }
    throw new Error(`Unexpected character "${char}"`);
  }
  return tokens;
}

type Node =
  | { kind: "lit"; value: FormulaValue }
  | { kind: "prop"; name: string }
  | { kind: "call"; name: string; args: Node[] }
  | { kind: "bin"; op: string; left: Node; right: Node }
  | { kind: "unary"; op: string; operand: Node };

const BINDING: Record<string, number> = {
  "||": 1, "&&": 2,
  "==": 3, "!=": 3, "<": 3, ">": 3, "<=": 3, ">=": 3,
  "+": 4, "-": 4,
  "*": 5, "/": 5, "%": 5,
};

function parse(tokens: Token[]): Node {
  let position = 0;
  const peek = () => tokens[position];
  const eat = (value?: string) => {
    const token = tokens[position];
    if (!token) throw new Error("Unexpected end of formula");
    if (value && token.value !== value) throw new Error(`Expected "${value}"`);
    position += 1;
    return token;
  };

  const parseAtom = (): Node => {
    const token = eat();
    if (token.kind === "num") return { kind: "lit", value: Number(token.value) };
    if (token.kind === "str") return { kind: "lit", value: token.value };
    if (token.value === "(") {
      const inner = parseExpression(0);
      eat(")");
      return inner;
    }
    if (token.value === "-") return { kind: "unary", op: "-", operand: parseAtom() };
    if (token.value === "!") return { kind: "unary", op: "!", operand: parseAtom() };
    if (token.kind === "ident") {
      if (peek()?.value === "(") {
        eat("(");
        const args: Node[] = [];
        if (peek()?.value !== ")") {
          args.push(parseExpression(0));
          while (peek()?.value === ",") { eat(","); args.push(parseExpression(0)); }
        }
        eat(")");
        if (token.value === "prop" && args[0]?.kind === "lit") {
          return { kind: "prop", name: String(args[0].value) };
        }
        return { kind: "call", name: token.value.toLowerCase(), args };
      }
      if (token.value === "true") return { kind: "lit", value: true };
      if (token.value === "false") return { kind: "lit", value: false };
      return { kind: "prop", name: token.value };
    }
    throw new Error(`Unexpected "${token.value}"`);
  };

  function parseExpression(minimum: number): Node {
    let left = parseAtom();
    for (;;) {
      const token = peek();
      if (!token || token.kind !== "op") break;
      const binding = BINDING[token.value];
      if (binding === undefined || binding < minimum) break;
      eat();
      const right = parseExpression(binding + 1);
      left = { kind: "bin", op: token.value, left, right };
    }
    return left;
  }

  const root = parseExpression(0);
  if (position !== tokens.length) throw new Error("Trailing input in formula");
  return root;
}

const toNumber = (value: FormulaValue): number => {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Date) return value.getTime();
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toText = (value: FormulaValue): string => {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
};

const truthy = (value: FormulaValue) =>
  value instanceof Date ? true : typeof value === "string" ? value !== "" : Boolean(value);

const asDate = (value: FormulaValue): Date | null => {
  if (value instanceof Date) return value;
  if (typeof value === "string" && value) {
    const date = new Date(value.includes("T") ? value : `${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  return null;
};

const DAY = 86_400_000;

const FUNCTIONS: Record<string, (args: FormulaValue[]) => FormulaValue> = {
  if: ([test, yes, no]) => (truthy(test ?? null) ? yes ?? null : no ?? null),
  and: (args) => args.every(truthy),
  or: (args) => args.some(truthy),
  not: ([value]) => !truthy(value ?? null),
  empty: ([value]) => value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length),
  concat: (args) => args.map(toText).join(""),
  join: (args) => args.slice(1).map(toText).join(toText(args[0] ?? "")),
  length: ([value]) => toText(value ?? null).length,
  upper: ([value]) => toText(value ?? null).toUpperCase(),
  lower: ([value]) => toText(value ?? null).toLowerCase(),
  contains: ([value, needle]) => toText(value ?? null).toLowerCase().includes(toText(needle ?? null).toLowerCase()),
  slice: ([value, from, to]) => toText(value ?? null).slice(toNumber(from ?? 0), to === undefined ? undefined : toNumber(to)),
  round: ([value, places]) => {
    const factor = Math.pow(10, toNumber(places ?? 0));
    return Math.round(toNumber(value ?? 0) * factor) / factor;
  },
  floor: ([value]) => Math.floor(toNumber(value ?? 0)),
  ceil: ([value]) => Math.ceil(toNumber(value ?? 0)),
  abs: ([value]) => Math.abs(toNumber(value ?? 0)),
  min: (args) => Math.min(...args.map(toNumber)),
  max: (args) => Math.max(...args.map(toNumber)),
  sum: (args) => args.reduce<number>((total, value) => total + toNumber(value), 0),
  now: () => new Date(),
  today: () => new Date(new Date().toISOString().slice(0, 10)),
  date: ([value]) => asDate(value ?? null),
  dateadd: ([value, amount, unit]) => {
    const date = asDate(value ?? null);
    if (!date) return null;
    const count = toNumber(amount ?? 0);
    const scale = { days: DAY, weeks: 7 * DAY, hours: 3_600_000, minutes: 60_000 }[toText(unit ?? "days")] ?? DAY;
    return new Date(date.getTime() + count * scale);
  },
  datebetween: ([from, to, unit]) => {
    const a = asDate(from ?? null);
    const b = asDate(to ?? null);
    if (!a || !b) return null;
    const scale = { days: DAY, weeks: 7 * DAY, hours: 3_600_000, minutes: 60_000 }[toText(unit ?? "days")] ?? DAY;
    return Math.round((b.getTime() - a.getTime()) / scale);
  },
  format: ([value]) => toText(value ?? null),
  number: ([value]) => toNumber(value ?? 0),
  tonumber: ([value]) => toNumber(value ?? 0),
};

export const FORMULA_FUNCTIONS = Object.keys(FUNCTIONS).sort();

function evaluate(node: Node, properties: Record<string, FormulaValue>): FormulaValue {
  switch (node.kind) {
    case "lit":
      return node.value;
    case "prop": {
      if (!(node.name in properties)) throw new Error(`Unknown property "${node.name}"`);
      return properties[node.name] ?? null;
    }
    case "unary": {
      const operand = evaluate(node.operand, properties);
      return node.op === "-" ? -toNumber(operand) : !truthy(operand);
    }
    case "call": {
      const fn = FUNCTIONS[node.name];
      if (!fn) throw new Error(`Unknown function "${node.name}"`);
      /* if() short-circuits so a divide-by-zero guard actually guards. */
      if (node.name === "if") {
        return truthy(evaluate(node.args[0]!, properties))
          ? evaluate(node.args[1] ?? { kind: "lit", value: null }, properties)
          : evaluate(node.args[2] ?? { kind: "lit", value: null }, properties);
      }
      return fn(node.args.map((arg) => evaluate(arg, properties)));
    }
    case "bin": {
      const left = evaluate(node.left, properties);
      if (node.op === "&&") return truthy(left) ? evaluate(node.right, properties) : false;
      if (node.op === "||") return truthy(left) ? left : evaluate(node.right, properties);
      const right = evaluate(node.right, properties);
      switch (node.op) {
        case "+":
          return typeof left === "string" || typeof right === "string"
            ? toText(left) + toText(right)
            : toNumber(left) + toNumber(right);
        case "-": return toNumber(left) - toNumber(right);
        case "*": return toNumber(left) * toNumber(right);
        case "/": return toNumber(right) === 0 ? null : toNumber(left) / toNumber(right);
        case "%": return toNumber(right) === 0 ? null : toNumber(left) % toNumber(right);
        case "==": return toText(left) === toText(right);
        case "!=": return toText(left) !== toText(right);
        case "<": return toNumber(left) < toNumber(right);
        case ">": return toNumber(left) > toNumber(right);
        case "<=": return toNumber(left) <= toNumber(right);
        case ">=": return toNumber(left) >= toNumber(right);
        default: throw new Error(`Unknown operator "${node.op}"`);
      }
    }
  }
}

const cache = new Map<string, Node>();

export function compileFormula(source: string): Node {
  const cached = cache.get(source);
  if (cached) return cached;
  const node = parse(tokenize(source));
  cache.set(source, node);
  return node;
}

/* Returns the value, or an { error } marker the table cell renders inline
   so a broken formula never silently reads as empty. */
export function runFormula(
  source: string,
  properties: Record<string, FormulaValue>,
): { value: FormulaValue } | { error: string } {
  try {
    return { value: evaluate(compileFormula(source), properties) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Formula error" };
  }
}

export function checkFormula(source: string, propertyNames: string[]): string | null {
  try {
    const stub = Object.fromEntries(propertyNames.map((name) => [name, null]));
    evaluate(compileFormula(source), stub);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Formula error";
  }
}

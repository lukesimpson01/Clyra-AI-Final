/* Deterministic writing helpers for Notes.
   They deliberately run entirely in the browser: no prompt, network request,
   or model is involved in recognising a snippet or calculating an answer. */

const CODE_PATTERNS = [
  [/^\s*(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*(?:=|;)/, "javascript"],
  [/^\s*(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/, "javascript"],
  [/^\s*(?:export\s+)?(?:default\s+)?(?:class|interface|type)\s+[A-Za-z_$][\w$]*/, "typescript"],
  [/^\s*(?:def|class)\s+[A-Za-z_]\w*\s*(?:\(|:)/, "python"],
  [/^\s*(?:from\s+\S+\s+import|import\s+[A-Za-z_]\w*(?:\.|\s|$))/, "python"],
  [/^\s*(?:print\(|if\s+__name__\s*==|for\s+\w+\s+in\s+)/, "python"],
  [/^\s*console\.(?:log|error|warn)\s*\(/, "javascript"],
  [/^\s*(?:SELECT\s+.+\s+FROM|INSERT\s+INTO|CREATE\s+TABLE|UPDATE\s+\S+\s+SET)\b/i, "sql"],
  [/^\s*(?:<!doctype\s+html|<html\b|<[A-Za-z][\w-]*(?:\s+[^>]*)?>)/i, "html"],
  [/^\s*#!\s*\/(?:usr\/bin\/env\s+)?(?:ba)?sh/, "bash"],
  [/^\s*(?:package\s+main|func\s+main\s*\()/, "go"],
];

/** Returns a language only when a line has a strong code signature. */
export function detectCodeLanguage(text) {
  const source = String(text || "");
  if (source.length < 4 || source.length > 20_000) return null;
  return CODE_PATTERNS.find(([pattern]) => pattern.test(source))?.[1] || null;
}

const FUNCTIONS = {
  sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil,
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos,
  atan: Math.atan, log: Math.log10, log10: Math.log10, ln: Math.log, exp: Math.exp,
};

function tokenise(source, allowVariable = false) {
  const tokens = [];
  const text = source
    .replace(/[−–—]/g, "-")
    .replace(/[×·]/g, "*")
    .replace(/÷/g, "/")
    .replace(/,/g, "")
    .replace(/(\d+(?:\.\d+)?)%/g, "($1/100)");
  let index = 0;
  while (index < text.length) {
    const rest = text.slice(index);
    const whitespace = rest.match(/^\s+/);
    if (whitespace) { index += whitespace[0].length; continue; }
    const number = rest.match(/^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i);
    if (number) { tokens.push({ type: "number", value: Number(number[0]) }); index += number[0].length; continue; }
    const name = rest.match(/^[A-Za-z_][A-Za-z_\d]*/);
    if (name) {
      const value = name[0].toLowerCase();
      if (value === "pi") tokens.push({ type: "number", value: Math.PI });
      else if (value === "e") tokens.push({ type: "number", value: Math.E });
      else if (allowVariable && value === "x") tokens.push({ type: "variable" });
      else if (FUNCTIONS[value]) tokens.push({ type: "function", value });
      else throw new Error("Unknown symbol");
      index += name[0].length; continue;
    }
    if ("+-*/^()".includes(rest[0])) { tokens.push({ type: rest[0] }); index += 1; continue; }
    throw new Error("Unsupported character");
  }
  /* Classroom notation commonly omits the multiplication sign (`2x`,
     `3(4 + 1)`). Make that explicit before parsing without ever evaluating
     arbitrary JavaScript. A function name still has to be followed by `(`. */
  const expanded = [];
  for (const token of tokens) {
    const previous = expanded.at(-1);
    const endsValue = previous && ["number", "variable", ")"].includes(previous.type);
    const startsValue = ["number", "variable", "function", "("].includes(token.type);
    if (endsValue && startsValue) expanded.push({ type: "*" });
    expanded.push(token);
  }
  return expanded;
}

/* A small Pratt parser. Values can be plain numbers or ax+b forms, which
   lets the same safe parser solve the common one-variable classroom equation. */
function parseExpression(source, allowVariable = false) {
  const tokens = tokenise(source, allowVariable);
  let index = 0;
  const scalar = (value) => allowVariable ? { a: 0, b: value } : value;
  const variable = () => ({ a: 1, b: 0 });
  const isAffine = (value) => value && typeof value === "object" && "a" in value;
  const add = (left, right, sign = 1) => isAffine(left)
    ? { a: left.a + sign * right.a, b: left.b + sign * right.b }
    : left + sign * right;
  const multiply = (left, right) => {
    if (!isAffine(left)) return left * right;
    if (left.a && right.a) throw new Error("Non-linear equation");
    return { a: left.a * right.b + left.b * right.a, b: left.b * right.b };
  };
  const divide = (left, right) => {
    if (isAffine(right) && right.a) throw new Error("Variable divisor");
    const divisor = isAffine(right) ? right.b : right;
    if (!divisor) throw new Error("Division by zero");
    return isAffine(left) ? { a: left.a / divisor, b: left.b / divisor } : left / divisor;
  };
  const power = (left, right) => {
    if (isAffine(left) && (left.a || right.a)) throw new Error("Non-linear equation");
    const base = isAffine(left) ? left.b : left;
    const exponent = isAffine(right) ? right.b : right;
    return scalar(base ** exponent);
  };
  const peek = () => tokens[index];
  const take = () => tokens[index++];
  const parsePrimary = () => {
    const token = take();
    if (!token) throw new Error("Expected a value");
    if (token.type === "number") return scalar(token.value);
    if (token.type === "variable") return variable();
    if (token.type === "+") return parsePrimary();
    if (token.type === "-") { const value = parsePrimary(); return isAffine(value) ? { a: -value.a, b: -value.b } : -value; }
    if (token.type === "(") { const value = parseBinary(0); if (take()?.type !== ")") throw new Error("Missing closing parenthesis"); return value; }
    if (token.type === "function") {
      if (take()?.type !== "(") throw new Error("Expected opening parenthesis");
      const value = parseBinary(0);
      if (take()?.type !== ")" || isAffine(value)) throw new Error("Function needs a number");
      return scalar(FUNCTIONS[token.value](value));
    }
    throw new Error("Expected a value");
  };
  const precedence = { "+": 1, "-": 1, "*": 2, "/": 2, "^": 3 };
  const parseBinary = (minimum) => {
    let left = parsePrimary();
    while (true) {
      const operator = peek()?.type;
      const level = precedence[operator];
      if (!level || level < minimum) break;
      take();
      const right = parseBinary(level + (operator === "^" ? 0 : 1));
      left = operator === "+" ? add(left, right) : operator === "-" ? add(left, right, -1)
        : operator === "*" ? multiply(left, right) : operator === "/" ? divide(left, right) : power(left, right);
    }
    return left;
  };
  const result = parseBinary(0);
  if (index !== tokens.length) throw new Error("Unexpected input");
  if (typeof result === "number" && !Number.isFinite(result)) throw new Error("Result is not finite");
  return result;
}

/* Translate the handful of verbal forms students naturally type into the
   compact syntax the safe parser understands. This is deliberately a closed
   vocabulary, rather than a JavaScript evaluator: unknown words still make
   the helper return null. */
function normaliseMathWords(text) {
  return String(text || "")
    .replace(/\bsquare\s+root\s+of\s+/gi, "sqrt(")
    .replace(/\bto\s+the\s+power\s+of\b/gi, "^")
    .replace(/\braised\s+to\b/gi, "^")
    .replace(/\bsquared\b/gi, "^2")
    .replace(/\bcubed\b/gi, "^3")
    .replace(/\bmultiplied\s+by\b|\btimes\b/gi, "*")
    .replace(/\bdivided\s+by\b|\bover\b/gi, "/")
    .replace(/\bplus\b/gi, "+")
    .replace(/\bminus\b/gi, "-")
    .replace(/\bgreater\s+than\s+or\s+equal\s+to\b/gi, ">=")
    .replace(/\bless\s+than\s+or\s+equal\s+to\b/gi, "<=")
    .replace(/\bequals?\b/gi, "=")
    .replace(/\bof\b/gi, "*")
    // `square root of 81` becomes `sqrt(81)`. A root expression with an
    // explicit closing parenthesis was already valid and is left untouched.
    .replace(/sqrt\(([^()]+?)(?=$|\s*[?!.]+$)/gi, "sqrt($1)");
}

const trimQuestion = (text) => normaliseMathWords(String(text || "").trim()
  .replace(/^(?:what\s+is|calculate|compute|evaluate|solve|find\s+(?:the\s+)?(?:value|root|roots|solution|solutions)\s+of)\s+/i, "")
  .replace(/[?!.]+$/, "").trim());

const formatNumber = (value) => Number.isInteger(value)
  ? String(value)
  : Number(value.toPrecision(12)).toLocaleString(undefined, { maximumFractionDigits: 10 });

/* -------------------------------------------------------------------------
   Symbolic polynomial parser

   The old affine parser is intentionally retained for compatibility with
   existing notes. This second, closed parser gives the inline helper a much
   wider deterministic surface: x/y polynomials (including implicit `2x`),
   quadratic roots, and two-equation linear systems. It never evaluates
   user-provided JavaScript or calls a network/AI service. Expressions that
   are outside the supported algebra return null and simply leave prose alone.
--------------------------------------------------------------------------- */
const POLY_LIMIT = 4;
const poly = (constant = 0) => ({ terms: new Map([["0,0", Number(constant) || 0]]) });
const expKey = (x, y) => `${x},${y}`;
const readKey = (key) => key.split(",").map(Number);
const cleanPoly = (value) => {
  for (const [key, coefficient] of value.terms) {
    if (!Number.isFinite(coefficient) || Math.abs(coefficient) < 1e-12) value.terms.delete(key);
  }
  if (!value.terms.size) value.terms.set("0,0", 0);
  return value;
};
const polyAdd = (left, right, sign = 1) => {
  const result = poly();
  result.terms.clear();
  for (const [key, coefficient] of left.terms) result.terms.set(key, coefficient);
  for (const [key, coefficient] of right.terms) result.terms.set(key, (result.terms.get(key) || 0) + sign * coefficient);
  return cleanPoly(result);
};
const polyScale = (value, factor) => {
  const result = poly();
  result.terms.clear();
  for (const [key, coefficient] of value.terms) result.terms.set(key, coefficient * factor);
  return cleanPoly(result);
};
const polyMultiply = (left, right) => {
  const result = poly();
  result.terms.clear();
  for (const [leftKey, leftValue] of left.terms) {
    const [lx, ly] = readKey(leftKey);
    for (const [rightKey, rightValue] of right.terms) {
      const [rx, ry] = readKey(rightKey);
      if (lx + rx + ly + ry > POLY_LIMIT) throw new Error("Polynomial degree is too high");
      const key = expKey(lx + rx, ly + ry);
      result.terms.set(key, (result.terms.get(key) || 0) + leftValue * rightValue);
    }
  }
  return cleanPoly(result);
};
const polyPower = (base, exponent) => {
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > POLY_LIMIT) throw new Error("Unsupported exponent");
  let result = poly(1);
  for (let index = 0; index < exponent; index += 1) result = polyMultiply(result, base);
  return result;
};

function tokenisePolynomial(source) {
  const tokens = [];
  const text = String(source || "")
    .replace(/[−–—]/g, "-").replace(/[×·]/g, "*").replace(/÷/g, "/")
    .replace(/,/g, "").replace(/(\d+(?:\.\d+)?)%/g, "($1/100)");
  let index = 0;
  while (index < text.length) {
    const rest = text.slice(index);
    const whitespace = rest.match(/^\s+/);
    if (whitespace) { index += whitespace[0].length; continue; }
    const number = rest.match(/^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i);
    if (number) { tokens.push({ type: "number", value: Number(number[0]) }); index += number[0].length; continue; }
    const name = rest.match(/^[A-Za-z_][A-Za-z_\d]*/);
    if (name) {
      const value = name[0].toLowerCase();
      if (value === "pi") tokens.push({ type: "number", value: Math.PI });
      else if (value === "e") tokens.push({ type: "number", value: Math.E });
      else if (value === "x" || value === "y") tokens.push({ type: "variable", value });
      else if (FUNCTIONS[value]) tokens.push({ type: "function", value });
      else throw new Error("Unknown symbol");
      index += name[0].length; continue;
    }
    if ("+-*/^()".includes(rest[0])) { tokens.push({ type: rest[0] }); index += 1; continue; }
    throw new Error("Unsupported character");
  }
  const expanded = [];
  for (const token of tokens) {
    const previous = expanded.at(-1);
    const endsValue = previous && ["number", "variable", ")"].includes(previous.type);
    const startsValue = ["number", "variable", "function", "("].includes(token.type);
    if (endsValue && startsValue) expanded.push({ type: "*" });
    expanded.push(token);
  }
  return expanded;
}

function parsePolynomial(source) {
  const tokens = tokenisePolynomial(source);
  let index = 0;
  const peek = () => tokens[index];
  const take = () => tokens[index++];
  const precedence = { "+": 1, "-": 1, "*": 2, "/": 2, "^": 3 };
  const parsePrimary = () => {
    const token = take();
    if (!token) throw new Error("Expected a value");
    if (token.type === "number") return poly(token.value);
    if (token.type === "variable") return polyVariable(token.value);
    if (token.type === "+") return parsePrimary();
    if (token.type === "-") return polyScale(parsePrimary(), -1);
    if (token.type === "(") {
      const value = parseBinary(0);
      if (take()?.type !== ")") throw new Error("Missing closing parenthesis");
      return value;
    }
    if (token.type === "function") {
      if (take()?.type !== "(") throw new Error("Expected opening parenthesis");
      const value = parseBinary(0);
      if (take()?.type !== ")" || value.terms.size !== 1 || !value.terms.has("0,0")) throw new Error("Function needs a number");
      return poly(FUNCTIONS[token.value](value.terms.get("0,0")));
    }
    throw new Error("Expected a value");
  };
  const parseBinary = (minimum) => {
    let left = parsePrimary();
    while (true) {
      const operator = peek()?.type;
      const level = precedence[operator];
      if (!level || level < minimum) break;
      take();
      const right = parseBinary(level + (operator === "^" ? 0 : 1));
      if (operator === "+") left = polyAdd(left, right);
      else if (operator === "-") left = polyAdd(left, right, -1);
      else if (operator === "*") left = polyMultiply(left, right);
      else if (operator === "/") {
        if (right.terms.size !== 1 || !right.terms.has("0,0")) throw new Error("Variable divisor");
        const divisor = right.terms.get("0,0");
        if (!divisor) throw new Error("Division by zero");
        left = polyScale(left, 1 / divisor);
      } else {
        if (right.terms.size !== 1 || !right.terms.has("0,0")) throw new Error("Variable exponent");
        left = polyPower(left, right.terms.get("0,0"));
      }
    }
    return left;
  };
  const result = parseBinary(0);
  if (index !== tokens.length) throw new Error("Unexpected input");
  return cleanPoly(result);
}

function polyVariable(name) {
  return { terms: new Map([[name === "x" ? "1,0" : "0,1", 1]]) };
}

const coefficient = (value, variable) => {
  const key = variable === "x" ? "1,0" : "0,1";
  return value.terms.get(key) || 0;
};
const constantTerm = (value) => value.terms.get("0,0") || 0;
const variablesIn = (value) => [...value.terms.keys()].some((key) => key !== "0,0");
const degreeFor = (value, variable) => {
  let degree = 0;
  for (const key of value.terms.keys()) {
    const [x, y] = readKey(key);
    degree = Math.max(degree, variable === "x" ? x : y);
  }
  return degree;
};
const formatSigned = (value, variable, first = false) => {
  if (Math.abs(value) < 1e-12) return "";
  const sign = value < 0 ? " − " : first ? "" : " + ";
  const magnitude = Math.abs(value);
  const coefficientText = Math.abs(magnitude - 1) < 1e-12 ? "" : formatNumber(magnitude);
  return `${sign}${coefficientText}${variable}`;
};

function solvePolynomialEquation(leftSource, rightSource) {
  const left = parsePolynomial(leftSource);
  const right = parsePolynomial(rightSource);
  const difference = polyAdd(left, right, -1);
  const vars = ["x", "y"].filter((name) => degreeFor(difference, name) > 0);
  if (!vars.length) return Math.abs(constantTerm(difference)) < 1e-12 ? { kind: "equation", answer: "All values satisfy this equation" } : { kind: "equation", answer: "No solution" };
  if (vars.length === 2 && degreeFor(difference, "x") <= 1 && degreeFor(difference, "y") <= 1) {
    const yCoefficient = coefficient(difference, "y");
    const xCoefficient = coefficient(difference, "x");
    if (Math.abs(yCoefficient) < 1e-12) return null;
    const constant = constantTerm(difference);
    const xValue = -xCoefficient / yCoefficient;
    const xPart = Math.abs(xValue) < 1e-12 ? "" : `${formatNumber(xValue)}x`;
    const constantPart = -constant / yCoefficient;
    let expression = xPart;
    if (Math.abs(constantPart) > 1e-12) expression += `${expression ? (constantPart < 0 ? " − " : " + ") : constantPart < 0 ? "−" : ""}${formatNumber(Math.abs(constantPart))}`;
    if (!expression) expression = "0";
    return { kind: "equation", answer: `y = ${expression || "0"}` };
  }
  const variable = vars.find((name) => degreeFor(difference, name) > 0);
  const degree = degreeFor(difference, variable);
  /* A one-variable equation may still contain cross terms; those are not a
     single-variable polynomial and are intentionally reported as unsupported. */
  if (vars.length > 1 || [...difference.terms.keys()].some((key) => {
    const [x, y] = readKey(key); return variable === "x" ? y > 0 : x > 0;
  })) return null;
  const a = variable === "x" ? difference.terms.get("2,0") || 0 : difference.terms.get("0,2") || 0;
  const b = coefficient(difference, variable);
  const c = constantTerm(difference);
  if (degree === 1 || (degree === 2 && Math.abs(a) < 1e-12)) {
    if (Math.abs(b) < 1e-12) return null;
    return { kind: "equation", answer: `${variable} = ${formatNumber(-c / b)}` };
  }
  if (degree > 2) {
    const coefficients = Array.from({ length: degree + 1 }, (_, index) => {
      const exponent = degree - index;
      const key = variable === "x" ? `${exponent},0` : `0,${exponent}`;
      return difference.terms.get(key) || 0;
    });
    const roots = approximateRealRoots(coefficients);
    return roots.length
      ? { kind: "equation", answer: roots.map((root) => `${variable} = ${formatNumber(root)}`).join(" or ") }
      : { kind: "equation", answer: "No real solution" };
  }
  const discriminant = b * b - 4 * a * c;
  if (discriminant < -1e-12) return { kind: "equation", answer: "No real solution" };
  if (Math.abs(discriminant) < 1e-12) return { kind: "equation", answer: `${variable} = ${formatNumber(-b / (2 * a))}` };
  const root = Math.sqrt(discriminant);
  const roots = [(-b - root) / (2 * a), (-b + root) / (2 * a)].sort((first, second) => first - second);
  return { kind: "equation", answer: `${variable} = ${formatNumber(roots[0])} or ${variable} = ${formatNumber(roots[1])}` };
}

function solveLinearSystem(equations) {
  const rows = equations.map((equation) => {
    const [leftSource, rightSource] = equation.split("=");
    const difference = polyAdd(parsePolynomial(leftSource), parsePolynomial(rightSource), -1);
    return [coefficient(difference, "x"), coefficient(difference, "y"), constantTerm(difference)];
  });
  const [[a, b, c], [d, e, f]] = rows;
  const determinant = a * e - b * d;
  if (Math.abs(determinant) < 1e-12) return { kind: "equation", answer: "No unique solution" };
  const x = (b * f - c * e) / determinant;
  const y = (c * d - a * f) / determinant;
  return { kind: "equation", answer: `x = ${formatNumber(x)}, y = ${formatNumber(y)}` };
}

/* Safe polynomial evaluation for graph functions. This shares the symbolic
   parser, so a plotted `x^2 - 3x + 1` follows the same rules as inline math. */
export function evaluateMathFunction(expression, value) {
  try {
    const parsed = parsePolynomial(String(expression || ""));
    let result = 0;
    for (const [key, coefficientValue] of parsed.terms) {
      const [xExponent, yExponent] = readKey(key);
      if (yExponent) return null;
      result += coefficientValue * value ** xExponent;
    }
    return Number.isFinite(result) ? result : null;
  } catch { return null; }
}

/* A bounded bisection sweep keeps higher-degree roots deterministic and
   dependency-free. The Cauchy bound means the sweep covers every real root;
   complex roots are deliberately not shown in a prose note. */
function approximateRealRoots(coefficients) {
  const leading = coefficients[0];
  if (!leading) return [];
  const bound = Math.max(10, 1 + Math.max(...coefficients.slice(1).map((value) => Math.abs(value / leading))));
  const evaluate = (value) => coefficients.reduce((total, coefficientValue) => total * value + coefficientValue, 0);
  const roots = [];
  const addRoot = (value) => {
    if (Number.isFinite(value) && Math.abs(evaluate(value)) < 1e-6 && !roots.some((root) => Math.abs(root - value) < 1e-5)) roots.push(value);
  };
  let previousX = -bound;
  let previousValue = evaluate(previousX);
  const steps = 2400;
  for (let index = 1; index <= steps; index += 1) {
    const currentX = -bound + (2 * bound * index) / steps;
    const currentValue = evaluate(currentX);
    if (Math.abs(currentValue) < 1e-7) addRoot(currentX);
    if (previousValue * currentValue < 0) {
      let low = previousX, high = currentX;
      for (let iteration = 0; iteration < 60; iteration += 1) {
        const middle = (low + high) / 2;
        if (evaluate(low) * evaluate(middle) <= 0) high = middle;
        else low = middle;
      }
      addRoot((low + high) / 2);
    }
    previousX = currentX;
    previousValue = currentValue;
  }
  return roots.sort((first, second) => first - second);
}

/**
 * Answers arithmetic plus deterministic symbolic algebra inline. Returning
 * null is intentional for prose, incomplete input, and ambiguous questions.
 */
export function solveMath(text) {
  /* Treat a standalone `x`/`×` between two value-like terms as the
     multiplication sign. Keep `x` as a variable everywhere else so
     expressions such as `2x + 1 = 3` still solve symbolically. */
  const source = trimQuestion(text)
    .replace(/(\d|\))\s*[x×]\s*(?=(?:\d|\(|π|pi\b|sqrt\b|abs\b|sin\b|cos\b|tan\b|log\b|ln\b|exp\b))/gi, "$1*")
    .replace(/(\d|\))\s*([xy])\b/gi, "$1*$2");
  if (!source || source.length > 500 || !/[\dπ]|\b[xy]\b/i.test(source)) return null;
  try {
    const equations = source.split(/\s*(?:;|\n)\s*/).filter(Boolean);
    const equationParts = equations.filter((part) => part.includes("="));
    if (equationParts.length === 2 && equationParts.every((part) => /^[^=]+=[^=]+$/.test(part)) && /\bx\b/i.test(source) && /\by\b/i.test(source)) {
      return solveLinearSystem(equationParts);
    }
    if (equationParts.length === 1 && /^[^=]+=[^=]+$/.test(equationParts[0])) {
      return solvePolynomialEquation(...equationParts[0].split("="));
    }
    if (equationParts.length || /\b[xy]\b/i.test(source)) return null;
    const answer = parseExpression(source, false);
    return { kind: "calculation", answer: formatNumber(answer) };
  } catch { return null; }
}

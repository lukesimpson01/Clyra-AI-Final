/** Interprets OSM `opening_hours` strings for "Open now / Closes 9:00 pm" state.
 * Only the common, unambiguous subset is understood (24/7, day ranges and
 * lists, time ranges, "off"). Anything else (sunrise, PH, week ranges,
 * comments) returns `unknown`, and the UI hides the state rather than guess. */

export type HoursState =
  | { state: "open"; closesAt: string }
  | { state: "closed"; opensAt?: string; opensOn?: string }
  | { state: "open24" }
  | { state: "unknown" };

type Span = [number, number]; // minutes from midnight
const DAY_INDEX: Record<string, number> = { Mo: 0, Tu: 1, We: 2, Th: 3, Fr: 4, Sa: 5, Su: 6 };
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function parseDays(spec: string): number[] | null {
  const days = new Set<number>();
  for (const part of spec.split(",")) {
    const m = part.trim().match(/^(Mo|Tu|We|Th|Fr|Sa|Su)(?:-(Mo|Tu|We|Th|Fr|Sa|Su))?$/);
    if (!m) return null;
    const from = DAY_INDEX[m[1]];
    const to = m[2] ? DAY_INDEX[m[2]] : from;
    for (let d = from; ; d = (d + 1) % 7) {
      days.add(d);
      if (d === to) break;
    }
  }
  return [...days];
}

function parseTimes(spec: string): Span[] | "off" | null {
  if (spec.trim() === "off" || spec.trim() === "closed") return "off";
  const spans: Span[] = [];
  for (const part of spec.split(",")) {
    const m = part.trim().match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    spans.push([Number(m[1]) * 60 + Number(m[2]), Number(m[3]) * 60 + Number(m[4])]);
  }
  return spans;
}

interface Rule {
  days: number[];
  spans: Span[] | "off";
}

function parse(raw: string): Rule[] | "24/7" | null {
  const text = raw.trim();
  if (text === "24/7") return "24/7";
  const rules: Rule[] = [];
  for (const segment of text.split(";").map((s) => s.trim()).filter(Boolean)) {
    const space = segment.indexOf(" ");
    if (space < 0) return null;
    const days = parseDays(segment.slice(0, space));
    const spans = parseTimes(segment.slice(space + 1));
    if (!days || !spans) return null;
    rules.push({ days, spans });
  }
  return rules.length ? rules : null;
}

function fmt(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const suffix = h24 < 12 ? "am" : "pm";
  return m ? `${h12}:${String(m).padStart(2, "0")} ${suffix}` : `${h12}:00 ${suffix}`;
}

/** Spans for one weekday. A later rule for the same day overrides earlier ones. */
function spansFor(rules: Rule[], day: number): Span[] | "off" | null {
  let found: Span[] | "off" | null = null;
  for (const r of rules) if (r.days.includes(day)) found = r.spans;
  return found;
}

export function openingState(raw: string | undefined, now: Date = new Date()): HoursState {
  if (!raw) return { state: "unknown" };
  const rules = parse(raw);
  if (!rules) return { state: "unknown" };
  if (rules === "24/7") return { state: "open24" };

  const day = now.getDay() === 0 ? 6 : now.getDay() - 1; // Mon=0
  const minutes = now.getHours() * 60 + now.getMinutes();
  // OSM convention: a weekday that no rule lists is closed, not unknown.
  const todays = spansFor(rules, day) ?? "off";

  if (todays !== "off") {
    for (const [start, end] of todays) {
      if (minutes >= start && minutes < end) return { state: "open", closesAt: fmt(end) };
    }
  }

  // Find the next opening within the coming week.
  for (let offset = 0; offset < 7; offset += 1) {
    const d = (day + offset) % 7;
    const spans = spansFor(rules, d);
    if (!spans || spans === "off") continue;
    for (const [start] of spans) {
      if (offset === 0 && start <= minutes) continue;
      return {
        state: "closed",
        opensAt: fmt(start),
        opensOn: offset === 0 ? undefined : offset === 1 ? "tomorrow" : DAY_NAMES[d],
      };
    }
  }
  return { state: "closed" };
}


/** The whole week as display rows ("Monday", "9:00 am – 5:00 pm"), or null when the string isn't understood. */
export function weeklyHours(raw: string | undefined): Array<{ day: string; text: string }> | null {
  if (!raw) return null;
  const rules = parse(raw);
  if (!rules) return null;
  return DAY_NAMES.map((day, index) => {
    if (rules === "24/7") return { day, text: "Open 24 hours" };
    const spans = spansFor(rules, index);
    if (!spans || spans === "off") return { day, text: "Closed" };
    return { day, text: spans.map(([a, b]) => `${fmt(a)} – ${fmt(b)}`).join(", ") };
  });
}

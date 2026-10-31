/** A line diff (longest common subsequence) between two versions of a file, for the chat's diff view. */
export type DiffLine = { kind: "same" | "add" | "del"; text: string; oldNo?: number; newNo?: number };

const MAX_CELLS = 4_000_000;

export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before ? before.replace(/\n$/, "").split("\n") : [];
  const b = after ? after.replace(/\n$/, "").split("\n") : [];
  if (!a.length) return b.map((text, i) => ({ kind: "add", text, newNo: i + 1 }));
  // trim the common head and tail first: most edits touch a few lines
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const am = a.slice(head, a.length - tail), bm = b.slice(head, b.length - tail);
  const middle: DiffLine[] = [];
  if (am.length * bm.length > MAX_CELLS) {
    am.forEach((text) => middle.push({ kind: "del", text }));
    bm.forEach((text) => middle.push({ kind: "add", text }));
  } else {
    const n = am.length, m = bm.length;
    const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = am[i] === bm[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && am[i] === bm[j]) { middle.push({ kind: "same", text: am[i] }); i++; j++; }
      else if (i < n && (j >= m || lcs[i + 1][j] >= lcs[i][j + 1])) { middle.push({ kind: "del", text: am[i] }); i++; }
      else { middle.push({ kind: "add", text: bm[j] }); j++; }
    }
  }
  const lines: DiffLine[] = [
    ...a.slice(0, head).map((text) => ({ kind: "same" as const, text })),
    ...middle,
    ...a.slice(a.length - tail).map((text) => ({ kind: "same" as const, text })),
  ];
  let o = 0, w = 0;
  for (const line of lines) {
    if (line.kind !== "add") line.oldNo = ++o;
    if (line.kind !== "del") line.newNo = ++w;
  }
  return lines;
}

export const diffCounts = (lines: DiffLine[]) => ({
  added: lines.filter((l) => l.kind === "add").length,
  removed: lines.filter((l) => l.kind === "del").length,
});

/** The lines around each change (and the changes), for a compact view of a long file's edit. */
export function hunks(lines: DiffLine[], context = 3): Array<DiffLine | { kind: "gap"; count: number }> {
  const keep = new Set<number>();
  lines.forEach((line, i) => { if (line.kind !== "same") for (let k = i - context; k <= i + context; k++) keep.add(k); });
  if (!keep.size) return lines.slice(0, context * 2);
  const out: Array<DiffLine | { kind: "gap"; count: number }> = [];
  let gap = 0;
  lines.forEach((line, i) => {
    if (keep.has(i)) { if (gap) out.push({ kind: "gap", count: gap }); gap = 0; out.push(line); }
    else gap++;
  });
  if (gap) out.push({ kind: "gap", count: gap });
  return out;
}

/** A long path kept readable: its last folder and the file's own name, with the extension. */
export function shortPath(path: string, max = 44) {
  if (path.length <= max) return path;
  const parts = path.split("/");
  const file = parts.pop() ?? path;
  const parent = parts.pop();
  const short = parent ? `…/${parent}/${file}` : file;
  return short.length <= max ? short : `…${file.slice(-(max - 1))}`;
}

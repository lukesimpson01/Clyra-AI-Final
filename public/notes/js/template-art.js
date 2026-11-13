/* Cover art for templates. Every template gets its own composition, drawn
   as SVG from a seed, so the library reads as designed work rather than forty
   pages with the same banner. Each category has its own visual language:
   study pages are ruled and geometric, résumés are typographic bars, official
   documents are fine concentric line work, letters are soft paper curves, and
   planning pages are tiled like a calendar. */
const hash = (text) => { let h = 2166136261; for (const ch of String(text)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/* Muted, professional palettes: background, deep ink, two accents. */
const PALETTES = [
  ["#eef2fb", "#1f3a8a", "#6c8ef5", "#c7d4fb"], ["#eef6f1", "#1d5c3f", "#4fae82", "#c4e6d3"], ["#fbf1ea", "#8a3d12", "#e8894a", "#f7d3b8"],
  ["#f4effa", "#4c2a85", "#9b78e0", "#dccdf5"], ["#fcedf1", "#8a1f45", "#e0678f", "#f6c9d8"], ["#eef6f8", "#155e75", "#38a9c4", "#bfe3ec"],
  ["#fbf5e4", "#7a5a00", "#e0b020", "#f4e2a0"], ["#f1f0ee", "#2b2b28", "#8d8a82", "#d9d6cf"], ["#eaf3f0", "#134e4a", "#3aa6a0", "#b7dfda"],
];
const W = 1600; const H = 260;
const svg = (body, bg) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice"><rect width="${W}" height="${H}" fill="${bg}"/>${body}</svg>`;

const STYLES = {
  /* Notebook: ruled lines, quarter circles and a margin rule. */
  "Study & Education": (r, [bg, ink, a, b]) => {
    let out = "";
    for (let y = 40; y < H; y += 34) out += `<line x1="0" x2="${W}" y1="${y}" y2="${y}" stroke="${b}" stroke-width="1.5" opacity=".8"/>`;
    const mx = 120 + Math.floor(r() * 120);
    out += `<line x1="${mx}" x2="${mx}" y1="0" y2="${H}" stroke="${a}" stroke-width="2" opacity=".55"/>`;
    for (let i = 0; i < 4; i += 1) {
      const rad = 50 + r() * 110; const cx = 520 + r() * 1000; const cy = r() > .5 ? 0 : H;
      out += `<circle cx="${cx.toFixed(0)}" cy="${cy}" r="${rad.toFixed(0)}" fill="${[a, b, ink][i % 3]}" opacity="${(.16 + r() * .22).toFixed(2)}"/>`;
    }
    out += `<rect x="${W - 330}" y="52" width="210" height="156" rx="12" fill="none" stroke="${ink}" stroke-width="2.5" opacity=".5"/><line x1="${W - 300}" x2="${W - 150}" y1="96" y2="96" stroke="${ink}" stroke-width="3" opacity=".4"/><line x1="${W - 300}" x2="${W - 190}" y1="126" y2="126" stroke="${a}" stroke-width="3" opacity=".7"/>`;
    return out;
  },
  /* Typographic: confident vertical bars of varied weight, a dot and a rule. */
  "Résumés & Cover Letters": (r, [bg, ink, a, b]) => {
    let out = ""; let x = 90 + r() * 80;
    while (x < W - 60) {
      const w = 8 + Math.floor(r() * 7) * 6; const h = 70 + r() * 150;
      out += `<rect x="${x.toFixed(0)}" y="${(H - h).toFixed(0)}" width="${w}" height="${h.toFixed(0)}" rx="${Math.min(w / 2, 6)}" fill="${[ink, a, b, a][Math.floor(r() * 4)]}" opacity="${(.4 + r() * .55).toFixed(2)}"/>`;
      x += w + 14 + r() * 30;
    }
    out += `<circle cx="${(220 + r() * 300).toFixed(0)}" cy="70" r="26" fill="${a}"/><rect x="60" y="${H - 24}" width="${W - 120}" height="3" fill="${ink}" opacity=".6"/>`;
    return out;
  },
  /* Official: guilloche-like concentric rings and registration corners. */
  "Official Documents": (r, [bg, ink, a, b]) => {
    let out = ""; const cx = 400 + r() * 800; const cy = H / 2;
    for (let i = 0; i < 16; i += 1) out += `<ellipse cx="${cx.toFixed(0)}" cy="${cy}" rx="${60 + i * 46}" ry="${34 + i * 14}" fill="none" stroke="${i % 3 === 0 ? ink : a}" stroke-width="${i % 3 === 0 ? 1.8 : 1}" opacity="${(.5 - i * .02).toFixed(2)}"/>`;
    for (const [px, py, sx, sy] of [[30, 30, 1, 1], [W - 30, 30, -1, 1], [30, H - 30, 1, -1], [W - 30, H - 30, -1, -1]]) out += `<path d="M${px} ${py + sy * 34}V${py}H${px + sx * 34}" fill="none" stroke="${ink}" stroke-width="2.5" opacity=".7"/>`;
    out += `<circle cx="${cx.toFixed(0)}" cy="${cy}" r="30" fill="${b}"/><circle cx="${cx.toFixed(0)}" cy="${cy}" r="30" fill="none" stroke="${ink}" stroke-width="2"/>`;
    return out;
  },
  /* Letters: soft overlapping paper curves and an envelope flap. */
  Letters: (r, [bg, ink, a, b]) => {
    let out = "";
    for (let i = 0; i < 5; i += 1) {
      const y = 60 + i * 38 + r() * 20; const amp = 24 + r() * 50; const ph = r() * 200;
      out += `<path d="M0 ${y.toFixed(0)} C ${400 + ph} ${(y - amp).toFixed(0)}, ${900 - ph} ${(y + amp).toFixed(0)}, ${W} ${y.toFixed(0)} V${H} H0Z" fill="${[a, b, ink, b, a][i]}" opacity="${(.1 + i * .045).toFixed(2)}"/>`;
    }
    const ex = W - 380 + r() * 40;
    out += `<rect x="${ex.toFixed(0)}" y="56" width="250" height="150" rx="10" fill="${bg}" stroke="${ink}" stroke-width="2.5" opacity=".85"/><path d="M${ex.toFixed(0)} 66L${(ex + 125).toFixed(0)} 146 ${(ex + 250).toFixed(0)} 66" fill="none" stroke="${ink}" stroke-width="2.5" opacity=".8"/>`;
    return out;
  },
  /* Planning: calendar tiles and a dot grid. */
  "Planning & Productivity": (r, [bg, ink, a, b]) => {
    let out = "";
    out += `<defs><pattern id="d" width="40" height="40" patternUnits="userSpaceOnUse"><circle cx="20" cy="20" r="2" fill="${ink}" opacity=".16"/></pattern></defs><rect width="${W}" height="${H}" fill="url(#d)"/>`;
    const cols = 12; const size = 56; const gap = 10; const startX = 220 + Math.floor(r() * 300);
    for (let c = 0; c < cols; c += 1) for (let row = 0; row < 3; row += 1) {
      if (r() < .45) continue;
      out += `<rect x="${startX + c * (size + gap)}" y="${40 + row * (size + gap)}" width="${size}" height="${size}" rx="12" fill="${[a, b, ink][Math.floor(r() * 3)]}" opacity="${(.28 + r() * .6).toFixed(2)}"/>`;
    }
    return out;
  },
};

export function artFor(id, category) {
  const seed = hash(id);
  const random = rng(seed);
  const palette = PALETTES[seed % PALETTES.length];
  const draw = STYLES[category] || STYLES["Planning & Productivity"];
  const markup = svg(draw(random, palette), palette[0]);
  /* Compact on purpose: a cover is stored with the page and listed with every page, so it stays a few kilobytes. */
  return `data:image/svg+xml;utf8,${encodeURIComponent(markup.replace(/\s{2,}/g, " "))}`;
}

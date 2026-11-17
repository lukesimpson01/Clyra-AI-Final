/**
 * The workspace arrangement behind Task View: which apps float above it, which are
 * tucked into the side dock, and named saved arrangements. Pure data and pure functions, so the layout is one source of
 * truth that the component only renders. Positions are fractions of the stage, so a layout survives a window resize.
 */

export type FloatBox = { x: number; y: number; w: number; h: number };
export type ArrangementData = { floats: Record<string, FloatBox>; docked: string[] };
export type Layout = ArrangementData & { v: 1; saved: Record<string, ArrangementData> };
export type PxRect = { left: number; top: number; width: number; height: number };

export const LAYOUT_VERSION = 1;
export const LAYOUT_KEY = "clyra.taskview.layout.v1";
/** Smallest a floating window may be, as a fraction of the stage. Below this an app is unusable. */
export const MIN_FLOAT_W = 0.22;
export const MIN_FLOAT_H = 0.24;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const emptyLayout = (): Layout => ({ v: 1, floats: {}, docked: [], saved: {} });

const cloneData = (data: ArrangementData): ArrangementData => ({
  floats: Object.fromEntries(Object.entries(data.floats).map(([id, box]) => [id, { ...box }])),
  docked: [...data.docked],
});

/** Keeps a floating box fully on the stage and above the minimum size. */
export function clampFloat(box: FloatBox): FloatBox {
  const w = clamp(box.w, MIN_FLOAT_W, 0.92);
  const h = clamp(box.h, MIN_FLOAT_H, 0.92);
  return { w, h, x: clamp(box.x, 0, 1 - w), y: clamp(box.y, 0, 1 - h) };
}

/** Drops anything that refers to an app that is no longer open, and anything malformed. Safe on untrusted storage. */
export function validateLayout(input: unknown, openIds: readonly string[]): Layout {
  const open = new Set(openIds);
  const out = emptyLayout();
  if (!input || typeof input !== "object") return out;
  const raw = input as Partial<Layout>;
  if (raw.v !== LAYOUT_VERSION) return out;
  const clean = (data: Partial<ArrangementData> | undefined): ArrangementData => {
    const result: ArrangementData = { floats: {}, docked: [] };
    for (const [id, box] of Object.entries(data?.floats ?? {})) {
      if (!open.has(id) || !box || ![box.x, box.y, box.w, box.h].every(Number.isFinite)) continue;
      result.floats[id] = clampFloat(box);
    }
    for (const id of data?.docked ?? []) {
      if (typeof id === "string" && open.has(id) && !result.docked.includes(id) && !result.floats[id]) result.docked.push(id);
    }
    return result;
  };
  Object.assign(out, clean(raw));
  for (const [name, data] of Object.entries(raw.saved ?? {})) if (typeof name === "string" && name.length <= 40) out.saved[name] = clean(data);
  return out;
}

export function loadLayout(openIds: readonly string[]): Layout {
  try {
    const text = window.localStorage.getItem(LAYOUT_KEY);
    return validateLayout(text ? JSON.parse(text) : null, openIds);
  } catch {
    return emptyLayout();
  }
}

export function saveLayout(layout: Layout) {
  try { window.localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch { /* private window: the layout just isn't remembered */ }
}

/** Removes an app from every arrangement, used before putting it somewhere new and when it closes. */
export function detach(layout: Layout, id: string): Layout {
  const next: Layout = { ...layout, floats: { ...layout.floats }, docked: layout.docked.filter((entry) => entry !== id) };
  delete next.floats[id];
  return next;
}

/** A tidy default spot for a new floating window: staggered so several never sit exactly on top of each other. */
export function defaultFloat(index: number): FloatBox {
  const w = 0.36;
  const h = 0.46;
  return clampFloat({ x: 0.58 - (index % 4) * 0.035, y: 0.1 + (index % 4) * 0.05, w, h });
}

export function floatApp(layout: Layout, id: string, box?: FloatBox): Layout {
  const next = detach(layout, id);
  next.floats[id] = clampFloat(box ?? defaultFloat(Object.keys(layout.floats).length));
  return next;
}

export function dockApp(layout: Layout, id: string): Layout {
  const next = detach(layout, id);
  next.docked = [...next.docked, id];
  return next;
}

export function saveWorkspace(layout: Layout, name: string): Layout {
  const trimmed = name.trim().slice(0, 40);
  if (!trimmed) return layout;
  return { ...layout, saved: { ...layout.saved, [trimmed]: cloneData(layout) } };
}

export function applyWorkspace(layout: Layout, name: string, openIds: readonly string[]): Layout {
  const data = layout.saved[name];
  if (!data) return layout;
  const probe = validateLayout({ v: 1, ...cloneData(data), saved: {} }, openIds);
  return { ...layout, floats: probe.floats, docked: probe.docked };
}

export function deleteWorkspace(layout: Layout, name: string): Layout {
  const saved = { ...layout.saved };
  delete saved[name];
  return { ...layout, saved };
}

export function floatRect(box: FloatBox, stage: { width: number; height: number }): PxRect {
  return { left: Math.round(box.x * stage.width), top: Math.round(box.y * stage.height), width: Math.round(box.w * stage.width), height: Math.round(box.h * stage.height) };
}

export type Role = { kind: "full" } | { kind: "float"; rect: PxRect; order: number } | { kind: "dock"; order: number } | { kind: "hidden" };

/** What every open app is doing right now. `activeId` is the app the user is working in. */
export function resolveRoles(layout: Layout, tabIds: readonly string[], activeId: string, stage: { width: number; height: number }): Map<string, Role> {
  const roles = new Map<string, Role>();
  let order = 0;
  for (const id of tabIds) {
    if (layout.floats[id]) {
      roles.set(id, { kind: "float", rect: floatRect(layout.floats[id], stage), order: order++ });
    } else if (layout.docked.includes(id)) {
      roles.set(id, { kind: "dock", order: layout.docked.indexOf(id) });
    } else {
      roles.set(id, id === activeId ? { kind: "full" } : { kind: "hidden" });
    }
  }
  // An active app that is floating or docked still needs the stage behind it: the first free app takes the full screen.
  const hasBase = [...roles.values()].some((role) => role.kind === "full");
  if (!hasBase) {
    const base = tabIds.find((id) => roles.get(id)?.kind === "hidden");
    if (base) roles.set(base, { kind: "full" });
  }
  return roles;
}

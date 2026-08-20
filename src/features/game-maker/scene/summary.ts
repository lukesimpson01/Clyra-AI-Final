/**
 * Hierarchical scene summaries (spec §61).
 *
 * The model never receives the scene JSON. It receives a tree of counts
 * grouped by region and type, and drills in with scene.query when a detail
 * actually matters. This is what keeps a 40k-entity world inside a small
 * context budget.
 */
import type { SceneIR, SceneSummary, SceneSummaryNode, Vec3 } from "../ir/types";
import { getSpatialIndex } from "./spatial";

function pluralType(type: string, count: number) {
  if (count === 1) return type;
  if (/(s|x|z|ch|sh)$/.test(type)) return `${type}es`;
  return `${type}s`;
}

export function buildSceneSummary(scene: SceneIR): SceneSummary {
  const index = getSpatialIndex(scene);
  const byRegion = new Map<string, Map<string, number>>();
  const unassigned = new Map<string, number>();

  for (const entry of index.all()) {
    const bucket = entry.regionId
      ? (byRegion.get(entry.regionId) ?? byRegion.set(entry.regionId, new Map()).get(entry.regionId)!)
      : unassigned;
    bucket.set(entry.type, (bucket.get(entry.type) ?? 0) + 1);
  }

  const regionNodes: SceneSummaryNode[] = [];
  for (const [regionId, counts] of byRegion) {
    const region = scene.regions[regionId];
    const children = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({ label: `${count} ${pluralType(type, count)}`, count }));
    regionNodes.push({
      label: region ? `${region.name} (${region.kind})` : regionId,
      count: children.reduce((total, child) => total + child.count, 0),
      children,
    });
  }
  regionNodes.sort((a, b) => b.count - a.count);

  if (unassigned.size) {
    regionNodes.push({
      label: "Unassigned",
      count: [...unassigned.values()].reduce((total, value) => total + value, 0),
      children: [...unassigned.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => ({ label: `${count} ${pluralType(type, count)}`, count })),
    });
  }

  const systems: string[] = [];
  if (scene.terrain) systems.push("terrain");
  if (scene.navigation?.builtAt) systems.push("navigation");
  else if (scene.navigation) systems.push("navigation (not built)");
  if (scene.voxel) systems.push(`voxel (${Object.keys(scene.voxel.chunks).length} chunks)`);
  if (scene.environment.dayNightCycle?.enabled) systems.push("day/night cycle");

  return {
    sceneId: scene.id,
    name: scene.name,
    entityCount: index.size,
    regionCount: Object.keys(scene.regions).length,
    tree: { label: scene.name, count: index.size, children: regionNodes },
    systems,
    bounds: { min: index.bounds.min as Vec3, max: index.bounds.max as Vec3 },
  };
}

/** Render a summary as the indented text actually sent to the model. */
export function formatSceneSummary(summary: SceneSummary): string {
  const lines: string[] = [`${summary.name} — ${summary.entityCount} entities, ${summary.regionCount} regions`];
  const walk = (node: SceneSummaryNode, depth: number) => {
    lines.push(`${"  ".repeat(depth)}${depth ? "- " : ""}${node.label}`);
    for (const child of node.children ?? []) walk(child, depth + 1);
  };
  for (const child of summary.tree.children ?? []) walk(child, 1);
  if (summary.systems.length) lines.push(`Systems: ${summary.systems.join(", ")}`);
  const [min, max] = [summary.bounds.min, summary.bounds.max];
  lines.push(`World bounds: [${min.map((v) => v.toFixed(0)).join(", ")}] to [${max.map((v) => v.toFixed(0)).join(", ")}]`);
  return lines.join("\n");
}

/**
 * The asset browser. Every asset carries provenance — where it came from,
 * under what licence — because that is what makes a generative product
 * publishable (spec §98, §254).
 */
import { useMemo, useState } from "react";
import { Boxes, Image, Music, Package, Palette, Search, Shapes } from "lucide-react";
import { cn } from "../../../lib/utils";
import { editorStore, useEditorState } from "../store/editorStore";
import type { AssetRecord } from "../ir/types";
import type { MaterialDefinition } from "../procedural/materials";

const TYPE_ICON: Record<string, typeof Boxes> = {
  material: Palette,
  mesh: Boxes,
  texture: Image,
  audio: Music,
  prefab: Package,
  sprite: Shapes,
};

const FILTERS = ["all", "material", "mesh", "prefab", "audio", "sprite"] as const;

function swatch(asset: AssetRecord) {
  if (asset.type !== "material" || !asset.definition) return undefined;
  const definition = asset.definition as unknown as MaterialDefinition;
  return `linear-gradient(135deg, ${definition.baseColor}, ${definition.detailColor})`;
}

export function AssetBrowser() {
  const project = useEditorState((state) => state.project);
  const assetTab = useEditorState((state) => state.assetTab);
  const [search, setSearch] = useState("");

  const assets = useMemo(() => {
    if (!project) return [];
    const needle = search.trim().toLowerCase();
    return project.assets.filter((asset) => {
      if (assetTab !== "all" && asset.type !== assetTab) return false;
      if (!needle) return true;
      return asset.name.toLowerCase().includes(needle) || asset.type.includes(needle);
    });
  }, [project, assetTab, search]);

  if (!project) return null;

  return (
    <section className="gm-assets">
      <header>
        {FILTERS.map((filter) => (
          <button key={filter} type="button" className={cn(assetTab === filter && "is-active")} onClick={() => editorStore.setUi({ assetTab: filter })}>
            {filter === "all" ? "All" : `${filter[0]!.toUpperCase()}${filter.slice(1)}s`}
          </button>
        ))}
        <div className="gm-search">
          <Search size={11} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search assets" aria-label="Search assets" />
        </div>
        <span className="gm-assets__count">{project.assets.length} total</span>
      </header>
      <div className="gm-assets__grid">
        {assets.length ? (
          assets.slice(0, 200).map((asset) => {
            const Icon = TYPE_ICON[asset.type] ?? Package;
            return (
              <article key={asset.id} className="gm-asset" title={`${asset.name}\n${asset.type} · ${asset.source}\n${asset.provenance.license}`}>
                <span className="gm-asset__preview" style={{ background: swatch(asset) }}>
                  {swatch(asset) ? null : <Icon size={14} />}
                </span>
                <strong>{asset.name}</strong>
                <small>{asset.source}</small>
              </article>
            );
          })
        ) : (
          <p className="gm-empty">
            {project.assets.length ? "No assets match that filter." : "Assets appear here as Clyra generates materials, meshes and prefabs."}
          </p>
        )}
      </div>
    </section>
  );
}

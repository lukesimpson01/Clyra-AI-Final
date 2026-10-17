import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, File, Folder, Loader2 } from "lucide-react";
import { runToolStep } from "../../lib/coworkMissions";
import "./cowork.css";

type FileEntry = { name: string; type: "dir" | "file" | "unknown"; size: number; modifiedAt: number };

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * A real, read-only live view of what Clyra is looking at in the user's
 * files — backed by the actual `files.list`/`files.read` tools
 * (`lib/clyra-agent/fs-tools.ts`) through the same Mission Runtime every
 * other tool call goes through. Mutating file operations stay behind the
 * runtime's exact-action approval flow rather than a bypass button here.
 */
export function ClyraFilesPanel({ initialPath = "~" }: { initialPath?: string }) {
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [entries, setEntries] = useState<FileEntry[] | null>(null);
  const [resolvedPath, setResolvedPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ name: string; content: string; truncated: boolean } | null>(null);

  const load = useCallback(async (targetPath: string) => {
    setLoading(true);
    setError(null);
    setPreview(null);
    try {
      const result = await runToolStep("files.list", { path: targetPath }, "list");
      const output = result.mission.outputs.list;
      if (!output?.ok) throw new Error(output?.error?.message || result.mission.error?.message || "That folder could not be listed.");
      const data = output.data as { path: string; entries: FileEntry[] };
      setEntries([...data.entries].sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1)));
      setResolvedPath(data.path);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That folder could not be listed.");
      setEntries(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(currentPath); }, [currentPath, load]);

  const openEntry = useCallback(async (entry: FileEntry) => {
    if (entry.type === "dir") {
      setCurrentPath(`${resolvedPath}/${entry.name}`);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await runToolStep("files.read", { path: `${resolvedPath}/${entry.name}` }, "read");
      const output = result.mission.outputs.read;
      if (!output?.ok) throw new Error(output?.error?.message || "That file could not be opened.");
      const data = output.data as { content: string; truncated: boolean };
      setPreview({ name: entry.name, content: data.content, truncated: data.truncated });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That file could not be opened.");
    } finally {
      setLoading(false);
    }
  }, [resolvedPath]);

  const goUp = useCallback(() => {
    if (preview) { setPreview(null); return; }
    const parent = resolvedPath.split("/").slice(0, -1).join("/") || "/";
    setCurrentPath(parent);
  }, [preview, resolvedPath]);

  return (
    <div className="cowork-shell cowork" style={{ height: "100%" }}>
      <div className="cowork-panel-header">
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button type="button" className="clyra-icon-button" onClick={goUp} aria-label="Back" style={{ padding: 2 }}>
            <ChevronLeft size={14} />
          </button>
          Files
        </span>
        {loading ? <Loader2 size={13} className="animate-spin" /> : null}
      </div>
      <div className="cowork-files-path">{preview ? `${resolvedPath}/${preview.name}` : resolvedPath || currentPath}</div>
      <div className="cowork-panel-body clyra-scroll">
        {error ? <p style={{ padding: "12px 14px", fontSize: 12.5, color: "var(--agents-danger)" }}>{error}</p> : null}
        {preview ? (
          <pre className="cowork-files-preview">{preview.content}{preview.truncated ? "\n…(truncated)" : ""}</pre>
        ) : (
          entries?.map((entry) => (
            <div key={entry.name} className="cowork-files-row" onClick={() => void openEntry(entry)}>
              {entry.type === "dir" ? <Folder size={14} color="var(--agents-blue)" /> : <File size={14} color="var(--agents-tertiary)" />}
              <span>{entry.name}</span>
              <span className="cowork-files-row__meta">{entry.type === "file" ? formatSize(entry.size) : ""}</span>
            </div>
          ))
        )}
        {!loading && !error && entries?.length === 0 ? <p style={{ padding: "12px 14px", fontSize: 12.5, color: "var(--agents-tertiary)" }}>Empty folder.</p> : null}
      </div>
    </div>
  );
}

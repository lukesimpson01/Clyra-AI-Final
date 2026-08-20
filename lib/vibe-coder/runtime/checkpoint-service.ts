import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type CheckpointManifest = {
  id: string;
  runId: string;
  timestamp: number;
  gitState: string;
  files: Array<{ path: string; hash: string; size: number; linkTarget?: string }>;
};

async function workspaceFiles(root: string) {
  const { stdout } = await execFileAsync("git", ["-C", root, "ls-files", "-co", "--exclude-standard", "-z"], { maxBuffer: 8 * 1024 * 1024 });
  return stdout.split("\0").filter(Boolean).filter((entry) => !entry.startsWith(".clyra/")).sort();
}

export class CheckpointService {
  constructor(private readonly workspace: string) {}

  private root() { return path.join(this.workspace, ".clyra", "checkpoints"); }

  async create(runId: string): Promise<CheckpointManifest> {
    const id = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const checkpointRoot = path.join(this.root(), id);
    const originals = path.join(checkpointRoot, "originals");
    await fs.mkdir(originals, { recursive: true });
    const files = await workspaceFiles(this.workspace);
    const records: CheckpointManifest["files"] = [];
    for (const relative of files) {
      const absolute = path.join(this.workspace, relative);
      const info = await fs.lstat(absolute);
      if (info.isSymbolicLink()) {
        const linkTarget = await fs.readlink(absolute);
        const encoded = Buffer.from(linkTarget, "utf8");
        records.push({ path: relative, hash: createHash("sha256").update(encoded).digest("hex"), size: encoded.byteLength, linkTarget });
        continue;
      }
      if (!info.isFile()) continue;
      const content = await fs.readFile(absolute);
      const target = path.join(originals, relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(absolute, target);
      records.push({ path: relative, hash: createHash("sha256").update(content).digest("hex"), size: content.byteLength });
    }
    const gitState = await execFileAsync("git", ["-C", this.workspace, "status", "--porcelain=v1"], { maxBuffer: 2 * 1024 * 1024 }).then((result) => result.stdout).catch(() => "");
    const manifest: CheckpointManifest = { id, runId, timestamp: Date.now(), gitState, files: records };
    await fs.writeFile(path.join(checkpointRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    return manifest;
  }

  async list(): Promise<CheckpointManifest[]> {
    const entries = await fs.readdir(this.root(), { withFileTypes: true }).catch(() => []);
    const values = await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) =>
      fs.readFile(path.join(this.root(), entry.name, "manifest.json"), "utf8").then((value) => JSON.parse(value) as CheckpointManifest).catch(() => undefined),
    ));
    return values.filter((value): value is CheckpointManifest => Boolean(value)).sort((a, b) => b.timestamp - a.timestamp);
  }

  async revert(id: string) {
    if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error("Invalid checkpoint ID.");
    const checkpointRoot = path.join(this.root(), id);
    const manifest = JSON.parse(await fs.readFile(path.join(checkpointRoot, "manifest.json"), "utf8")) as CheckpointManifest;
    const original = new Set(manifest.files.map((file) => file.path));
    const current = await workspaceFiles(this.workspace);
    for (const relative of current) {
      if (!original.has(relative)) await fs.rm(path.join(this.workspace, relative), { force: true });
    }
    for (const file of manifest.files) {
      const target = path.join(this.workspace, file.path);
      await fs.mkdir(path.dirname(target), { recursive: true });
      if (file.linkTarget !== undefined) {
        await fs.rm(target, { force: true, recursive: true });
        await fs.symlink(file.linkTarget, target);
      } else {
        const source = path.join(checkpointRoot, "originals", file.path);
        await fs.copyFile(source, target);
      }
    }
    return { restoredFiles: manifest.files.length, removedNewFiles: current.filter((file) => !original.has(file)).length };
  }
}

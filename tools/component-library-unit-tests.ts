import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

const original = process.cwd();
const root = await mkdtemp(path.join(tmpdir(), "clyra-offline-components-"));
const ui = path.join(root, "external", "shadcn-ui", "apps", "v4", "registry", "new-york-v4", "ui");
const agent = path.join(root, "external", "21st-agent-elements", "public", "r");
try {
  await mkdir(ui, { recursive: true });
  await mkdir(agent, { recursive: true });
  await writeFile(path.join(ui, "button.tsx"),
    'import { cn } from "cn";\nexport function Button() { return <button className={cn("px-2")}>Go</button>; }\n');
  await writeFile(path.join(ui, "_registry.ts"), "export const ui = [];");
  await writeFile(path.join(agent, "index.json"), JSON.stringify({
    items: [{ name: "message-list" }],
  }));
  await writeFile(path.join(agent, "message-list.json"), JSON.stringify({
    name: "message-list", dependencies: ["clsx"],
    files: [{ path: "registry/agent-elements/components/message-list.tsx",
      content: "export function MessageList() { return <div>Messages</div> }" }],
  }));
  process.chdir(root);
  const { listLocalComponents, localSourceStatus, readLocalComponent } = await import("../lib/clyra-code/offline-component-library");
  const status = await localSourceStatus();
  assert.equal(status.length, 2);
  assert.ok(status.every(s => s.available));
  const all = await listLocalComponents();
  assert.deepEqual(all.map(item => item.id).sort(), ["21st:message-list", "shadcn:button"]);
  const button = await readLocalComponent("shadcn", "button");
  assert.equal(button.files[0].path, "components/ui/button.tsx");
  assert.ok(button.files[0].content.includes('from "cn"'));
  const messages = await readLocalComponent("21st", "message-list");
  assert.equal(messages.files[0].path, "components/agent-elements/message-list.tsx");
  assert.deepEqual(messages.dependencies, ["clsx"]);

  // Real project-local source installation: no HTTP requests, MCP or API keys.
  const project = path.join(root, "projects", "sample", "files");
  await mkdir(path.join(project, "src"), { recursive: true });
  await writeFile(path.join(project, "package.json"), JSON.stringify({
    name: "sample", dependencies: { react: "^19.0.0" },
  }));
  await writeFile(path.join(project, "src", "index.css"), '@import "tailwindcss";\n');
  const agentCss = path.join(root, "external", "21st-agent-elements", "lib", "agent-ui", "agent-ui.css");
  await mkdir(path.dirname(agentCss), { recursive: true });
  await writeFile(agentCss, ':root { --an-primary-color: #3977F6; }\n');
  const { installLocalComponent } = await import("../lib/clyra-code/offline-component-library");
  const installedButton = await installLocalComponent("sample", "shadcn", "button");
  assert.equal(installedButton.ok, true);
  assert.ok(installedButton.dependenciesToInstall.includes("clsx"));
  const buttonCode = await readFile(path.join(project, "src", "components", "ui", "button.tsx"), "utf8");
  assert.ok(buttonCode.includes('from "../../lib/utils"'), "imports must be portable without @ aliases");
  assert.ok((await readFile(path.join(project, "src", "lib", "utils.ts"), "utf8")).includes("twMerge"));
  const installed21st = await installLocalComponent("sample", "21st", "message-list");
  assert.equal(installed21st.ok, true);
  assert.ok(await readFile(path.join(project, "src", "components", "agent-elements", "message-list.tsx"), "utf8"));
  assert.ok((await readFile(path.join(project, "src", "index.css"), "utf8"))
    .includes('@import "./components/agent-elements/agent-ui.css";'));
  const repeat = await installLocalComponent("sample", "21st", "message-list");
  assert.equal(repeat.ok, true, "reinstalling identical shared source should be idempotent");
  await assert.rejects(installLocalComponent("../invalid", "shadcn", "button"), /Invalid project ID/);
  await assert.rejects(readLocalComponent("shadcn", "../private"), /Unknown component/);
  console.log("Local shadcn and official 21st Agent Elements catalogues: PASS");
} finally {
  process.chdir(original);
  await rm(root, { recursive: true, force: true });
}

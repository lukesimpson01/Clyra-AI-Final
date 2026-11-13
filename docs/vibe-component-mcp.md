# Vibe Coder — component MCP sources

Clyra Code uses the existing OpenCode harness; it does not replace the agent. Every Code project automatically receives OpenCode V2 `opencode.json` MCP entries on runtime startup:

- `shadcn`: official local `npx -y shadcn@latest mcp` server for registry discovery, component inspection and installation.
- `21st`: official remote Streamable HTTP MCP at `https://21st.dev/api/mcp`, authenticated through `API_KEY_21ST` in the **backend** environment. No key is checked into git or passed to the renderer.

The component drawer queries the official shadcn registry's live `/r/index.json` catalog and the official 21st MCP search tool. Its thumbnails are real upstream previews where provided; shadcn components without screenshots have **illustrative miniatures** and a direct official documentation link, not fabricated screenshots. Add an item with one click; the selected item becomes a composer context passed into the agent prompt. OpenCode runs real MCP calls and its existing event stream displays them as “Scanning MCP” or “Resolving component”.

## Setup

1. `git pull` updates Clyra's code and MCP adapter. Existing projects gain MCP config on their next Vibe Coder runtime start.
2. Node.js 20+ and `npx` must be available so the shadcn server can start. The first use may download the CLI. If the project has no `components.json`, ask the agent to initialise a compatible React/Tailwind project before installing components.
3. To enable 21st.dev, create a key at https://21st.dev/mcp and put `API_KEY_21ST=...` in the local backend's private `.env.local`, then restart Clyra. The UI honestly shows unavailable/failed status without an account. Some source-code retrievals or AI generation require a paid account.
4. To fetch **upstream source repositories** into the local checkout as requested, run:
   ```sh
   git submodule update --init --depth 1 external/shadcn-ui external/21st-mcp
   ```
   Normal `git pull` does not automatically materialise new submodule contents. These source checkouts are for inspection and tracking; the live MCP runs via the official CLI/remote service and does not require them.

## Usage

Open **Vibe Coder → Components**, filter by provider or search a term, then click a component to attach it to the coding composer. Ask for a UI or build one normally: the agent is instructed to discover relevant components proactively, verify suitability, use the official MCP, and expose actual scan/install calls. For native Swift and other incompatible frameworks the agent must not force React dependencies.

## Source and license notes

- [shadcn/ui](https://github.com/shadcn-ui/ui): MIT licensed upstream source, pinned as a Git submodule.
- [21st MCP compatibility proxy](https://github.com/21st-dev/magic-mcp): ISC licensed client proxy, pinned as a Git submodule. This is **not** a clone of 21st.dev's private hosted catalog, and its existence does not grant access to the cloud component source or any premium API entitlement.
- Component authorship, dependencies and licenses for individual 21st components must be checked per item before resale/redistribution.

The backend never executes third-party code as part of **browsing**; installation happens only when an agent takes the actual install action inside the project and follows its file/permission workflow.

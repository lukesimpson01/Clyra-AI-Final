# DeepSeek Harness integration record

## Pin and upstream status

- Repository: `https://github.com/deepseek-ai/deepseek-harness.git`
- Pinned commit: `99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`
- Version at the pin: `0.1.0-rc.7`
- License: MIT
- Local reference: `references/deepseek-harness` (ignored; the durable pin lives in `DEPENDENCY_COMMITS.lock`)

The upstream version is newer than the `0.1.0-rc.5` named in the original
directive. It remains a developer preview and declares Node `^22.19 || >=24`.
Clyra's server bundle still targets Node 18 for desktop compatibility, so the
entire dsh process is not embedded into the production server.

## Contract reviewed

The integration was based on the upstream plugin documentation and source,
not a guessed adapter shape:

- `docs/architecture.md`
- `docs/cordis-tutorial/07-into-the-harness.md`
- `docs/cookbook/adding-an-llm-adapter.md`
- `packages/llm/llm-deepseek/src/adapter.ts`

dsh separates the model adapter, tool registry, session log, sandbox,
scheduler/jobs, and agent loop through Cordis plugins. The official DeepSeek
adapter currently exposes `off`, `low`, `high`, and `max`; its default is
`high`. Clyra uses that exact vocabulary in the existing composer selector and
passes the selected model variant through the existing OpenCode prompt call.

## Case-by-case plugin decision

| dsh seam | Clyra decision | Reason |
| --- | --- | --- |
| DeepSeek model contract | Adopted | Exact effort levels and default are useful and map to the live DeepSeek model variants. |
| Tool registry | Retained | Clyra already has working filesystem, terminal, Git, preview, Forge-inspector, browser, and approval tools reflected in its transcript. Replacing them would regress product-specific behavior. |
| Session/log storage | Retained | Existing projects and task history already persist through OpenCode and Clyra's project store. |
| Sandbox | Retained and hardened | The current Seatbelt wrapper scopes the live OpenCode process to Clyra project and cache roots without introducing a second execution service. |
| Scheduler | Retained | Clyra's background-task lifecycle is already connected to its desktop state and UI. |
| Agent loop | Retained | OpenCode remains the stable active backend; its real events already drive Clyra's Codex-style action rows, diffs, terminal, and validation state. |
| Bundled dsh web UI | Rejected | Clyra's chat/workspace remains the only frontend, as required. |

This is deliberately a pluggable-contract integration rather than a cosmetic
claim that dsh replaced systems it did not replace. `/api/opencode/status`
exposes the pin, adopted contract pieces, retained layers, effort readiness,
and sandbox status so the runtime decision is inspectable.

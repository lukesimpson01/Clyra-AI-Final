# Vibe Coder Harness Audit

This audit covers the active `deepseek-harness` backend, its shared Clyra Code
HTTP/SSE contract, and the renderer. The older OpenCode backend remains an
optional compatibility backend.

| Feature | Current implementation | Working | Reliability / missing piece | Required fix |
|---|---|---:|---|---|
| Model provider | DeepSeek Harness SDK, server-side DeepSeek config | Yes | Backend abstraction exists but task lifecycle was provider-led | Clyra-owned task controller added; stable provider contract added |
| Agent loop | Harness turns and normalized tool notifications | Partial | No canonical phase/attempt ledger in active backend | Persisted controller now records phases, attempts, recovery and evidence |
| Planning / todos | Prompt guidance and provider todos | Partial | Could vanish with model context | Durable task plan is stored outside the conversation |
| Context / instructions | Harness cwd; seeded `AGENTS.md`; targeted model guidance | Yes | Nested `CLYRA.md` discovery is not yet wired into the Harness SDK | Keep as follow-up: expose instruction loader to tool context |
| Tool parsing | DSH `tool/call` and `tool/result` normalized to renderer parts | Yes | Tool error loop was not classified | Failures now feed repeat/stuck detection and a debugging phase |
| Terminal / file / search | Provided by DSH sandbox in workspace | Yes | Depends on Harness tool policy | Keep provider sandbox policy authoritative |
| Git / diff / checkpoints | Per-project git repo, baseline diff, checkpoint commits and safe revert | Yes | Worktree isolation is not yet exposed to DSH workers | Follow-up for parallel implementation agents |
| Sessions / restart | Serialized DSH transcript and project sessions | Yes | Execution intent was not separately durable | Controller ledger persists independently |
| Browser / preview | Managed Playwright browser and Clyra preview manager | Yes | Browser evidence is not yet a mandatory DSH completion input | Follow-up: route browser diagnostics into controller validation |
| Validation | Existing workspace validator | Partial | Agent could settle without enforced evidence | Active DeepSeek turns now run validation, retry bounded repairs, and report a real blocker |
| Permissions / secrets | Existing capability approvals, workspace boundaries, redacted provider errors | Partial | DSH SDK lacks permission reply protocol | Keep destructive controls outside provider; add adapter when SDK supports it |
| Pause / resume / cancellation | Cancel closes DSH client and preserves transcript | Partial | Pause/resume is not yet a distinct DSH wire action | Follow-up: add resumable controller endpoints when DSH exposes cancellation tokens |
| MCP / skills | OpenCode-compatible tools and project rules; external MCP assets exist | Partial | No unified per-project MCP registry in active DSH | Follow-up: register MCP tools through the same controller/permission pipeline |
| Observability | SSE tool events, usage analytics, runtime snapshot/event store | Yes | Controller state was absent from activity | Controller now supplies durable phase/recovery facts |

The implementation deliberately does not replace the existing DeepSeek Harness,
renderer, diff UI, preview system, or project/session model. It strengthens the
active runtime at the point where lifecycle, validation and recovery had been
missing.

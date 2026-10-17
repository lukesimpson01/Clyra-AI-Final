# Clyra feature matrix

Status vocabulary: **Verified working**, **Partial**, **Requires setup**, **Blocked**, **Unavailable**, **Planned**. A visual surface is not evidence that its engine works.

| Capability | Status at baseline | Evidence / exact boundary |
| --- | --- | --- |
| Shared Chat composer and persisted conversations | Partial | Implemented in React; live model use requires configured provider and must be tested separately. |
| DeepSeek streaming | Requires setup | Same-origin API exists; no user credential was supplied for this run. |
| Hermes runtime | Requires setup | Runtime status endpoint reports configured/connected/reason; readiness is never assumed. |
| Durable missions, pause/stop/approval | Partial | Mission service and UI controls exist; a full golden run still requires configured Hermes/tools. |
| Spatial Command Centre | Not mounted | A standalone visual source is available for a future migration; no Command Centre is currently mounted in the production application. |
| Quick Overlay / global hotkey | Partial | Electron integration exists; OS collision and permission behavior require native QA. |
| Vibe Coder / OpenCode | Partial | Real project and runtime routes exist; full failing-to-passing worktree golden run is not yet recorded here. |
| Atlas browser | Partial | Managed Playwright/browser surfaces exist; authenticated and CAPTCHA flows remain human handoff. |
| Computer use | Partial | Native bridges exist; macOS permissions and Stop/Take Control require Electron QA. |
| Clyra Maps | Partial | Real provider adapters and MapLibre workspace exist; provider coverage/routing varies. |
| God's Eye live layers | Requires setup | Public/live providers depend on region, terms, credentials and freshness. No synthetic aircraft/vehicles may be used. |
| Voice dictation/call | Partial | Local voice worker and UI exist; microphone, local model and device support are required. |
| Notes / Study | Partial | Local notes routes/workspaces exist; complete import/export and memory acceptance are not established here. |
| Shorts / media | Partial | FFmpeg and media pipelines exist; each advertised generator requires separate output verification. |
| Forge / Game Builder | Partial | Reference and product implementations exist; production save/reopen/export gate remains to be recorded. |
| Cowork / workflow agents | Partial | Durable task endpoints exist; one shared Hermes ownership model remains the product contract. |
| Connected apps / MCP | Requires setup | OAuth/server availability is provider-specific. Denial must not block unrelated tools. |
| macOS development build | Partial | Current host is macOS; signed/notarised consumer artifact was not supplied or claimed. |
| Windows development build | Planned | No Windows hardware result can be inferred from this macOS run. |
| Signed macOS/Windows installers | Blocked | Requires owner signing identities and real platform packaging tests. |

## Command Centre data policy

Home panels may display only:

- persisted chats passed by the existing session store;
- persisted Vibe projects returned by `/api/vibe/projects`;
- task state returned by `/api/cowork/tasks` or the mission store;
- runtime health returned by real health endpoints;
- locally metered usage returned by `/api/usage`.

Empty, offline, denied, missing-provider and error responses are first-class UI states. Test-only fixtures must never be substituted in production.

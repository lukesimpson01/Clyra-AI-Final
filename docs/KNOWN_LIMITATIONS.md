# Known limitations

## Verification limits for this pass

- No DeepSeek key was supplied, so authenticated model streaming and token billing are not marked verified.
- No Apple or Windows signing identities were supplied. No notarised DMG, signed MSI/EXE or warning-free consumer install is claimed.
- This host cannot prove Windows, Intel macOS and Apple Silicon behavior simultaneously.
- Browser visual QA can validate the webview surface; it cannot prove global shortcuts, Keychain/Credential Manager, macOS TCC, Windows UAC, native screen input, microphone hardware, notarisation or installer reputation.
- TfNSW, commercial weather, aviation, OAuth and other optional provider capabilities require their own approved terms/configuration. An unavailable state is the correct behavior without them.
- The current checkout is already extensively modified and contains active local data. No clean-history or release-ready claim is made.

## Product/runtime limitations

- Electron remains the active shell. A Tauri migration would be a separate, high-risk architecture project and is not justified by the current native manager investment without a measured feasibility spike.
- The renderer and backend contain several large legacy modules; build and initial-load budgets must be measured on real 4 GB hardware before making low-memory claims.
- Some workspaces are lazy and independently configured. A ready core shell does not make every provider-backed tool ready.
- The spatial home uses a lightweight SVG/CSS orb rather than an always-running Three.js scene. This is intentional for startup, accessibility and idle power; deeper 3D remains appropriate only in a focused workspace.
- The supplied HTML's browser-local chat/voice/Forge state is not imported automatically. Any future migration must validate schemas, create a backup, avoid blob URL persistence, and offer rollback.
- Exact Hermes memory file support and limits must follow the installed Hermes version, not assumptions in the master prompt.

## Security and release blockers

- Browser profiles, token files and local database state are present in the repository history/working tree. They must be removed from distributable tracking and credentials rotated where appropriate.
- Dependency licences, the SBOM, native binary checksums and production provider terms require a release audit.
- No feature may be labelled live merely because its reference prototype animates.
- No scheduler may claim to run while the machine is off without an explicitly deployed authenticated worker.
- No navigation preview may be labelled live turn-by-turn guidance unless real location, maneuvers and rerouting were verified.

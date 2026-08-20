# Third-party inventory

System Care Phase 1 adds no runtime third-party dependency. It uses Node/Electron APIs, Clyra's existing React, Zod, Lucide and Motion dependencies, and fixed read-only operating-system tools already present on the device.

Potential future dependencies must be pinned and approved here before import or packaging:

| Dependency | License | Allowed role | Status |
|---|---|---|---|
| systeminformation | MIT | Wrapped observation fallback | researched, not installed |
| Czkawka permissive core components | MIT per component | Algorithm/reference or reviewed core integration | researched, not installed |
| dust | Apache-2.0 | Accounting reference | researched, not installed |
| diskonaut | MIT | Storage-map traversal reference | researched, not installed |
| bottom | MIT | Monitor architecture reference | researched, not installed |
| osquery | Apache-2.0 OR GPL-2.0-only | Optional on-demand provider under Apache option | researched, not installed |
| WinGet | MIT | Use OS-installed binary | detected only |
| Homebrew | BSD-2-Clause | Use user-installed binary | detected only |
| Bulk Crap Uninstaller | Apache-2.0 | Windows uninstall architecture reference | researched, not installed |
| fclones | MIT | Duplicate pipeline reference | researched, not installed |
| napi-rs | MIT | Future native bridge | researched, not installed |
| OSV-Scanner | Apache-2.0 | Opt-in developer dependency health | researched, not installed |

GPL Slint application binaries from the Czkawka repository are explicitly excluded. Web search never supplies executable download locations.

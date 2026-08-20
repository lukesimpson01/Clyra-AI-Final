# Windows provider

Phase 1 obtains normalized OS/manufacturer/model facts through one fixed non-interactive CIM query, with Node fallbacks for CPU, memory and system-volume capacity. The query is registered in Electron main and cannot be altered by renderer or model input.

Planned providers: device, applications, startup, security, updates, cleanup, processes and battery. Prefer CIM/WinRT/documented Windows APIs and typed registry wrappers. Use installed WinGet where available. Elevation must be per approved action through a minimal helper, never permanent administrator mode.

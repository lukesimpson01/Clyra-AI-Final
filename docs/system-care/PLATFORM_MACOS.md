# macOS provider

Phase 1 uses fixed `sysctl`, `sw_vers` and `pmset -g batt` observations plus Node CPU/memory/filesystem APIs. Expensive `system_profiler` is intentionally not used during the fast opening path.

Planned providers: applications/bundle identity, Login Items/background items, security posture, updates/Homebrew, process groups and battery health. Full Disk Access is requested only when a scan reaches protected areas and incomplete results must remain visibly partial.

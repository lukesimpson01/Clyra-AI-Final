# Testing

Foundation unit coverage targets health scoring, AI redaction and tool-registry rejection. Desktop smoke coverage verifies profile collection, memory pressure, live process grouping, network counters, IPC authorization, and the opt-in speed-test contract.

Verified on the local macOS development machine: real profile collection, process/activity collection, memory-pressure parsing, network counters, Cloudflare latency/download/upload measurement, TypeScript compilation, production renderer/server build, Electron sidecar preparation, and launched-app visual inspection.

Phase 2 fixtures must be virtual roots under `tests/system-care/fixtures/`: basic macOS/Windows, duplicates, dangerous symlinks, leftovers, protected files, cloud folders and permission denied. Destructive tests must never target the developer home folder.

Before shipping native scanning: run Rust tests, Clippy with warnings denied, format checks, TypeScript typecheck, macOS arm64/x64 packaging, Windows x64/arm64 packaging where feasible, cancellation under load, 8 GB memory profiling, reduced-motion UI, keyboard navigation and visual QA at desktop and narrow widths.

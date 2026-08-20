# Security boundary

- Renderer is untrusted. Context isolation remains enabled and Node integration remains disabled.
- Main process exposes `profile`, `smartScan`, `cancel`, and scan events only.
- OS commands are fixed constants with a binary allowlist, fixed arguments, timeouts and output caps.
- No deletion, app quit, startup change, update, elevation, registry mutation or maintenance command exists in Phase 1.
- The AI registry contains no shell/PowerShell/CMD/Bash/Zsh/Registry/raw-path tool.
- Future file actions must canonicalize and re-stat targets, compare identity/size/mtime, reject traversal/symlink escapes, enforce protected roots, and use Trash/Recycle Bin for personal files.
- Low-confidence destructive proposals may never become one-click actions.

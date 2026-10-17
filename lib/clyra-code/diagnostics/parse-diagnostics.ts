/**
 * Parses compiler output from swiftc, swift build, and xcodebuild into structured
 * diagnostics. The file:line:column form is shared by all three, so one parser
 * covers the Swift Package and Xcode paths.
 *
 * Raw output is never the only record: callers keep the structured list and use
 * the text only for display.
 */

export type BuildDiagnosticSeverity = "error" | "warning" | "note";

export type BuildDiagnostic = {
  file?: string;
  line?: number;
  column?: number;
  /** Target or module name when the compiler reports one. */
  target?: string;
  severity: BuildDiagnosticSeverity;
  message: string;
};

// /abs/path/File.swift:12:5: error: cannot find 'x' in scope
const LOCATED = /^(.+?):(\d+):(\d+): (error|warning|note): (.*)$/;
// error: no such module 'Foo'   (no location, e.g. linker or manifest errors)
const UNLOCATED = /^(error|warning): (.*)$/;

export function parseBuildDiagnostics(output: string): BuildDiagnostic[] {
  const seen = new Set<string>();
  const diagnostics: BuildDiagnostic[] = [];

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    let diagnostic: BuildDiagnostic | undefined;
    const located = LOCATED.exec(line);
    if (located) {
      diagnostic = {
        file: located[1],
        line: Number(located[2]),
        column: Number(located[3]),
        severity: located[4] as BuildDiagnosticSeverity,
        message: located[5].trim(),
      };
    } else {
      const unlocated = UNLOCATED.exec(line);
      if (unlocated) {
        diagnostic = { severity: unlocated[1] as BuildDiagnosticSeverity, message: unlocated[2].trim() };
      }
    }
    if (!diagnostic) continue;

    // swift build repeats the same error across its summary, so drop exact repeats.
    const key = `${diagnostic.file ?? ""}:${diagnostic.line ?? ""}:${diagnostic.column ?? ""}:${diagnostic.severity}:${diagnostic.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    diagnostics.push(diagnostic);
  }

  return diagnostics;
}

export function summarizeDiagnostics(diagnostics: BuildDiagnostic[]) {
  let errors = 0;
  let warnings = 0;
  for (const d of diagnostics) {
    if (d.severity === "error") errors += 1;
    else if (d.severity === "warning") warnings += 1;
  }
  return { errors, warnings };
}

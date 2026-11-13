/**
 * Small, deterministic Codex-style error presentation.
 * No error is fabricated: the category comes from actual server/tool output.
 * Keep full diagnostics in the existing terminal and expandable tool rows.
 */
export type CodeErrorKind = "auth" | "rate-limit" | "network" | "dependencies" | "typescript" | "build" | "permission" | "missing" | "port" | "runtime";
export type CodeErrorPresentation = {
  kind: CodeErrorKind;
  title: string;
  detail: string;
  nextStep: string;
  canRetry: boolean;
};
export function describeCodeError(message: string): CodeErrorPresentation {
  const value = message.trim();
  let kind: CodeErrorKind = "runtime";
  if (/\b(401|403|unauthorized|invalid.api.key|authentication failed|api.key.*missing|no.api.key|credentials?.*invalid)\b/i.test(value)) kind = "auth";
  else if (/\b(429|rate.limit|quota.exceeded|too.many.requests|insufficient.quota)\b/i.test(value)) kind = "rate-limit";
  else if (/\b(ETIMEDOUT|ECONNREFUSED|ENOTFOUND|ECONNRESET|fetch failed|network error|failed to fetch|offline|socket hang up)\b/i.test(value)) kind = "network";
  else if (/\b(EACCES|EPERM|permission denied|operation not permitted|read.only.file.system)\b/i.test(value)) kind = "permission";
  else if (/\b(EADDRINUSE|port .*in use|address already in use)\b/i.test(value)) kind = "port";
  else if (/\b(module not found|cannot find module|missing dependency|npm ERR|pnpm ERR|command not found|cannot resolve module)\b/i.test(value)) kind = "dependencies";
  else if (/\b(TS\d{4}|typescript error|type '.*' is not assignable|typecheck failed|tsc.*error)\b/i.test(value)) kind = "typescript";
  else if (/\b(ENOENT|no such file|not found:|does not exist|cannot find file)\b/i.test(value)) kind = "missing";
  else if (/\b(build failed|compilation failed|syntaxerror|unexpected token|vite.*error|webpack.*error)\b/i.test(value)) kind = "build";
  const copy: Record<CodeErrorKind, [string, string, string, boolean]> = {
    auth: ["Authentication required", "The connected provider rejected the credentials.", "Check the provider connection or API key, then retry.", false],
    "rate-limit": ["Usage limit reached", "The provider is temporarily refusing additional requests.", "Check quota or try again after the limit resets.", true],
    network: ["Connection interrupted", "A request to a dependency or provider could not complete.", "Check connectivity and whether the destination service is running.", true],
    permission: ["Permission denied", "This action cannot access the requested file or resource.", "Check file ownership, access permissions or sandbox restrictions.", false],
    port: ["Preview port unavailable", "Another process is already using the required address.", "Stop the conflicting process or restart the preview on a free port.", true],
    dependencies: ["Dependency unavailable", "The project requires a module or executable that was not found.", "Review the package manifest and install the project’s requirements.", true],
    typescript: ["TypeScript check failed", "The source contains a type error.", "Open the detailed error, correct the referenced types, and rerun checks.", true],
    missing: ["Required file not found", "A command or import references a file that is unavailable.", "Verify the path and whether the expected file was created.", true],
    build: ["Build failed", "The compiler or bundler could not finish building the project.", "Inspect the first build error and correct the relevant source file.", true],
    runtime: ["Something went wrong", "The agent or command did not complete successfully.", "Expand the failed step or open the terminal for the original error.", true],
  };
  const [title, detail, nextStep, canRetry] = copy[kind];
  return { kind, title, detail, nextStep, canRetry };
}

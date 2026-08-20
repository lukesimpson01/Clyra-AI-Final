import { useCallback, useEffect, useState } from "react";
import { Check, CircleDot, GitBranch, GitCommitHorizontal, Github, Loader2, RefreshCw, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { api, type ProjectGitStatus } from "./api";

type Props = { projectId: string; projectName: string; onStatusChange?: (status: ProjectGitStatus) => void };

const isPlaceholderProjectName = (value: string) => /^(new|untitled) project$/i.test(value.trim());

const statusText = (status: ProjectGitStatus | null) => {
  if (!status?.initialized) return "Not published";
  if (!status.changes.length) return status.remoteUrl ? "Synced locally" : "Ready to publish";
  const newFiles = status.changes.filter((change) => change.status === "A").length;
  const modified = status.changes.length - newFiles;
  return `${status.changes.length} change${status.changes.length === 1 ? "" : "s"}${modified ? ` · ${modified} modified` : ""}${newFiles ? ` · ${newFiles} new` : ""}`;
};

/** Compact, project-scoped source control. Credentials never enter this UI. */
export function GitHubPopover({ projectId, projectName, onStatusChange }: Props) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<ProjectGitStatus | null>(null);
  const [account, setAccount] = useState<{ connected: boolean; authAvailable: boolean; message: string; account?: { login: string; avatarUrl?: string } | null } | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<"init" | "commit" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingName, setPendingName] = useState(projectName);

  const refresh = useCallback(async () => {
    const [nextStatus, nextAccount] = await Promise.all([
      api.projectGitStatus(projectId),
      api.githubStatus(),
    ]);
    setStatus(nextStatus);
    setAccount(nextAccount);
    setPendingName(projectName);
    onStatusChange?.(nextStatus);
  }, [onStatusChange, projectId]);

  useEffect(() => { if (open) void refresh().catch((error) => setNotice(error instanceof Error ? error.message : "Could not load source control.")); }, [open, refresh]);

  const initialize = async () => {
    const name = pendingName.trim();
    if (!name || isPlaceholderProjectName(name)) {
      setNotice("Name this project before setting up source control.");
      return;
    }
    setBusy("init"); setNotice(null);
    try {
      if (name !== projectName) await api.renameProject(projectId, name);
      const next = await api.initProjectGit(projectId);
      setStatus(next); onStatusChange?.(next);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not initialise source control."); }
    finally { setBusy(null); }
  };

  const commit = async () => {
    if (!message.trim()) {
      setNotice("Add a concise commit message first.");
      return;
    }
    setBusy("commit"); setNotice(null);
    try {
      const result = await api.commitProjectGit(projectId, message.trim());
      setStatus(result.status); onStatusChange?.(result.status); setMessage("");
      setNotice(`Committed ${result.oid.slice(0, 7)} locally.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not create a commit."); }
    finally { setBusy(null); }
  };

  const changes = status?.changes ?? [];
  return (
    <div className="relative z-50">
      <button
        type="button"
        aria-label="GitHub source control"
        title="GitHub"
        onClick={() => setOpen((value) => !value)}
        className="relative flex h-[31px] w-[31px] items-center justify-center rounded-[9px] text-[color:var(--text-secondary)] transition-colors duration-150 hover:bg-black/[0.045] hover:text-[color:var(--text-primary)]"
      >
        <Github className="h-[16px] w-[16px]" strokeWidth={1.7} />
        {status?.changes.length ? <span className="absolute right-[5px] top-[5px] h-[4px] w-[4px] rounded-full bg-[color:var(--accent-blue)]" /> : null}
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: 5, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.985 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            onMouseDown={(event) => event.stopPropagation()}
            className="fixed inset-0 z-[90] flex items-center justify-center bg-black/[0.10] p-5 backdrop-blur-[1px]"
          >
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.985 }} transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className="w-full max-w-[380px] overflow-hidden rounded-[13px] border border-black/[0.09] bg-white shadow-[0_22px_60px_rgba(15,23,42,0.16)]"
            >
            <div className="flex items-start gap-2.5 px-4 pb-3 pt-4">
              <div className="mt-px flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-black/[0.045] text-[color:var(--text-primary)]"><Github className="h-[15px] w-[15px]" /></div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-[color:var(--text-primary)]">GitHub</p>
                <p className="mt-0.5 truncate text-[11.5px] text-[color:var(--text-tertiary)]">{status?.remoteUrl || pendingName || projectName}</p>
              </div>
              <button type="button" aria-label="Close GitHub" onClick={() => setOpen(false)} className="-mr-1 -mt-1 flex h-7 w-7 items-center justify-center rounded-[8px] text-[color:var(--text-tertiary)] transition-colors hover:bg-black/[0.04] hover:text-[color:var(--text-secondary)]"><X className="h-[13px] w-[13px]" /></button>
            </div>
            <div className="border-t border-black/[0.055] px-4 py-3">
              {!account?.connected ? (
                <div className="py-2 text-center">
                  <Github className="mx-auto h-5 w-5 text-[color:var(--text-primary)]" strokeWidth={1.6} />
                  <p className="mt-2 text-[13px] font-medium text-[color:var(--text-primary)]">Connect GitHub</p>
                  <p className="mx-auto mt-1 max-w-[270px] text-[11.5px] leading-[1.5] text-[color:var(--text-secondary)]">Sign in first to publish this project and keep its source control in sync.</p>
                  <button type="button" disabled={!account?.authAvailable} onClick={() => setNotice(account?.authAvailable ? "GitHub sign-in opens through this installation’s configured authorization flow." : "GitHub sign-in has not been configured for this Clyra installation.")} className="mt-3 flex h-8 w-full items-center justify-center gap-1.5 rounded-[8px] bg-[color:var(--control-dark)] px-3 text-[11.5px] font-medium text-white transition-colors hover:bg-[color:var(--control-dark-hover)] disabled:cursor-not-allowed disabled:opacity-40"><Github className="h-[13px] w-[13px]" /> Continue with GitHub</button>
                  <p className="mt-2 text-[10.5px] leading-[1.4] text-[color:var(--text-tertiary)]">{account?.authAvailable ? "Your credentials stay outside the project and renderer." : "Ask an administrator to configure GitHub authorization."}</p>
                </div>
              ) : !status?.initialized ? (
                <>
                  <p className="text-[12px] font-medium text-[color:var(--text-primary)]">Name this project</p>
                  <p className="mt-0.5 text-[11.5px] leading-[1.45] text-[color:var(--text-secondary)]">Choose a clear workspace name before creating its repository.</p>
                  <input autoFocus value={pendingName} onChange={(event) => setPendingName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void initialize(); }} placeholder="Project name" className="mt-2.5 h-8 w-full rounded-[8px] border border-black/[0.09] bg-white px-2.5 text-[12px] text-[color:var(--text-primary)] outline-none transition-colors placeholder:text-[color:var(--text-tertiary)] focus:border-black/[0.22]" />
                  <button type="button" disabled={busy !== null} onClick={() => void initialize()} className="mt-2 flex h-8 w-full items-center justify-center gap-1.5 rounded-[8px] bg-[color:var(--control-dark)] px-2.5 text-[11.5px] font-medium text-white transition-colors hover:bg-[color:var(--control-dark-hover)] disabled:opacity-50">
                    {busy === "init" ? <Loader2 className="h-[12px] w-[12px] animate-spin" /> : <GitBranch className="h-[12px] w-[12px]" />} Name & initialise
                  </button>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-1.5 text-[11.5px] text-[color:var(--text-secondary)]">
                    <GitBranch className="h-[12px] w-[12px]" />
                    <span className="font-medium text-[color:var(--text-secondary)]">{status.branch || "main"}</span>
                    <span className="text-[color:var(--text-disabled)]">·</span>
                    <span>{statusText(status)}</span>
                    <button type="button" aria-label="Refresh Git status" onClick={() => void refresh()} className="ml-auto rounded-[5px] p-1 text-[color:var(--text-tertiary)] transition-colors hover:bg-black/[0.04] hover:text-[color:var(--text-secondary)]"><RefreshCw className="h-[12px] w-[12px]" /></button>
                  </div>
                  {changes.length ? <div className="mt-2 max-h-[102px] space-y-0.5 overflow-y-auto border-y border-black/[0.045] py-1.5">
                    {changes.slice(0, 8).map((change) => <div key={change.path} className="flex h-5 items-center gap-2 rounded-[5px] px-1.5 text-[11px] hover:bg-black/[0.025]"><span className={change.status === "D" ? "text-[color:var(--deletion-red)]" : change.status === "A" ? "text-[color:var(--addition-green)]" : "text-[color:var(--accent-blue)]"}>{change.status}</span><span className="min-w-0 flex-1 truncate text-[color:var(--text-secondary)]">{change.path}</span>{change.staged ? <Check className="h-[11px] w-[11px] text-[color:var(--addition-green)]" /> : null}</div>)}
                  </div> : null}
                  <div className="mt-2 flex gap-1.5">
                    <input value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && changes.length) void commit(); }} placeholder="Describe your changes…" className="h-7 min-w-0 flex-1 rounded-[7px] border border-black/[0.08] bg-white px-2 text-[11.5px] text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--text-tertiary)] focus:border-black/[0.18]" />
                    <button type="button" disabled={!changes.length || !message.trim() || busy !== null} onClick={() => void commit()} className="flex h-7 shrink-0 items-center gap-1 rounded-[7px] bg-[color:var(--control-dark)] px-2 text-[11px] font-medium text-white transition-colors hover:bg-[color:var(--control-dark-hover)] disabled:cursor-not-allowed disabled:opacity-40">{busy === "commit" ? <Loader2 className="h-[12px] w-[12px] animate-spin" /> : <GitCommitHorizontal className="h-[12px] w-[12px]" />} Commit</button>
                  </div>
                </>
              )}
            </div>
            <div className="border-t border-black/[0.055] px-4 py-2.5">
              {account?.connected ? <p className="flex items-center gap-1.5 text-[11px] text-[color:var(--text-secondary)]"><CircleDot className="h-[11px] w-[11px] text-[color:var(--addition-green)]" /> Connected{account.account?.login ? ` as @${account.account.login}` : " to GitHub"}</p> : null}
              {busy ? <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[color:var(--text-secondary)]"><Loader2 className="h-[11px] w-[11px] animate-spin text-[color:var(--accent-blue)]" /> {busy === "init" ? "Preparing project source control…" : "Creating local commit…"}</p> : null}
              {notice ? <p className="mt-0.5 text-[11px] leading-[1.4] text-[color:var(--accent-blue)]">{notice}</p> : null}
            </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

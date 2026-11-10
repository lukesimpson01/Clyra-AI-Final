import { Check, KeyRound, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "../../lib/utils";

type Config = { mode: "clyra" | "own" | null; hasKey: boolean; clyraAiAvailable: boolean };

/**
 * The prompt that sits above the composer when an imported app needs an AI model API. The user either
 * turns on Clyra AI (a project token for Clyra's own proxy: the model key never enters the project) or adds
 * their own key, which goes straight to the server and is never echoed into the chat or the page.
 */
export function AiKeyPill({ projectId, appName, onChosen }: { projectId: string; appName: string; onChosen: (mode: "clyra" | "own") => void }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [editing, setEditing] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/clyra-code/projects/${encodeURIComponent(projectId)}/ai-config`);
      if (response.ok) setConfig((await response.json()) as Config);
    } catch { /* offline: the pill stays hidden */ }
  }, [projectId]);
  useEffect(() => { setConfig(null); setEditing(false); setKeyDraft(""); setError(null); void load(); }, [load]);

  const save = async (mode: "clyra" | "own") => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/clyra-code/projects/${encodeURIComponent(projectId)}/ai-config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "own" ? { mode, apiKey: keyDraft } : { mode }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) { setError(data.error ?? "Could not save."); return; }
      setKeyDraft("");
      setEditing(false);
      await load();
      onChosen(mode);
    } finally {
      setBusy(false);
    }
  };

  if (!config) return null;
  const configured = config.hasKey && config.mode !== null;

  return (
    <div role="group" aria-label="AI setup" className="mx-auto mb-2 flex w-full max-w-[688px] flex-col gap-2 rounded-[12px] text-left border border-[var(--border-subtle)] bg-[var(--composer-surface)] px-4 py-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-center gap-3">
        <span className="cc-squircle flex h-8 w-8 shrink-0 items-center justify-center bg-[#3977F6]/[0.09] text-[#3977F6]">{configured ? <Check className="h-4 w-4" strokeWidth={1.9} /> : <Sparkles className="h-4 w-4" strokeWidth={1.7} />}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-medium text-[var(--text-primary)]">
            {configured ? `${appName} AI: ${config.mode === "clyra" ? "Clyra AI" : "your own API key"}` : `${appName} needs an AI API`}
          </span>
          <span className="block text-[11.5px] leading-[1.45] text-[var(--text-tertiary)]">
            {configured ? "Set. The key is stored for this project only and is never shown." : "Its AI features call a model API. Use Clyra AI, or add your own key."}
          </span>
        </span>
        {configured && !editing ? (
          <button type="button" onClick={() => setEditing(true)} className="shrink-0 rounded-full px-3 py-1 text-[12px] font-medium text-[#3977F6] transition-colors hover:bg-[#3977F6]/[0.08]">Change</button>
        ) : null}
        {!configured && !editing ? (
          <span className="flex shrink-0 items-center gap-1.5">
            <button type="button" disabled={busy || !config.clyraAiAvailable} title={config.clyraAiAvailable ? undefined : "Clyra AI is not available on this device"} onClick={() => void save("clyra")}
              className="h-[30px] rounded-full bg-[#3977F6] px-3.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-[#0068DB] disabled:opacity-40">Use Clyra AI</button>
            <button type="button" disabled={busy} onClick={() => setEditing(true)}
              className="flex h-[30px] items-center gap-1.5 rounded-full bg-[rgba(55,53,47,0.06)] px-3.5 text-[12.5px] font-medium text-[var(--text-primary)] transition-colors hover:bg-[rgba(55,53,47,0.1)]"><KeyRound className="h-3 w-3" />My own key</button>
          </span>
        ) : null}
      </div>
      {editing ? (
        <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); void save("own"); }}>
          <input
            type="password" autoComplete="off" spellCheck={false} aria-label="API key" placeholder="Paste your API key"
            value={keyDraft} onChange={(event) => setKeyDraft(event.target.value)}
            className="h-[32px] min-w-0 flex-1 rounded-[8px] border border-[var(--border-subtle)] bg-white px-3 text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-[#3977F6]/40"
          />
          <button type="submit" disabled={busy || keyDraft.trim().length < 8} className="h-[30px] rounded-full bg-[#3977F6] px-3.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-[#0068DB] disabled:opacity-40">Save key</button>
          {config.clyraAiAvailable ? <button type="button" disabled={busy} onClick={() => void save("clyra")} className="h-[30px] rounded-full px-3 text-[12.5px] font-medium text-[#3977F6] hover:bg-[#3977F6]/[0.08]">Use Clyra AI instead</button> : null}
          <button type="button" onClick={() => { setEditing(false); setKeyDraft(""); setError(null); }} className={cn("h-[30px] rounded-full px-3 text-[12.5px] text-[var(--text-tertiary)] hover:bg-black/[0.04]")}>Cancel</button>
        </form>
      ) : null}
      {error ? <p role="alert" className="text-[11.5px] text-[#A43D3D]">{error}</p> : null}
    </div>
  );
}

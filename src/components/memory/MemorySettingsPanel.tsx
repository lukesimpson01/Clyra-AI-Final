import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  BookOpen,
  BrainCircuit,
  Check,
  ChevronRight,
  Clock,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  UserRound,
  Wrench,
  X,
} from "lucide-react";
import { cn } from "../../lib/utils";
import {
  addMemoryEntry,
  archiveSkill,
  createSkill,
  deleteMemoryEntry,
  deleteSkill,
  fetchJourney,
  forgetAllMemory,
  getMemoryDocument,
  getMemorySettings,
  listMemoryEntries,
  listSkills,
  patchMemoryEntry,
  readSkill,
  saveMemoryDocument,
  setMemoryPolicy,
  updateSkill,
  type MemoryEntryDTO,
  type SkillDTO,
} from "../../lib/memoryClient";

const ACCENT = "#1E6FFF";

type SubTab = "identity" | "user" | "skills" | "journey" | "settings";

const SUB_TABS: Array<{ id: SubTab; label: string; icon: typeof UserRound }> = [
  { id: "identity", label: "Identity", icon: BrainCircuit },
  { id: "user", label: "About You", icon: UserRound },
  { id: "skills", label: "Skills", icon: Wrench },
  { id: "journey", label: "Journey", icon: Clock },
  { id: "settings", label: "Settings", icon: ShieldCheck },
];

export type MemorySettingsPanelProps = {
  profileName: string;
  setProfileName?: (value: string) => void;
  accentColor: string;
  setAccentColor: (value: string) => void;
  theme: string;
  setTheme: (value: string) => void;
};

function SectionCard({ title, detail, children, actions }: { title: string; detail?: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          {title ? <p className="text-[14px] font-semibold tracking-[-0.01em] text-slate-900">{title}</p> : null}
          {detail ? <p className="mt-0.5 text-[12px] leading-relaxed text-slate-500">{detail}</p> : null}
        </div>
        {actions}
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function EmptyState({ icon: Icon, title, detail }: { icon: typeof BookOpen; title: string; detail: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 py-10 text-center">
      <Icon className="h-5 w-5" style={{ color: "#9DA1A9" }} />
      <p className="mt-2 text-[13px] font-medium text-slate-600">{title}</p>
      <p className="mt-0.5 max-w-[260px] text-[12px] leading-relaxed text-slate-400">{detail}</p>
    </div>
  );
}

function PillButton({ active, onClick, children }: { active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-all",
        active ? "border-transparent text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
      )}
      style={active ? { background: ACCENT } : undefined}
    >
      {children}
    </button>
  );
}

function MiniInput({ value, onChange, placeholder, className }: { value: string; onChange: (value: string) => void; placeholder?: string; className?: string }) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className={cn("h-9 rounded-xl border border-slate-200/80 bg-white px-3 text-[13px] text-slate-800 outline-none transition-shadow focus:border-slate-300 focus:shadow-[0_0_0_3px_rgba(16,18,24,.06)]", className)}
    />
  );
}

export function MemorySettingsPanel({ setProfileName, setAccentColor, setTheme }: MemorySettingsPanelProps) {
  const [subTab, setSubTab] = useState<SubTab>("identity");
  return (
    <div className="min-h-0">
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {SUB_TABS.map((tab) => {
          const Icon = tab.icon;
          const active = subTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSubTab(tab.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-all",
                active ? "border-transparent text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
              )}
              style={active ? { background: ACCENT } : undefined}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>
      {subTab === "identity" ? <IdentitySection /> : null}
      {subTab === "user" ? <UserSection /> : null}
      {subTab === "skills" ? <SkillsSection /> : null}
      {subTab === "journey" ? <JourneySection /> : null}
      {subTab === "settings" ? <MemorySettingsSection setProfileName={setProfileName} setAccentColor={setAccentColor} setTheme={setTheme} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------- Identity

const DOC_NAMES = ["SOUL.md", "USER.md", "MEMORY.md", "AGENTS.md"] as const;

function IdentitySection() {
  const [selected, setSelected] = useState<(typeof DOC_NAMES)[number]>("SOUL.md");
  const [docs, setDocs] = useState<Record<string, { content: string; editable: boolean }>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draftRef = useRef<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const entries: Record<string, { content: string; editable: boolean }> = {};
    for (const name of DOC_NAMES) {
      const doc = await getMemoryDocument(name);
      if (doc) entries[name] = doc;
    }
    setDocs(entries);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const doc = docs[selected];
  const editable = selected === "SOUL.md" && doc?.editable;

  const save = async () => {
    if (!editable) return;
    setSaving(true);
    setError(null);
    const ok = await saveMemoryDocument("SOUL.md", draftRef.current);
    setSaving(false);
    if (!ok) {
      setError("Clyra could not save the identity edit. The protected section cannot be modified.");
      return;
    }
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 1200);
    await load();
  };

  return (
    <div className="grid gap-3">
      <SectionCard
        title=""
        detail=""
        actions={
          <div className="flex items-center gap-1.5">
            {DOC_NAMES.map((name) => (
              <PillButton key={name} active={selected === name} onClick={() => setSelected(name)}>{name}</PillButton>
            ))}
          </div>
        }
      >
        {loading ? (
          <div className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-300" /></div>
        ) : !doc ? (
          <EmptyState icon={FileText} title="Document unavailable" detail="Clyra could not load this document. Try again." />
        ) : editable ? (
          <div>
            <div className="mb-2 flex items-center gap-2 text-[11.5px] font-medium text-slate-400">
              <ShieldCheck className="h-3.5 w-3.5" style={{ color: ACCENT }} />
              The protected core below is read-only. Edit the persona section under it.
            </div>
            <textarea
              key={selected}
              defaultValue={doc.content}
              onChange={(event) => { draftRef.current = event.target.value; }}
              spellCheck={false}
              className="h-[340px] w-full resize-none rounded-xl border border-slate-200/80 bg-[#FBFBF9] p-4 font-mono text-[12px] leading-relaxed text-slate-800 outline-none focus:border-slate-300"
            />
            <div className="mt-2 flex items-center justify-end gap-2">
              {error ? <span className="text-[12px] text-rose-600">{error}</span> : null}
              {savedFlash ? <span className="flex items-center gap-1 text-[12px] font-medium text-emerald-600"><Check className="h-3.5 w-3.5" /> Saved</span> : null}
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                className="inline-flex h-9 items-center gap-2 rounded-xl px-3.5 text-[13px] font-medium text-white transition-all hover:opacity-90 disabled:opacity-40"
                style={{ background: ACCENT }}
              >
                <Save className="h-3.5 w-3.5" /> Save persona
              </button>
            </div>
          </div>
        ) : (
          <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap rounded-xl border border-slate-200/80 bg-[#FBFBF9] p-4 font-mono text-[12px] leading-relaxed text-slate-800">
            {doc.content}
          </pre>
        )}
      </SectionCard>
    </div>
  );
}

// ------------------------------------------------------------------ User

function UserSection() {
  const [entries, setEntries] = useState<MemoryEntryDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newContent, setNewContent] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEntries(await listMemoryEntries({ kind: "user", state: "active" }));
    } catch {
      setError("Clyra could not load your profile memories.");
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const saveNew = async () => {
    if (!newContent.trim()) return;
    const entry = await addMemoryEntry({ kind: "user", category: "fact", content: newContent.trim(), source: "settings", explicit: true });
    if (entry) {
      setNewContent("");
      setAdding(false);
      await load();
    }
  };

  const saveEdit = async (id: string) => {
    const entry = await patchMemoryEntry(id, { content: editDraft.trim() });
    if (entry) {
      setEditingId(null);
      await load();
    }
  };

  const remove = async (id: string) => {
    if (await deleteMemoryEntry(id)) await load();
  };

  const CATEGORY_LABELS: Record<string, string> = {
    profile: "Personal details", preference: "Preferences", fact: "Facts about you", goal: "Goals and projects",
  };

  const groups = useMemo(() => {
    const byCategory = new Map<string, MemoryEntryDTO[]>();
    for (const entry of entries) {
      const list = byCategory.get(entry.category) || [];
      list.push(entry);
      byCategory.set(entry.category, list);
    }
    return Object.entries(CATEGORY_LABELS)
      .map(([category, label]) => ({ category, label, items: byCategory.get(category) || [] }))
      .filter((group) => group.items.length > 0);
  }, [entries]);

  return (
    <div className="grid gap-3">
      <SectionCard
        title="About you"
        detail="Durable facts and preferences Clyra uses across conversations, kept in USER.md."
        actions={
          <button
            type="button"
            onClick={() => setAdding((value) => !value)}
            className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium text-white transition-all hover:opacity-90"
            style={{ background: ACCENT }}
          >
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
        }
      >
        {adding ? (
          <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
            <textarea
              value={newContent}
              onChange={(event) => setNewContent(event.target.value)}
              placeholder="e.g. I work on macOS with Node 22, or: I prefer bullet points"
              className="h-20 w-full resize-none rounded-lg border border-slate-200 bg-white p-2.5 text-[13px] text-slate-800 outline-none"
            />
            <div className="mt-2 flex justify-end gap-2">
              <button type="button" onClick={() => setAdding(false)} className="h-8 rounded-lg px-3 text-[12px] font-medium text-slate-500 hover:bg-slate-200/60">Cancel</button>
              <button type="button" onClick={() => void saveNew()} disabled={!newContent.trim()} className="h-8 rounded-lg px-3 text-[12px] font-medium text-white disabled:opacity-40" style={{ background: ACCENT }}>Save</button>
            </div>
          </div>
        ) : null}
        {loading ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-300" /></div>
        ) : error ? (
          <EmptyState icon={UserRound} title="Couldn't load memories" detail={error} />
        ) : groups.length === 0 ? (
          <EmptyState icon={UserRound} title="Nothing saved yet" detail="Tell Clyra about yourself in chat (for example “my name is…”, “I prefer…”) or add an entry above." />
        ) : (
          <div className="space-y-5">
            {groups.map((group) => (
              <div key={group.category}>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{group.label}</p>
                <ul className="space-y-1.5">
                  {group.items.map((entry) => (
                    <li key={entry.id} className="group flex items-start gap-2.5 rounded-lg px-1.5 py-1 -mx-1.5 hover:bg-slate-50/70">
                      {editingId === entry.id ? (
                        <div className="min-w-0 flex-1">
                          <textarea value={editDraft} onChange={(event) => setEditDraft(event.target.value)} className="h-20 w-full resize-none rounded-lg border border-slate-200 bg-white p-2.5 text-[13px] text-slate-800 outline-none" />
                          <div className="mt-1.5 flex justify-end gap-2">
                            <button type="button" onClick={() => setEditingId(null)} className="h-7 rounded-lg px-2.5 text-[12px] font-medium text-slate-500 hover:bg-slate-100">Cancel</button>
                            <button type="button" onClick={() => void saveEdit(entry.id)} className="h-7 rounded-lg px-2.5 text-[12px] font-medium text-white" style={{ background: ACCENT }}>Save</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: ACCENT }} />
                          <span className="min-w-0 flex-1 text-[13px] leading-relaxed text-slate-800">{entry.content}</span>
                          <span className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                            <button type="button" onClick={() => { setEditingId(entry.id); setEditDraft(entry.content); }} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Edit"><RefreshCw className="h-3.5 w-3.5" /></button>
                            <button type="button" onClick={() => void remove(entry.id)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-500" aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                          </span>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ----------------------------------------------------------------- Skills

function SkillsSection() {
  const [skills, setSkills] = useState<SkillDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createContent, setCreateContent] = useState("");
  const [openName, setOpenName] = useState<string | null>(null);
  const [openContent, setOpenContent] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setSkills(await listSkills({ status: showArchived ? "all" : "active" }));
    setLoading(false);
  }, [showArchived]);

  useEffect(() => { void load(); }, [load]);

  const openSkill = async (name: string) => {
    const result = await readSkill(name);
    setOpenName(name);
    setOpenContent(result?.content || "");
    setDraft(result?.content || "");
    setMessage(null);
  };

  const saveDraft = async () => {
    if (!openName) return;
    const result = await updateSkill(openName, { content: draft });
    if (result.ok) {
      setMessage(result.pendingId ? "Saved as a pending change." : "Skill updated.");
      setOpenContent(draft);
      await load();
    } else {
      setMessage(result.error || "Could not update the skill.");
    }
  };

  const submitCreate = async () => {
    const result = await createSkill({ name: createName, description: createDescription, content: createContent });
    if (result.ok) {
      setCreating(false);
      setCreateName("");
      setCreateDescription("");
      setCreateContent("");
      setMessage(result.pendingId ? "Saved as a pending change." : null);
      await load();
    } else {
      setMessage(result.error || "Could not create the skill.");
    }
  };

  const toggleArchive = async (name: string) => {
    await archiveSkill(name);
    await load();
  };

  const remove = async (name: string) => {
    if (await deleteSkill(name)) {
      if (openName === name) setOpenName(null);
      await load();
    }
  };

  return (
    <div className="grid gap-3">
      <SectionCard
        title="Skills"
        detail="Reusable procedures Clyra can load when a task needs them. Each skill lives in skills/<name>/SKILL.md — progressive disclosure keeps only the description in every prompt."
        actions={
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => setShowArchived((value) => !value)} className={cn("rounded-full border px-3 py-1.5 text-[12px] font-medium transition-all", showArchived ? "border-slate-300 bg-slate-100 text-slate-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50")}>
              {showArchived ? "Active only" : "Include archived"}
            </button>
            <button type="button" onClick={() => setCreating(true)} className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium text-white transition-all hover:opacity-90" style={{ background: ACCENT }}>
              <Plus className="h-3.5 w-3.5" /> New skill
            </button>
          </div>
        }
      >
        {message ? <div className="mb-3 rounded-xl bg-slate-50 px-3 py-2 text-[12.5px] text-slate-600">{message}</div> : null}
        {creating ? (
          <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <MiniInput value={createName} onChange={setCreateName} placeholder="skill-name (a-z, 0-9, -)" />
              <MiniInput value={createDescription} onChange={setCreateDescription} placeholder="One-line description" />
            </div>
            <textarea value={createContent} onChange={(event) => setCreateContent(event.target.value)} placeholder={"# Skill procedure\n\nWrite the reusable steps here…"} className="mt-2 h-32 w-full resize-none rounded-lg border border-slate-200 bg-white p-2.5 font-mono text-[12px] text-slate-800 outline-none" />
            <div className="mt-2 flex justify-end gap-2">
              <button type="button" onClick={() => setCreating(false)} className="h-8 rounded-lg px-3 text-[12px] font-medium text-slate-500 hover:bg-slate-200/60">Cancel</button>
              <button type="button" onClick={() => void submitCreate()} disabled={!createName.trim() || !createContent.trim()} className="h-8 rounded-lg px-3 text-[12px] font-medium text-white disabled:opacity-40" style={{ background: ACCENT }}>Create</button>
            </div>
          </div>
        ) : null}
        {loading ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-300" /></div>
        ) : skills.length === 0 ? (
          <EmptyState icon={Wrench} title="No skills yet" detail="Clyra proposes skills from verified, reusable workflows. You can also create one above." />
        ) : (
          <div className="divide-y divide-slate-100">
            {skills.map((skill) => (
              <div key={skill.id} className="py-2.5 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-3">
                  <button type="button" onClick={() => void openSkill(skill.id)} className="flex min-w-0 items-start gap-2 text-left">
                    <ChevronRight className={cn("mt-0.5 h-4 w-4 shrink-0 transition-transform", openName === skill.id && "rotate-90")} style={{ color: ACCENT }} />
                    <span>
                      <span className="block text-[13px] font-medium text-slate-800">{skill.name}</span>
                      <span className="mt-0.5 block text-[12px] text-slate-500">{skill.description || "No description"}</span>
                      <span className="mt-0.5 block text-[11px] text-slate-400">v{skill.version}{skill.status === "archived" ? " · archived" : ""}</span>
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center gap-1">
                    <button type="button" onClick={() => void toggleArchive(skill.id)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label={skill.status === "active" ? "Archive" : "Restore"}><Archive className="h-3.5 w-3.5" /></button>
                    <button type="button" onClick={() => void remove(skill.id)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-500" aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
                {openName === skill.id ? (
                  <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                    <textarea value={draft} onChange={(event) => setDraft(event.target.value)} spellCheck={false} className="h-56 w-full resize-none rounded-lg border border-slate-200 bg-white p-3 font-mono text-[12px] leading-relaxed text-slate-800 outline-none" />
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-[11px] text-slate-400">Saved to skills/{skill.id}/SKILL.md</span>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => { setOpenName(null); setOpenContent(null); }} className="h-8 rounded-lg px-3 text-[12px] font-medium text-slate-500 hover:bg-slate-200/60">Close</button>
                        <button type="button" onClick={() => void saveDraft()} disabled={draft === openContent} className="h-8 rounded-lg px-3 text-[12px] font-medium text-white disabled:opacity-40" style={{ background: ACCENT }}>Save</button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// --------------------------------------------------------------- Journey

function JourneySection() {
  const [data, setData] = useState<{ nodes: Array<{ id: string; type: string; label: string; detail: string }>; edges: Array<{ from: string; to: string; kind: string }> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailEntry, setDetailEntry] = useState<MemoryEntryDTO | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchJourney());
    } catch {
      setData(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const select = async (id: string) => {
    setSelectedId(id);
    setDetailEntry(null);
    if (id.startsWith("memory:")) {
      const entries = await listMemoryEntries({ state: "all" });
      setDetailEntry(entries.find((entry) => `memory:${entry.id}` === id) || null);
    }
  };

  const TYPE_LABELS: Record<string, string> = {
    session: "Conversation", user: "About you", agent: "Learned", project: "Project", skill: "Skill",
  };

  if (loading) {
    return <SectionCard title="Learning journey" detail="Loading real records…"><div className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-300" /></div></SectionCard>;
  }
  if (!data) {
    return <SectionCard title="Learning journey" detail="Clyra could not load the journey."><EmptyState icon={Clock} title="Unavailable" detail="The journey graph could not be built." /></SectionCard>;
  }

  const connected = new Set(data.edges.flatMap((edge) => [edge.from, edge.to]));

  return (
    <div className="grid gap-3">
      <SectionCard
        title="Learning journey"
        detail="Conversations, memories and skills connected by real references — a memory learned during a session, or an entry superseded by a newer one."
        actions={
          <button type="button" onClick={() => void load()} className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-slate-50">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        }
      >
        <div className="grid gap-2 sm:grid-cols-2">
          {data.nodes.map((node) => (
            <button
              key={node.id}
              type="button"
              onClick={() => void select(node.id)}
              className={cn(
                "rounded-xl border p-3 text-left transition-all",
                selectedId === node.id ? "border-transparent ring-2" : "border-slate-200/80 hover:border-slate-300 hover:bg-slate-50",
              )}
              style={selectedId === node.id ? { boxShadow: `0 0 0 2px ${ACCENT}` } : undefined}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide" style={{ background: "rgba(30,111,255,.08)", color: ACCENT }}>
                  {TYPE_LABELS[node.type] || node.type}
                </span>
                {connected.has(node.id) ? <span className="text-[10.5px] text-slate-400">connected</span> : null}
              </div>
              <p className="mt-1.5 line-clamp-2 text-[12.5px] font-medium text-slate-800">{node.label}</p>
              {node.detail ? <p className="mt-0.5 line-clamp-1 text-[11.5px] text-slate-400">{node.detail}</p> : null}
            </button>
          ))}
        </div>
        {data.nodes.length === 0 ? <EmptyState icon={Clock} title="Nothing to chart yet" detail="The journey fills in as conversations create memories and skills." /> : null}
        {data.edges.length ? (
          <p className="mt-3 text-center text-[11.5px] text-slate-400">{data.edges.length} real reference{data.edges.length === 1 ? "" : "s"} between records</p>
        ) : null}
      </SectionCard>
      {selectedId && detailEntry ? (
        <SectionCard title="Record detail" detail="The real stored entry behind the selected node." actions={<button type="button" onClick={() => setSelectedId(null)} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Close"><X className="h-4 w-4" /></button>}>
          <p className="text-[13px] leading-relaxed text-slate-800">{detailEntry.content}</p>
          <p className="mt-2 text-[11.5px] text-slate-400">
            {detailEntry.kind} · {detailEntry.category} · {detailEntry.source} · {new Date(detailEntry.updatedAt).toLocaleString()}
          </p>
        </SectionCard>
      ) : null}
    </div>
  );
}

// -------------------------------------------------------------- Settings

function MemorySettingsSection({ setProfileName, setAccentColor, setTheme }: { setProfileName?: (value: string) => void; setAccentColor: (value: string) => void; setTheme: (value: string) => void }) {
  const [policies, setPolicies] = useState<Record<string, string> | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [confirmForget, setConfirmForget] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const settings = await getMemorySettings();
    if (settings) {
      setPolicies(settings.policies as unknown as Record<string, string>);
      setCounts(settings.counts);
    } else {
      setError("Clyra could not load memory settings.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const update = async (key: string, value: string) => {
    const next = await setMemoryPolicy(key, value);
    if (next) setPolicies(next as unknown as Record<string, string>);
  };

  const forget = async () => {
    const result = await forgetAllMemory();
    if (result.ok) {
      setForgot(true);
      setConfirmForget(false);
      await load();
    }
  };

  const applyProfileNow = async () => {
    // Re-apply stored profile to the live UI (name, accent, theme) so edits
    // made here are reflected immediately without reloading.
    const { fetchMemoryProfile } = await import("../../lib/memoryClient");
    const profile = await fetchMemoryProfile();
    if (!profile) return;
    if (profile.name && setProfileName) setProfileName(profile.name);
    if (profile.accent_color) setAccentColor(profile.accent_color);
    if (profile.theme === "Dark" || profile.theme === "Light") setTheme(profile.theme);
  };

  const policy = (key: string) => policies?.[key] ?? "";

  const PolicySelect = ({ label, detail, keyName, options }: { label: string; detail: string; keyName: string; options: Array<{ value: string; label: string }> }) => (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div>
        <p className="text-[13px] font-medium text-slate-800">{label}</p>
        <p className="mt-0.5 text-[11.5px] text-slate-400">{detail}</p>
      </div>
      <select
        value={policy(keyName)}
        onChange={(event) => void update(keyName, event.target.value)}
        className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-[12px] font-medium text-slate-700 outline-none"
        aria-label={label}
      >
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>
  );

  return (
    <div className="grid gap-3">
      <SectionCard title="Learning policy" detail="Choose what Clyra may apply automatically and what waits for your approval. Skill approvals and memory approvals are separate.">
        {error ? <p className="mb-2 text-[12.5px] text-rose-600">{error}</p> : null}
        {policies ? (
          <div className="divide-y divide-slate-100">
            <PolicySelect label="Memory writes" detail="New facts and preferences found in conversations." keyName="autoMemoryWrites" options={[{ value: "auto", label: "Apply automatically" }, { value: "review", label: "Ask first" }, { value: "off", label: "Off" }]} />
            <PolicySelect label="Skill writes" detail="Creating or updating reusable procedures." keyName="autoSkillWrites" options={[{ value: "auto", label: "Apply automatically" }, { value: "review", label: "Ask first" }, { value: "off", label: "Off" }]} />
            <PolicySelect label="Identity changes" detail="Edits to Clyra's persona. The protected core can never be changed." keyName="autoIdentityChanges" options={[{ value: "review", label: "Ask first" }, { value: "off", label: "Off" }]} />
            <PolicySelect label="Sensitive information" detail="Entries classified as personal or sensitive." keyName="sensitiveApproval" options={[{ value: "review", label: "Ask first" }, { value: "off", label: "Never store" }]} />
            <PolicySelect label="Background curation" detail="Bounded model-assisted extraction after each conversation." keyName="llmCuration" options={[{ value: "on", label: "On" }, { value: "off", label: "Off" }]} />
          </div>
        ) : (
          <div className="flex items-center justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-slate-300" /></div>
        )}
      </SectionCard>
      <SectionCard
        title="Storage"
        detail="What Clyra currently holds on this device. Export downloads everything; Forget erases all memory entries, sessions, skills and pending changes (the protected identity core remains)."
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: "Memories", value: counts.entries ?? 0 },
            { label: "Sessions", value: counts.sessions ?? 0 },
            { label: "Skills", value: counts.skills ?? 0 },
            { label: "Pending", value: counts.pending ?? 0 },
          ].map((stat) => (
            <div key={stat.label} className="rounded-xl border border-slate-200/80 bg-[#FBFBF9] p-3 text-center">
              <p className="text-[20px] font-semibold tracking-tight text-slate-900">{stat.value}</p>
              <p className="text-[11px] font-medium text-slate-400">{stat.label}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <a href="/api/memory/export" className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 text-[13px] font-medium text-slate-700 hover:bg-slate-50">
            <BookOpen className="h-4 w-4" /> Export memory
          </a>
          <button type="button" onClick={() => void applyProfileNow()} className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 text-[13px] font-medium text-slate-700 hover:bg-slate-50">
            <RefreshCw className="h-4 w-4" /> Apply profile to UI
          </button>
          {confirmForget ? (
            <>
              <button type="button" onClick={() => void forget()} className="inline-flex h-9 items-center gap-2 rounded-xl bg-rose-600 px-3.5 text-[13px] font-medium text-white hover:bg-rose-500">
                <Trash2 className="h-4 w-4" /> Confirm erase
              </button>
              <button type="button" onClick={() => setConfirmForget(false)} className="h-9 rounded-xl px-3 text-[13px] font-medium text-slate-500 hover:bg-slate-100">Cancel</button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirmForget(true)} className="inline-flex h-9 items-center gap-2 rounded-xl border border-rose-200 bg-white px-3.5 text-[13px] font-medium text-rose-600 hover:bg-rose-50">
              <Trash2 className="h-4 w-4" /> Forget everything
            </button>
          )}
          {forgot ? <span className="flex items-center gap-1 text-[12.5px] font-medium text-emerald-600"><Check className="h-4 w-4" /> Memory erased</span> : null}
        </div>
      </SectionCard>
      <SectionCard title="Personalization from memory" detail="Clyra can change the app around you: your name on the welcome page, your favourite colour as the accent, and your theme. These live in About You as profile entries and apply everywhere.">
        <p className="text-[12.5px] leading-relaxed text-slate-500">
          In chat, try saying <span className="font-medium text-slate-700">“my name is Sam”</span>, <span className="font-medium text-slate-700">“my favourite colour is green”</span>, or <span className="font-medium text-slate-700">“use dark mode”</span>. Clyra saves it to your profile and the change applies across the app immediately.
        </p>
      </SectionCard>
    </div>
  );
}

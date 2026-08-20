import { useEffect, useMemo, useState } from "react";
import { ArrowRight, ChevronLeft, Compass, Heart, Home, Library, Menu, MessagesSquare, Plus, Search } from "lucide-react";
import { cn } from "../../lib/utils";
import { roleplayApi } from "../../lib/roleplay/api";
import { characterAmbient, characterWorld, relativeTime } from "../../lib/roleplay/helpers";
import type { RoleplayCharacter, RoleplayChat, RoleplayPersona } from "../../lib/roleplay/types";
import { RoleplayCharacterEditor } from "./RoleplayCharacterEditor";
import { RoleplayCharacterCard, RoleplayPortrait } from "./RoleplayCharacterCard";
import { RoleplayChatView } from "./RoleplayChatView";
import { RoleplayCreateFlow } from "./RoleplayCreateFlow";
import { RoleplayStories } from "./RoleplayStories";
import { RoleplayHero, type RoleplayMode } from "./RoleplayHero";
import { RoleplayOnboarding } from "./RoleplayOnboarding";

type View = "library" | "review" | "edit" | "create" | "chat";
type DiscoverTab = "for-you" | "featured" | "worlds" | "new" | "favorites";
type RoleplaySection = "home" | "discover" | "library" | "stories";

const WORLDS = [
  { name: "Games", prompt: "Build a story-rich game world with a memorable companion", tone: "from-slate-700 to-slate-900", detail: "Quests, rivals and persistent choices" },
  { name: "Anime", prompt: "Build an original anime world with a layered ensemble cast", tone: "from-stone-500 to-zinc-800", detail: "Academies, powers and found family" },
  { name: "Fantasy", prompt: "Build an original fantasy kingdom with deep history and factions", tone: "from-emerald-900 to-slate-900", detail: "Kingdoms, journeys and ancient promises" },
  { name: "Movies & TV", prompt: "Create a cinematic ensemble drama in an original modern world", tone: "from-neutral-600 to-neutral-900", detail: "Character-led stories that remember" },
  { name: "School Life", prompt: "Create a prestigious school setting with friendship, rivalry and secrets", tone: "from-sky-800 to-slate-900", detail: "Friendships, rivals and hidden histories" },
  { name: "Historical", prompt: "Create a carefully researched historical world and a guide who lives there", tone: "from-amber-900 to-stone-900", detail: "Grounded eras and consequential choices" },
  { name: "Sci-Fi", prompt: "Build a thoughtful science-fiction world at the edge of explored space", tone: "from-indigo-950 to-slate-900", detail: "Stations, frontiers and strange signals" },
  { name: "Original Worlds", prompt: "Invent a completely original world with coherent lore, people and conflicts", tone: "from-zinc-700 to-stone-900", detail: "A new universe made around your idea" },
] as const;

const ONBOARDING_STORAGE_KEY = "clyra-roleplay-onboarding-v2";

function blankDraft(): RoleplayCharacter {
  const now = new Date().toISOString();
  return {
    id: "", name: "", tagline: "", tags: [], age: "", personality: "", speechPatterns: "",
    likes: "", dislikes: "", relationships: "", scenario: "", greeting: "", roleplayRules: "",
    outfit: "", responseStyle: "descriptive", customResponseStyle: "", dialogueFormat: "name", avatarUrl: "",
    avatarSourceUrl: "", visibility: "private", favorite: false, createdAt: now, updatedAt: now,
    lastUsedAt: null, generationQuery: null, generationSources: [],
  };
}

/**
 * Returning to a story is the most common thing anyone does here, so these
 * carry enough to remember *where you were* — who, which story, and the last
 * line spoken — rather than just a name and a timestamp. Landscape rather than
 * a tall portrait card, because the last line is the part worth reading.
 */
function ContinueTile({ character, chat, onOpen }: { character: RoleplayCharacter; chat: RoleplayChat; onOpen: () => void }) {
  const last = [...chat.messages].reverse().find((message) => message.content.trim());
  const ambient = characterAmbient(character.name, 0.055);
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{ ["--rp-tile-ambient" as string]: ambient }}
      className="rp-story-tile group flex h-[152px] w-[248px] shrink-0 flex-col justify-between overflow-hidden rounded-[15px] border border-[var(--rp-border)] p-3 text-left transition-[transform,border-color,box-shadow] duration-200 [transition-timing-function:var(--rp-ease)] hover:-translate-y-0.5 hover:border-[var(--rp-border-strong)] hover:shadow-[var(--rp-shadow-card)]"
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <RoleplayPortrait character={character} className="h-9 w-9 shrink-0 rounded-[11px]" initialsClassName="text-[11px]" imgClassName="group-hover:scale-[1.018]" />
        <span className="min-w-0 flex-1">
          <strong className="block truncate text-[13px] font-semibold leading-tight text-[var(--clyra-color-label)]">{character.name}</strong>
          <span className="block truncate text-[11px] font-medium text-[var(--clyra-color-label-tertiary)]">{chat.title && chat.title !== character.name ? chat.title : characterWorld(character)}</span>
        </span>
      </span>
      <span className="line-clamp-3 text-[11.5px] leading-[1.45] text-[var(--clyra-color-label-secondary)]">
        {last ? last.content : character.tagline}
      </span>
      <span className="flex items-center justify-between text-[10.5px] text-[var(--clyra-color-label-tertiary)]">
        <span>{relativeTime(chat.updatedAt)}</span>
        <span className="flex translate-x-1 items-center gap-1 font-medium text-[var(--rp-accent)] opacity-0 transition-[opacity,transform] duration-200 group-hover:translate-x-0 group-hover:opacity-100">
          Continue <ArrowRight className="h-3 w-3" />
        </span>
      </span>
    </button>
  );
}

function StoryTileSkeleton() {
  return <div className="rp-story-skeleton h-[152px] w-[248px] shrink-0 rounded-[15px]" aria-hidden />;
}

function CharacterCardSkeleton() {
  return <div className="rp-character-skeleton overflow-hidden rounded-[16px] border border-[var(--rp-border)]" aria-hidden><span /><div><i /><i /><i /></div></div>;
}

export default function RoleplayWorkspace() {
  const [view, setView] = useState<View>("library");
  const [characters, setCharacters] = useState<RoleplayCharacter[]>([]);
  const [personas, setPersonas] = useState<RoleplayPersona[]>([]);
  const [recentChats, setRecentChats] = useState<RoleplayChat[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<DiscoverTab>("for-you");
  const [query, setQuery] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");
  const [webResearch, setWebResearch] = useState(true);
  const [mode, setMode] = useState<RoleplayMode>("character");
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);
  const [draft, setDraft] = useState<RoleplayCharacter>(blankDraft());
  const [draftSources, setDraftSources] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [activeCharacter, setActiveCharacter] = useState<RoleplayCharacter | null>(null);
  const [activeChat, setActiveChat] = useState<RoleplayChat | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(() => { try { return localStorage.getItem(ONBOARDING_STORAGE_KEY) !== "1"; } catch { return true; } });
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);
  const [customInterest, setCustomInterest] = useState("");
  const [onboardingBusy, setOnboardingBusy] = useState(false);
  const [section, setSection] = useState<RoleplaySection>("home");
  // The rail carries a handful of recent stories; the Stories page carries all
  // of them. Fetch the full set only when someone actually opens that page.
  const [allChats, setAllChats] = useState<RoleplayChat[] | null>(null);
  useEffect(() => {
    if (section !== "stories" || allChats) return;
    let cancelled = false;
    void roleplayApi.listAllChats()
      .then((chats) => { if (!cancelled) setAllChats(chats); })
      .catch(() => { if (!cancelled) setAllChats([]); });
    return () => { cancelled = true; };
  }, [section, allChats]);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => { try { return localStorage.getItem("clyra-roleplay-sidebar") === "collapsed"; } catch { return false; } });

  useEffect(() => {
    void Promise.all([roleplayApi.listCharacters(), roleplayApi.listPersonas(), roleplayApi.listRecentChats()])
      .then(([characterList, personaList, chats]) => { setCharacters(characterList); setPersonas(personaList); setRecentChats(chats); })
      .catch((error) => setGenerateError(error instanceof Error ? error.message : "Roleplay could not load."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        setSidebarCollapsed((value) => !value);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => { try { localStorage.setItem("clyra-roleplay-sidebar", sidebarCollapsed ? "collapsed" : "expanded"); } catch { /* best effort */ } }, [sidebarCollapsed]);

  const filtered = useMemo(() => {
    let list = characters;
    if (tab === "favorites") list = list.filter((character) => character.favorite);
    if (tab === "new") list = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (tab === "worlds") list = list.filter((character) => character.tags.some((tag) => /world|fantasy|sci-fi|space|historical/i.test(tag)));
    if (search.trim()) { const needle = search.trim().toLowerCase(); list = list.filter((character) => [character.name, character.tagline, character.personality, ...character.tags].some((value) => value.toLowerCase().includes(needle))); }
    return list;
  }, [characters, search, tab]);

  const completeOnboarding = () => { setShowOnboarding(false); try { localStorage.setItem(ONBOARDING_STORAGE_KEY, "1"); } catch { /* best effort */ } };

  const toggleInterest = (interest: string) => setSelectedInterests((current) => current.includes(interest) ? current.filter((item) => item !== interest) : [...current, interest]);

  const buildOnboardingLibrary = async () => {
    const interests = [...selectedInterests, customInterest.trim()].filter(Boolean);
    if (!interests.length || onboardingBusy) return;
    setOnboardingBusy(true); setGenerateError("");
    try {
      const library = await roleplayApi.createOnboardingLibrary(interests);
      setCharacters(library);
      completeOnboarding();
    } catch (error) {
      setGenerateError(error instanceof Error ? error.message : "Couldn't prepare your starter library.");
    } finally {
      setOnboardingBusy(false);
    }
  };

  const runGenerate = async (requestedQuery = query, options?: { webResearch?: boolean; mode?: RoleplayMode }) => {
    if (!requestedQuery.trim()) return;
    setGenerating(true); setGenerateError("");
    try {
      const { character, avatarSearchQuery } = await roleplayApi.generateCharacter(requestedQuery.trim(), { webResearch: options?.webResearch ?? webResearch, mode: options?.mode ?? mode });
      setDraft(avatarDataUrl ? { ...character, avatarUrl: avatarDataUrl } : character);
      setDraftSources(character.generationSources); setView("review"); completeOnboarding();
      if (!avatarDataUrl) void roleplayApi.searchAvatars(avatarSearchQuery).then((results) => { if (results[0]) setDraft((current) => current.avatarUrl ? current : { ...current, avatarUrl: results[0].fullUrl, avatarSourceUrl: results[0].sourceUrl }); }).catch(() => undefined);
    } catch (error) { setGenerateError(error instanceof Error ? error.message : "Couldn't generate that character."); }
    finally { setGenerating(false); }
  };

  const openCharacter = async (character: RoleplayCharacter, requestedChat?: RoleplayChat) => {
    void roleplayApi.touchCharacter(character.id); setActiveCharacter(character);
    const chats = requestedChat ? [requestedChat] : await roleplayApi.listChats(character.id);
    const persona = personas[0] || (await roleplayApi.listPersonas())[0];
    const chat = chats[0] || await roleplayApi.createChat(character.id, persona?.id || "");
    setActiveChat(chat); setView("chat");
  };

  const saveDraft = async () => {
    setSaving(true);
    try {
      // A portrait chosen before the character existed is held inline as a data
      // URL, because there was no character to file it against yet. Save the
      // character first, then move the image onto disk where it belongs.
      const inlinePortrait = draft.avatarUrl.startsWith("data:") ? draft.avatarUrl : null;
      const body = inlinePortrait ? { ...draft, avatarUrl: "" } : draft;
      let saved = draft.id && characters.some((character) => character.id === draft.id)
        ? await roleplayApi.updateCharacter(draft.id, body)
        : await roleplayApi.createCharacter(body);
      if (inlinePortrait) {
        saved = await roleplayApi.uploadAvatar(saved.id, inlinePortrait).catch(() => saved);
      }
      setCharacters((current) => current.some((character) => character.id === saved.id) ? current.map((character) => character.id === saved.id ? saved : character) : [saved, ...current]);
      await openCharacter(saved);
    } finally { setSaving(false); }
  };

  const toggleFavorite = async (character: RoleplayCharacter) => { const updated = await roleplayApi.updateCharacter(character.id, { favorite: !character.favorite }); setCharacters((current) => current.map((item) => item.id === updated.id ? updated : item)); };

  if (view === "chat" && activeCharacter && activeChat) return <RoleplayChatView character={activeCharacter} chat={activeChat} personas={personas} onBack={() => setView("library")} onCharacterChange={(character) => { setActiveCharacter(character); setCharacters((current) => current.map((item) => item.id === character.id ? character : item)); }} onChatChange={setActiveChat} />;
  if (view === "create") return <RoleplayCreateFlow onBack={() => setView("library")} onManual={() => { setDraft(blankDraft()); setDraftSources([]); setView("edit"); }} onGenerate={(prompt, options) => { setQuery(prompt); setMode(options.mode); setWebResearch(options.webResearch); void runGenerate(prompt, options); }} />;
  if (view === "review" || view === "edit") return <div className="flex h-full min-h-0 flex-1 flex-col overflow-y-auto bg-[var(--clyra-color-background)] px-6 py-8"><RoleplayCharacterEditor draft={draft} sources={view === "review" ? draftSources : undefined} simple={view === "edit"} onChange={setDraft} onSave={saveDraft} onCancel={() => setView("library")} saving={saving} /></div>;

  if (showOnboarding) return <RoleplayOnboarding selected={selectedInterests} customInterest={customInterest} onToggle={toggleInterest} onCustomInterestChange={setCustomInterest} onContinue={() => void buildOnboardingLibrary()} busy={onboardingBusy} error={generateError} />;

  const recentWithCharacters = recentChats.flatMap((chat) => { const character = characters.find((item) => item.id === chat.characterId); return character ? [{ chat, character }] : []; });

  const storyEntries = (allChats ?? recentChats).flatMap((chat) => {
    const character = characters.find((item) => item.id === chat.characterId);
    return character ? [{ chat, character }] : [];
  });

  const deleteStory = async (chat: RoleplayChat) => {
    setAllChats((current) => current?.filter((item) => item.id !== chat.id) ?? current);
    setRecentChats((current) => current.filter((item) => item.id !== chat.id));
    await roleplayApi.deleteChat(chat.id).catch(() => {});
  };
  const tabs: Array<[DiscoverTab, string]> = [["for-you", "For You"], ["featured", "Featured"], ["worlds", "Worlds"], ["new", "New"], ["favorites", "Favorites"]];

  return (
    <div className={cn("rp-shell h-full min-h-0 flex-1", sidebarCollapsed && "is-collapsed")}>
      <aside className="rp-sidebar" aria-label="Roleplay navigation">
        <div className="rp-sidebar-brand"><span className="rp-brand-mark">C</span><span className="rp-sidebar-label"><strong>Clyra</strong><small>Roleplay</small></span><button type="button" onClick={() => setSidebarCollapsed((value) => !value)} className="rp-icon-button ml-auto" aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} title="Toggle sidebar (⌘B)">{sidebarCollapsed ? <Menu className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}</button></div>
        <nav className="mt-5 space-y-0.5">
          {([["home", "Home", Home], ["discover", "Discover", Compass], ["stories", "Stories", MessagesSquare], ["library", "Library", Library]] as const).map(([id, label, Icon]) => <button key={id} type="button" onClick={() => setSection(id)} className="rp-nav-item" data-active={section === id}><Icon className="h-4 w-4" /><span className="rp-sidebar-label">{label}</span></button>)}
        </nav>
        {recentWithCharacters.length ? <div className="mt-6 min-h-0 flex-1 overflow-hidden"><button type="button" onClick={() => setSection("stories")} className="rp-sidebar-eyebrow rp-sidebar-label w-full text-left transition-colors hover:text-[var(--clyra-color-label-secondary)]">Stories</button><div className="mt-1 space-y-0.5">{recentWithCharacters.slice(0, 5).map(({ chat, character }) => <button key={chat.id} type="button" onClick={() => void openCharacter(character, chat)} className="rp-story-nav"><RoleplayPortrait character={character} className="h-6 w-6 shrink-0 rounded-[8px]" initialsClassName="text-[9px]" /><span className="rp-sidebar-label min-w-0"><strong>{character.name}</strong><small>{relativeTime(chat.updatedAt)}</small></span></button>)}</div></div> : <div className="flex-1" />}
        <button type="button" onClick={() => setView("create")} className="rp-nav-item"><Plus className="h-4 w-4" /><span className="rp-sidebar-label">Create character</span></button>
      </aside>

      <main className="clyra-roleplay-library min-h-0 overflow-y-auto bg-[var(--rp-canvas)]">
        {section === "home" ? <>
          <RoleplayHero query={query} onQueryChange={setQuery} onGenerate={() => void runGenerate()} generating={generating} generateError={generateError} webResearch={webResearch} onWebResearchChange={setWebResearch} mode={mode} onModeChange={setMode} avatarDataUrl={avatarDataUrl} onAvatarDataUrlChange={setAvatarDataUrl} onManualCreate={() => setView("create")} />
          <div className="rp-page-frame pb-24 pt-2">
            <section className="mb-8"><div className="rp-section-heading"><h2>Continue your stories</h2>{recentWithCharacters.length ? <button type="button" onClick={() => setSection("stories")}>See all <ArrowRight /></button> : null}</div><div className="-mx-2 flex gap-2 overflow-x-auto px-2 pb-2">{loading ? Array.from({ length: 3 }).map((_, index) => <StoryTileSkeleton key={index} />) : recentWithCharacters.length ? recentWithCharacters.slice(0, 6).map(({ chat, character }) => <ContinueTile key={chat.id} chat={chat} character={character} onOpen={() => void openCharacter(character, chat)} />) : <button type="button" onClick={() => setSection("discover")} className="rp-story-empty h-[152px] w-[248px] shrink-0 rounded-[15px] text-left"><strong>Start your first story</strong><span>Choose a character to begin.</span><ArrowRight /></button>}</div></section>
            <section className="mb-8"><div className="rp-section-heading"><h2>For you</h2><button type="button" onClick={() => { setTab("featured"); setSection("discover"); }}>See all <ArrowRight /></button></div>{loading ? <div className="rp-character-grid">{Array.from({ length: 5 }).map((_, index) => <CharacterCardSkeleton key={index} />)}</div> : <div className="rp-character-grid">{characters.slice(0, 5).map((character) => <RoleplayCharacterCard key={character.id} character={character} onOpen={() => void openCharacter(character)} onToggleFavorite={() => void toggleFavorite(character)} />)}</div>}</section>
            <section><div className="rp-section-heading"><h2>Explore worlds</h2></div><div className="rp-world-strip">{WORLDS.slice(0, 6).map((world) => <button key={world.name} type="button" onClick={() => { setQuery(world.prompt); setMode("world"); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="rp-world-tile" data-world={world.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}><strong>{world.name}</strong><span>{world.detail}</span><ArrowRight /></button>)}</div></section>
          </div>
        </> : section === "stories" ? (
          <RoleplayStories
            entries={storyEntries}
            onOpen={({ chat, character }) => void openCharacter(character, chat)}
            onDelete={({ chat }) => void deleteStory(chat)}
          />
        ) : <div className="rp-page-frame pb-24 pt-10">
          <header className="mb-8"><p className="rp-page-kicker">Clyra Roleplay</p><h1 className="rp-page-title">{section === "discover" ? "Discover" : "Your library"}</h1><p className="rp-page-subtitle">{section === "discover" ? "Find characters, worlds and new stories." : "Characters and stories you have saved or created."}</p></header>
          <section><div className="rp-library-toolbar"><div className="rp-segmented">{tabs.map(([id, label]) => <button key={id} type="button" onClick={() => setTab(id)} data-active={tab === id}>{label}</button>)}</div><label className="rp-search"><Search /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search characters or worlds…" /></label></div><div className="rp-character-grid mt-6">{filtered.map((character) => <RoleplayCharacterCard key={character.id} character={character} onOpen={() => void openCharacter(character)} onToggleFavorite={() => void toggleFavorite(character)} />)}</div>{!loading && !filtered.length ? <div className="py-16 text-center"><Heart className="mx-auto h-5 w-5 text-[var(--rp-text-tertiary)]" /><p className="mt-2 text-[13px] font-medium text-[var(--rp-text-secondary)]">No characters match this view yet.</p><button type="button" onClick={() => { setTab("for-you"); setSearch(""); }} className="mt-2 text-[12px] font-semibold text-[var(--rp-accent)]">Show the full library</button></div> : null}</section>
          {section === "library" && recentWithCharacters.length ? <section className="mt-12"><div className="rp-section-heading"><h2>Stories</h2><button type="button" onClick={() => setSection("stories")}>See all <ArrowRight /></button></div><div className="grid gap-1 md:grid-cols-2">{recentWithCharacters.map(({ chat, character }) => <ContinueTile key={chat.id} chat={chat} character={character} onOpen={() => void openCharacter(character, chat)} />)}</div></section> : null}
        </div>}
      </main>
    </div>
  );
}

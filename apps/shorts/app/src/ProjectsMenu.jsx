import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, LayoutGrid, List, FolderPlus, Plus, MoreHorizontal, Folder, FolderOpen, ChevronLeft, SlidersHorizontal, Film, MessagesSquare, MessageSquareQuote, Scale, Clapperboard, Scissors, Wand2, Check, X, SearchX, FolderInput, Sparkles, Mic, Image as ImageIcon, Wrench, Search as FindIcon } from 'lucide-react';
import './projects-menu.css';

/* Projects, for every tool: the layout of the advanced editor's projects menu (search, sort, grid or list, folders,
   a ⋯ menu per project). Folders are made here and kept on this device; drag a project onto a folder to file it,
   drag folders to reorder them. Advanced editor projects come from the editor's own project folders. */
const KEY = 'shorts-project-folders';
const loadFolders = () => { try { return JSON.parse(localStorage.getItem(KEY)) ?? { folders: [], assign: {} }; } catch { return { folders: [], assign: {} }; } };
const saveFolders = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* preference only */ } };
/* every tool that makes a video, in the order the filter shows them: how a project says it came from one (the page it was
   made on, or its name for the older ones) */
const TOOLS = [
  { id: 'autoclip', name: 'AutoClip', Icon: Scissors, color: '#14a37f', test: (p) => /\/create\/auto-clip/.test(p.tool) },
  { id: 'advanced', name: 'Advanced editor', Icon: Clapperboard, color: '#4568ee', test: (p) => /\/editor/.test(p.tool) },
  { id: 'text', name: 'Fake text', Icon: MessagesSquare, color: '#0a84ff', test: (p) => /text-video/.test(p.tool) || (!p.tool && /text|chat/i.test(p.name)) },
  { id: 'wyr', name: 'Would you rather', Icon: Scale, color: '#e8443a', test: (p) => /would-you-rather/.test(p.tool) || /rather/i.test(p.name) },
  { id: 'moments', name: 'Find moments', Icon: FindIcon, color: '#8a5cf6', test: (p) => /find-moments|clip-cutter/.test(p.tool) },
  { id: 'aiedit', name: 'AI video editor', Icon: Wand2, color: '#d9528f', test: (p) => /ai-edit/.test(p.tool) },
  { id: 'voice', name: 'Voiceovers', Icon: Mic, color: '#e0852b', test: (p) => /voiceover/.test(p.tool) },
  { id: 'images', name: 'AI images', Icon: ImageIcon, color: '#2aa6c9', test: (p) => /\/tools\/(images|icon)/.test(p.tool) },
  { id: 'free', name: 'Free tools', Icon: Wrench, color: '#6b7a99', test: (p) => /\/tools\/free/.test(p.tool) },
  { id: 'reddit', name: 'Reddit', Icon: MessageSquareQuote, color: '#ff5a1f', legacy: true, test: (p) => /reddit/.test(p.tool) || /reddit/i.test(p.name) },
];
const OTHER = { id: 'other', name: 'Other', Icon: Sparkles, color: '#6b7280' };
const kindOf = (p) => TOOLS.find((t) => t.test({ ...p, tool: p.tool || '' })) ?? OTHER;
const toolOf = (p) => { const k = kindOf(p); return [k.name, k.Icon, k.color]; };
const clock = (seconds) => { const s = Math.max(0, Math.round(seconds)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`; };
const SORTS = ['Last updated', 'Name', 'Tool'];

export default function ProjectsMenu({ projects, setProjects, go, onCreate }) {
  const [advanced, setAdvanced] = useState([]);
  const [store, setStore] = useState(loadFolders);
  const [view, setView] = useState(() => localStorage.getItem('shorts-projects-view') || 'grid');
  const [q, setQ] = useState(''), [sort, setSort] = useState('Last updated'), [sortOpen, setSortOpen] = useState(false);
  const [folder, setFolder] = useState(null), [menu, setMenu] = useState(null), [renaming, setRenaming] = useState(null);
  const [dragOver, setDragOver] = useState(null), [dragFolder, setDragFolder] = useState(null);
  const [kind, setKind] = useState('all'), [hover, setHover] = useState(null);
  useEffect(() => { fetch('/api/advanced/projects').then((r) => r.ok ? r.json() : { projects: [] }).then((d) => setAdvanced(d.projects || [])).catch(() => {}); }, []);
  useEffect(() => saveFolders(store), [store]);
  useEffect(() => { try { localStorage.setItem('shorts-projects-view', view); } catch { /* */ } }, [view]);
  useEffect(() => { const close = () => { setMenu(null); setSortOpen(false); }; window.addEventListener('click', close); return () => window.removeEventListener('click', close); }, []);

  const all = useMemo(() => [
    ...projects.map((p) => ({ ...p, key: `p:${p.id}`, modified: Number(p.id) || 0 })),
    ...advanced.map((a) => ({ key: `a:${a.name}`, id: a.name, name: a.name, tool: '/editor/advanced', created: new Date(a.modified).toLocaleDateString(), modified: a.modified, advanced: true, duration: a.duration, video: a.preview ? `/api/advanced/preview?name=${encodeURIComponent(a.name)}` : null, thumb: a.poster ? `/api/advanced/poster?name=${encodeURIComponent(a.name)}&v=${Math.round(a.modified)}` : null })),
  ], [projects, advanced]);
  const inFolder = (p) => store.assign[p.key] ?? null;
  const counts = useMemo(() => { const c = {}; for (const p of all) { const id = kindOf(p).id; c[id] = (c[id] || 0) + 1; } return c; }, [all]);
  const chips = [...TOOLS.filter((t) => !t.legacy || counts[t.id]), ...(counts.other ? [OTHER] : [])];
  const shown = all.filter((p) => (kind === 'all' || kindOf(p).id === kind) && (folder ? inFolder(p) === folder : q || kind !== 'all' ? true : !inFolder(p)) && p.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => sort === 'Name' ? a.name.localeCompare(b.name) : sort === 'Tool' ? toolOf(a)[0].localeCompare(toolOf(b)[0]) : b.modified - a.modified);
  const folders = store.folders;
  const current = folders.find((f) => f.id === folder);

  const newFolder = () => { const id = `f${Date.now().toString(36)}`; setStore((s) => ({ ...s, folders: [...s.folders, { id, name: 'New folder', created: new Date().toLocaleDateString() }] })); setRenaming({ kind: 'folder', id }); };
  const fileInto = (key, fid) => setStore((s) => ({ ...s, assign: { ...s.assign, [key]: fid } }));
  const rename = (kind, id, name) => {
    const clean = name.trim(); setRenaming(null); if (!clean) return;
    if (kind === 'folder') setStore((s) => ({ ...s, folders: s.folders.map((f) => (f.id === id ? { ...f, name: clean } : f)) }));
    else setProjects((v) => v.map((p) => (`p:${p.id}` === id ? { ...p, name: clean } : p)));
  };
  const removeFolder = (id) => setStore((s) => ({ folders: s.folders.filter((f) => f.id !== id), assign: Object.fromEntries(Object.entries(s.assign).filter(([, v]) => v !== id)) }));
  const removeProject = (p) => { if (!p.advanced) setProjects((v) => v.filter((x) => `p:${x.id}` !== p.key)); setStore((s) => { const a = { ...s.assign }; delete a[p.key]; return { ...s, assign: a }; }); };
  const open = (p) => go(p.advanced ? `/editor/advanced?name=${encodeURIComponent(p.name)}` : (p.tool || '/projects'));
  const moveFolder = (fromId, toId) => setStore((s) => { const list = [...s.folders]; const a = list.findIndex((f) => f.id === fromId), b = list.findIndex((f) => f.id === toId); if (a < 0 || b < 0) return s; const [it] = list.splice(a, 1); list.splice(b, 0, it); return { ...s, folders: list }; });

  const ProjectMenu = ({ p }) => (
    <div className="pm-menu" onClick={(e) => e.stopPropagation()}>
      <button onClick={() => { setMenu(null); open(p); }}>Open</button>
      {!p.advanced ? <button onClick={() => { setMenu(null); setRenaming({ kind: 'project', id: p.key }); }}>Rename</button> : null}
      <div className="pm-menu-sub"><small>Move to</small>
        {inFolder(p) ? <button onClick={() => { setMenu(null); fileInto(p.key, null); }}><FolderInput size={13} />No folder</button> : null}
        {folders.filter((f) => f.id !== inFolder(p)).map((f) => <button key={f.id} onClick={() => { setMenu(null); fileInto(p.key, f.id); }}><Folder size={13} />{f.name}</button>)}
        {!folders.length ? <button onClick={() => { setMenu(null); newFolder(); }}><FolderPlus size={13} />New folder</button> : null}
      </div>
      {!p.advanced ? <button className="danger" onClick={() => { setMenu(null); removeProject(p); }}>Delete</button> : null}
    </div>
  );
  const Name = ({ kind, id, value }) => renaming?.kind === kind && renaming.id === id
    ? <input autoFocus className="pm-rename" defaultValue={value} onFocus={(e) => e.currentTarget.select()} onClick={(e) => e.stopPropagation()} onBlur={(e) => rename(kind, id, e.target.value)}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenaming(null); }} />
    : <strong>{value}</strong>;

  return (
    <div className="pm-root">
      <header className="pm-head">
        <div className="pm-title">
          {current ? <button className={`pm-back ${dragOver === 'root' ? 'over' : ''}`} onClick={() => setFolder(null)} title="Drop a project here to take it out of this folder"
            onDragOver={(e) => { e.preventDefault(); setDragOver('root'); }} onDragLeave={() => setDragOver(null)}
            onDrop={(e) => { e.preventDefault(); setDragOver(null); const pk = e.dataTransfer.getData('text/shorts-project'); if (pk) fileInto(pk, null); }}><ChevronLeft size={18} />Projects</button> : <h2>Projects</h2>}
          {current ? <h2 className="pm-folder-title"><FolderOpen size={18} />{current.name}</h2> : null}
        </div>
        <div className="pm-tools">
          <label className="pm-search"><Search size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search projects" />{q ? <button onClick={() => setQ('')} aria-label="Clear"><X size={13} /></button> : null}</label>
          <div className="pm-sort-wrap">
            <button className={`pm-icon ${sortOpen ? 'on' : ''}`} aria-label="Sort" onClick={(e) => { e.stopPropagation(); setSortOpen((v) => !v); }}><SlidersHorizontal size={16} /></button>
            {sortOpen ? <div className="pm-menu pm-sort" onClick={(e) => e.stopPropagation()}>{SORTS.map((s) => <button key={s} onClick={() => { setSort(s); setSortOpen(false); }}>{s}{sort === s ? <Check size={13} /> : null}</button>)}</div> : null}
          </div>
          <div className="pm-seg">
            <button className={view === 'grid' ? 'on' : ''} aria-label="Grid" onClick={() => setView('grid')}><LayoutGrid size={15} /></button>
            <button className={view === 'list' ? 'on' : ''} aria-label="List" onClick={() => setView('list')}><List size={15} /></button>
          </div>
          <button className="pm-icon" aria-label="New folder" title="New folder" onClick={newFolder}><FolderPlus size={16} /></button>
        </div>
      </header>

      <div className="pm-filters" role="group" aria-label="Filter by tool">
        <button type="button" aria-pressed={kind === 'all'} className={kind === 'all' ? 'on' : ''} onClick={() => setKind('all')}>All<small>{all.length}</small></button>
        {chips.map(({ id, name, Icon, color }) => <button key={id} type="button" aria-pressed={kind === id} className={`${kind === id ? 'on' : ''}${counts[id] ? '' : ' none'}`} style={{ '--tool': color }} onClick={() => setKind(kind === id ? 'all' : id)}><Icon size={13} strokeWidth={2} />{name}<small>{counts[id] || 0}</small></button>)}
      </div>

      <section className={`pm-items ${view}`} aria-label="Projects">
        {!current && kind === 'all' && view === 'grid' ? (
          <button className="pm-new" onClick={onCreate}><span><Plus size={18} /></span>New project</button>
        ) : null}
        {/* folders as the editor's projects list has them: a card like a project's, its face the covers of what it holds */}
        {!current && !q && kind === 'all' ? folders.map((f) => {
          const inside = all.filter((p) => inFolder(p) === f.id).sort((x, y) => y.modified - x.modified);
          const covers = inside.slice(0, 4);
          return (
            <article key={f.id} draggable className={`pm-card pm-folder-card ${dragOver === f.id ? 'over' : ''} ${dragFolder === f.id ? 'lifting' : ''}`}
              onDragStart={(e) => { setDragFolder(f.id); e.dataTransfer.setData('text/shorts-folder', f.id); e.dataTransfer.effectAllowed = 'move'; }}
              onDragEnd={() => { setDragFolder(null); setDragOver(null); }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(f.id); }} onDragLeave={() => setDragOver((v) => (v === f.id ? null : v))}
              onDrop={(e) => { e.preventDefault(); setDragOver(null); const pk = e.dataTransfer.getData('text/shorts-project'), fk = e.dataTransfer.getData('text/shorts-folder'); if (pk) fileInto(pk, f.id); else if (fk && fk !== f.id) moveFolder(fk, f.id); }}>
              <button className="pm-folder-face" onClick={() => setFolder(f.id)} aria-label={`Open ${f.name}`}>
                {covers.length ? (
                  <span className={`pm-covers n${Math.min(4, covers.length)}`}>
                    {covers.map((p) => { const [, Icon, color] = toolOf(p); return <span key={p.key} className="pm-cover" style={{ '--tool': color }}>{p.thumb ? <img src={p.thumb} alt="" loading="lazy" /> : <Icon size={16} strokeWidth={1.7} />}</span>; })}
                  </span>
                ) : <FolderGlyph />}
                <span className={`pm-count ${covers.length ? 'glass' : ''}`}>{inside.length}</span>
              </button>
              <div className="pm-meta">
                <div className="pm-name"><Name kind="folder" id={f.id} value={f.name} />
                  <button className="pm-dots" aria-label={`${f.name} options`} onClick={(e) => { e.stopPropagation(); setMenu(menu === `f:${f.id}` ? null : `f:${f.id}`); }}><MoreHorizontal size={16} /></button>
                  {menu === `f:${f.id}` ? <div className="pm-menu" onClick={(e) => e.stopPropagation()}><button onClick={() => { setMenu(null); setFolder(f.id); }}><FolderOpen size={13} />Open</button><button onClick={() => { setMenu(null); setRenaming({ kind: 'folder', id: f.id }); }}>Rename</button><button className="danger" onClick={() => { setMenu(null); removeFolder(f.id); }}>Delete folder</button></div> : null}
                </div>
                <small><Folder size={12} />Folder · {f.created || 'Today'}</small>
              </div>
            </article>
          );
        }) : null}
        {shown.map((p) => {
          const [toolName, Icon, color] = toolOf(p);
          return (
            <article key={p.key} className="pm-card" draggable onDragStart={(e) => { e.dataTransfer.setData('text/shorts-project', p.key); e.dataTransfer.effectAllowed = 'move'; }}
              onDoubleClick={() => open(p)}>
              <button className={`pm-thumb ${p.thumb ? 'has-img' : ''}${hover === p.key ? ' is-playing' : ''}`} style={{ '--tool': color }} onClick={() => open(p)} aria-label={`Open ${p.name}`}
                onMouseEnter={() => p.video && setHover(p.key)} onMouseLeave={() => setHover((v) => (v === p.key ? null : v))} onFocus={() => p.video && setHover(p.key)} onBlur={() => setHover((v) => (v === p.key ? null : v))}>
                {p.thumb ? <><img className="pm-thumb-bg" src={p.thumb} alt="" aria-hidden="true" /><img className="pm-thumb-img" src={p.thumb} alt="" loading="lazy" onError={(e) => { e.currentTarget.closest('.pm-thumb')?.classList.remove('has-img'); }} />
                  <span className="pm-thumb-badge"><Icon size={12} strokeWidth={2} /></span></> : null}
                <Icon className="pm-thumb-icon" size={view === 'grid' ? 30 : 18} strokeWidth={1.6} />
                {hover === p.key && p.video ? <video className="pm-thumb-video" src={p.video} muted loop playsInline autoPlay preload="auto" aria-hidden="true" onPlaying={(e) => e.currentTarget.classList.add('ready')} /> : null}
                {p.duration ? <span className="pm-thumb-time">{clock(p.duration)}</span> : null}
              </button>
              <div className="pm-meta">
                <div className="pm-name"><Name kind="project" id={p.key} value={p.name} />
                  <button className="pm-dots" aria-label={`${p.name} options`} onClick={(e) => { e.stopPropagation(); setMenu(menu === p.key ? null : p.key); }}><MoreHorizontal size={16} /></button>
                  {menu === p.key ? <ProjectMenu p={p} /> : null}
                </div>
                <small><Film size={12} />{toolName} · {p.created}</small>
              </div>
            </article>
          );
        })}
        {!shown.length && !(folders.length && !current && !q) ? (
          q ? <Empty icon={SearchX} title="No matches" text={`Nothing here is called “${q}”.`} action={<button className="pm-empty-btn" onClick={() => setQ('')}>Clear search</button>} />
            : current ? <Empty icon={FolderOpen} title="This folder is empty" text="Drag a project onto the folder, or use a project’s ⋯ menu → Move to." action={<button className="pm-empty-btn" onClick={() => setFolder(null)}><ChevronLeft size={14} />All projects</button>} />
              : <Empty icon={Film} title="No projects yet" text="Every video you make, with any tool, shows up here." action={<button className="pm-empty-btn primary" onClick={onCreate}><Plus size={14} />New project</button>} />
        ) : null}
      </section>
    </div>
  );
}

function Empty({ icon: Icon, title, text, action }) {
  return (
    <div className="pm-empty">
      <span className="pm-empty-icon"><Icon size={22} strokeWidth={1.7} /></span>
      <strong>{title}</strong>
      <p>{text}</p>
      {action}
    </div>
  );
}

/* the folder picture of the editor's projects list (an empty folder's face) */
function FolderGlyph() {
  return (
    <svg viewBox="0 0 72 56" aria-hidden="true" className="pm-folder-glyph">
      <defs><linearGradient id="pm-folder-front" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#dfe6ff" /><stop offset="0.18" stopColor="#c9d5fd" /><stop offset="1" stopColor="#c9d5fd" /></linearGradient></defs>
      <path d="M2 12c0-3.3 2.7-6 6-6h16.6c1.6 0 3.1.6 4.2 1.8l3.4 3.4c.8.8 1.9 1.2 3 1.2H64c3.3 0 6 2.7 6 6V48c0 3.3-2.7 6-6 6H8c-3.3 0-6-2.7-6-6Z" fill="#a9baf7" />
      <rect x="2" y="20" width="68" height="34" rx="6" fill="url(#pm-folder-front)" />
    </svg>
  );
}

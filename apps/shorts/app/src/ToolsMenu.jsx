import React, { useMemo, useState } from 'react';
import { ArrowUpRight, Search, X } from 'lucide-react';
import './tools-menu.css';

/* Tools: every tool that makes or prepares a video, centred on one page that fits a 1080p screen without scrolling. The
   groups name what a tool is for; search narrows all of them at once. `groups` is [{ id, title, hint, cols, items:
   [{ name, description, path, Icon, hue, action? }] }] from main.jsx, so a tool is added in one place. */
export default function ToolsMenu({ go, groups }) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const shown = useMemo(() => groups.map((g) => ({ ...g, items: g.items.filter((t) => !needle || `${t.name} ${t.description} ${t.action || ''}`.toLowerCase().includes(needle)) })).filter((g) => g.items.length), [groups, needle]);
  const count = shown.reduce((n, g) => n + g.items.length, 0);
  return <div className="tm-root">
    <header className="tm-head">
      <div><h2>Tools</h2><p>Everything for making and preparing a video, in one place.</p></div>
      <label className="tm-search"><Search size={15} aria-hidden/><input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tools" aria-label="Search tools"/>{query && <button type="button" aria-label="Clear search" onClick={() => setQuery('')}><X size={13}/></button>}</label>
    </header>
    {shown.map((group) => <section key={group.id} className={`tm-group tm-${group.id}`} aria-label={group.title}>
      <div className="tm-group-head"><h3>{group.title}</h3>{group.hint && <span>{group.hint}</span>}</div>
      <div className={`tm-grid cols-${group.cols || 4}`}>
        {group.items.map((tool, i) => <a key={tool.path} href={tool.path} className={`tm-card${group.compact ? ' is-compact' : ''}`} style={{ '--hue': tool.hue, '--i': i }} onClick={(e) => { e.preventDefault(); go(tool.path); }}>
          <span className="tm-icon" aria-hidden><tool.Icon size={group.compact ? 17 : 21} strokeWidth={1.8}/></span>
          <span className="tm-text"><strong>{tool.name}</strong><small>{group.compact ? tool.action || tool.description : tool.description}</small></span>
          <ArrowUpRight className="tm-arrow" size={15} aria-hidden/>
        </a>)}
      </div>
    </section>)}
    {!count && <div className="tm-empty" role="status"><Search size={20}/><strong>No tool matches “{query}”</strong><button type="button" onClick={() => setQuery('')}>Clear search</button></div>}
  </div>;
}

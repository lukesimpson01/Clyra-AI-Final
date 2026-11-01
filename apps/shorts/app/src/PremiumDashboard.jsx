import React,{useMemo,useState} from 'react';
import {ArrowRight,Search,Sparkles,SlidersHorizontal,Film,Scissors,Volume2,WandSparkles,CornerDownLeft} from 'lucide-react';
import './premium-dashboard.css';
import './home-rail.css';
import QueuePanel from './QueuePanel.jsx';
import {putHandoff} from './handoff.js';

const art={
  AutoClip:'autoclip.webp','Find viral moments':'find-moments.webp','AI Video Editor':'ai-edit.webp',
  'Advanced Editor':'advanced-editor-reference.png','Fake Texts Video Generator':'fake-text.png',
  'Would You Rather Video':'would-you-rather-01.jpg',
  
  'AI Brainstormer':'ai-brainstorm.png','YouTube Downloader':'youtube-downloader.webp',
  'TikTok Downloader':'gameplay-subway.webp','Clip Cutter':'editor.webp'
};
const categories=[['Make videos',['AutoClip','Fake Texts Video Generator','Would You Rather Video','Advanced Editor']],['Ideas',['AI Brainstormer']],['Download & prepare',['YouTube Downloader','TikTok Downloader']],['Free media tools',[]]];
export default function PremiumDashboard({go,items}){
 const[query,setQuery]=useState('');
 const filtered=useMemo(()=>items.filter(t=>(t.name+' '+t.description).toLowerCase().includes(query.toLowerCase())),[items,query]);
 const free=filtered.filter(t=>t.path.startsWith('/tools/free/'));
 const open=(event,path)=>{event.preventDefault();go(path)};
 const card=(item,compact=false)=><a className={'pd-card '+(compact?'pd-card-compact':'')} key={item.path} href={item.path} onClick={e=>open(e,item.path)}><span className="pd-art">{art[item.name]?<img src={'/images/'+art[item.name]} alt="" loading="lazy"/>:<span className="pd-art-fallback">{item.name.includes('Video')?<Film size={29}/>:item.name.includes('Audio')||item.name.includes('MP3')?<Volume2 size={29}/>:item.name.includes('Trim')||item.name.includes('Cut')?<Scissors size={29}/>:<SlidersHorizontal size={29}/>}</span>}</span><span className="pd-card-text"><strong>{item.name}</strong><small>{item.description}</small></span><ArrowRight className="pd-card-arrow" size={16}/></a>;
 const ask=text=>{const q=text.trim();if(q)putHandoff('brainstorm',{prompt:q});go('/tools/brainstorm')};
 return <div className="pd-layout"><div className="pd-root pd-main"><section className="pd-hero"><div className="pd-hero-copy"><span className="pd-eyebrow"><Sparkles size={14}/> Your creative workspace</span><h2>Make the next<br/><em>great video.</em></h2><p>Clip, edit and prepare your next post, and let the queue make videos for you in the background.</p><div className="pd-hero-actions"><button className="pd-primary" onClick={()=>go('/create/auto-clip')}>Start with AutoClip <ArrowRight size={17}/></button><button className="pd-secondary" onClick={()=>go('/editor/advanced')}>Open Advanced Editor</button></div></div><div className="pd-hero-visual" aria-hidden="true"><img src="/images/autoclip.webp" alt=""/><div className="pd-hero-float"><span>01</span><strong>Clip your best moments</strong><small>Preview · refine · publish</small></div></div></section><div className="pd-heading"><div><span className="pd-kicker">EXPLORE YOUR STUDIO</span><h2>Every tool, ready when you are.</h2></div><label className="pd-search"><Search size={17}/><input type="search" placeholder="Search all tools" aria-label="Search all tools" value={query} onChange={e=>setQuery(e.target.value)}/></label></div>{categories.map(([label,names])=>{const group=label==='Free media tools'?free:names.map(name=>filtered.find(t=>t.name===name)).filter(Boolean);return group.length?<section className="pd-section" key={label}><div className="pd-section-head"><h3>{label}</h3><span>{group.length} tools</span></div><div className={'pd-grid '+(label==='Free media tools'?'pd-free':'')}>{group.map(t=>card(t,label==='Free media tools'))}</div></section>:null})}{filtered.length===0&&<div className="pd-empty">No tools match “{query}”. Try another search.</div>}</div><div className="pd-rail"><AskCard onAsk={ask}/><QueuePanel go={go}/></div></div>
}

/* the brainstormer, one line away: what you type opens the chat with it already sent */
function AskCard({onAsk}){
 const[text,setText]=useState('');
 const chips=['A fake text story about a haunted group chat','Clips from a YouTube video','Would you rather ideas for a sports page'];
 return <section className="pd-ask" aria-label="Brainstorm with AI"><div className="pd-ask-head"><span><WandSparkles size={15}/></span><div><b>Brainstorm with AI</b><small>Plan a video, then have it made for you.</small></div></div>
  <form onSubmit={e=>{e.preventDefault();onAsk(text)}}><textarea rows={2} value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();onAsk(text)}}} placeholder="What should we make today?" aria-label="What should we make today?"/><button type="submit" aria-label="Open the brainstormer"><CornerDownLeft size={15}/></button></form>
  <div className="pd-ask-chips">{chips.map(c=><button key={c} type="button" onClick={()=>onAsk(c)}>{c}</button>)}</div></section>
}

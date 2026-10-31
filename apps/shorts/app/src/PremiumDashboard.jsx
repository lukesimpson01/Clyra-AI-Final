import React,{useMemo,useState} from 'react';
import {ArrowRight,Search,Sparkles,SlidersHorizontal,Film,Scissors,Volume2} from 'lucide-react';
import './premium-dashboard.css';

const art={
  AutoClip:'autoclip.webp','Find viral moments':'find-moments.webp','AI Video Editor':'ai-edit.webp',
  'Advanced Editor':'advanced-editor-reference.png','Fake Texts Video Generator':'fake-text.png',
  'Reddit Video Generator':'reddit-video.png','Would You Rather Video':'would-you-rather-01.jpg','AI Image Generator':'ai-image.png',
  'Icon Generator':'icon-generator.png','AI Voiceover Generator':'ai-voiceover.png',
  'AI Brainstormer':'ai-brainstorm.png','YouTube Downloader':'youtube-downloader.webp',
  'TikTok Downloader':'gameplay-subway.webp','Clip Cutter':'editor.webp'
};
const categories=[['Featured',['AutoClip','Advanced Editor','Fake Texts Video Generator','Would You Rather Video','AI Video Editor','Find viral moments','Clip Cutter']],['Create & design',['Reddit Video Generator','AI Image Generator','Icon Generator','AI Voiceover Generator','AI Brainstormer']],['Download & prepare',['YouTube Downloader','TikTok Downloader']],['Free media tools',[]]];
export default function PremiumDashboard({go,items}){
 const[query,setQuery]=useState('');
 const filtered=useMemo(()=>items.filter(t=>(t.name+' '+t.description).toLowerCase().includes(query.toLowerCase())),[items,query]);
 const free=filtered.filter(t=>t.path.startsWith('/tools/free/'));
 const open=(event,path)=>{event.preventDefault();go(path)};
 const card=(item,compact=false)=><a className={'pd-card '+(compact?'pd-card-compact':'')} key={item.path} href={item.path} onClick={e=>open(e,item.path)}><span className="pd-art">{art[item.name]?<img src={'/images/'+art[item.name]} alt="" loading="lazy"/>:<span className="pd-art-fallback">{item.name.includes('Video')?<Film size={29}/>:item.name.includes('Audio')||item.name.includes('MP3')?<Volume2 size={29}/>:item.name.includes('Trim')||item.name.includes('Cut')?<Scissors size={29}/>:<SlidersHorizontal size={29}/>}</span>}</span><span className="pd-card-text"><strong>{item.name}</strong><small>{item.description}</small></span><ArrowRight className="pd-card-arrow" size={16}/></a>;
 return <div className="pd-root"><section className="pd-hero"><div className="pd-hero-copy"><span className="pd-eyebrow"><Sparkles size={14}/> Your creative workspace</span><h2>Make the next<br/><em>great video.</em></h2><p>Everything you need to clip, edit, design and prepare your next post—all in one workspace.</p><div className="pd-hero-actions"><button className="pd-primary" onClick={()=>go('/create/auto-clip')}>Start with AutoClip <ArrowRight size={17}/></button><button className="pd-secondary" onClick={()=>go('/editor/advanced')}>Open Advanced Editor</button></div></div><div className="pd-hero-visual" aria-hidden="true"><img src="/images/autoclip.webp" alt=""/><div className="pd-hero-float"><span>01</span><strong>Clip your best moments</strong><small>Preview · refine · publish</small></div></div></section><div className="pd-heading"><div><span className="pd-kicker">EXPLORE YOUR STUDIO</span><h2>Every tool, ready when you are.</h2></div><label className="pd-search"><Search size={17}/><input type="search" placeholder="Search all tools" aria-label="Search all tools" value={query} onChange={e=>setQuery(e.target.value)}/></label></div>{categories.map(([label,names])=>{const group=label==='Free media tools'?free:names.map(name=>filtered.find(t=>t.name===name)).filter(Boolean);return group.length?<section className="pd-section" key={label}><div className="pd-section-head"><h3>{label}</h3><span>{group.length} tools</span></div><div className={'pd-grid '+(label==='Free media tools'?'pd-free':'')}>{group.map(t=>card(t,label==='Free media tools'))}</div></section>:null})}{filtered.length===0&&<div className="pd-empty">No tools match “{query}”. Try another search.</div>}</div>
}

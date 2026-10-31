import React,{useEffect,useRef,useState} from 'react';
import {Pause,Play,Video} from 'lucide-react';
import './imessage-preview.css';

const palettes=[
  {panel:'#000',header:'#1c1c1e',incoming:'#2c2c2e',outgoing:'#0a84ff',text:'#fff',outText:'#fff'},
  {panel:'#fff',header:'#f6f6f8',incoming:'#e9e9eb',outgoing:'#1f84ff',text:'#0b0b0d',outText:'#fff'},
  {panel:'#000',header:'#1c1c1e',incoming:'#2c2c2e',outgoing:'#0a84ff',text:'#fff',outText:'#fff'},
  {panel:'#fff',header:'#f6f6f8',incoming:'#e9e9eb',outgoing:'#1f84ff',text:'#0b0b0d',outText:'#fff'},
  {panel:'#0d0d15',header:'#171722',incoming:'#383340',outgoing:'#8b55fa',text:'#fff',outText:'#fff'},
  {panel:'#fff',header:'#f6f6f8',incoming:'#e9e9eb',outgoing:'#4a9ff0',text:'#0b0b0d',outText:'#fff'}
];
const initials=name=>name.trim().split(/\s+/).slice(0,2).map(part=>part[0]||'').join('').toUpperCase()||'?';
const format=s=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;

export default function ImessagePreview({name,messages,theme=3,avatar,gameplayId}){
  const[time,setTime]=useState(0),[playing,setPlaying]=useState(false),last=useRef(0);
  const duration=Math.max(2,messages.length*2),palette=palettes[theme]||palettes[3];
  useEffect(()=>{setTime(0);setPlaying(false)},[messages.length]);
  useEffect(()=>{if(!playing)return;let frame;last.current=performance.now();const tick=now=>{const delta=(now-last.current)/1000;last.current=now;setTime(value=>{const next=value+delta;if(next>=duration){setPlaying(false);return duration}return next});frame=requestAnimationFrame(tick)};frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame)},[playing,duration]);
  const count=Math.min(messages.length,Math.floor((time+1)/2));
  const visible=messages.slice(Math.max(0,count-4),count),activeIndex=Math.min(messages.length-1,Math.floor(time/2));
  const typing=messages.length>0&&activeIndex>=count&&time<duration;
  const colorVars={'--im-panel':palette.panel,'--im-header':palette.header,'--im-incoming':palette.incoming,'--im-outgoing':palette.outgoing,'--im-text':palette.text,'--im-out-text':palette.outText};
  return <div className="im-preview">
    <div className="im-stage" style={colorVars}>
      <img className="im-gameplay" src={`/images/gameplay/${gameplayId}.gif`} alt="Selected gameplay background"/>
      <div className="im-chat">
        <div className="im-header"><span className="im-back">‹</span><div className="im-contact"><span className="im-avatar">{avatar?<img src={avatar} alt=""/>:initials(name||'Name')}</span><strong>{name||'Name'} <span>›</span></strong></div><Video size={18}/></div>
        <div className="im-messages">{visible.map(([side,message],i)=>{const before=visible[i-1],after=visible[i+1],first=!before||before[0]!==side,lastBubble=!after||after[0]!==side;return <div key={`${count-visible.length+i}-${message}`} className={`im-bubble ${side==='right'?'out':'in'} ${first?'first':''} ${lastBubble?'last':''}`}>{message||'...'}{lastBubble&&<span className="im-tail"/>}{side==='right'&&i===visible.length-1&&<small>Read</small>}</div>})}{typing&&<div className={`im-bubble im-typing ${messages[activeIndex]?.[0]==='right'?'out':'in'}`}><i/><i/><i/><span className="im-tail"/></div>}</div>
      </div>
      {!playing&&time<duration&&<button className="im-overlay-play" aria-label="Play message preview" onClick={()=>setPlaying(true)}><Play size={18} fill="currentColor"/></button>}
    </div>
    <div className="im-controls"><button aria-label={playing?'Pause message preview':'Play message preview'} onClick={()=>{if(time>=duration)setTime(0);setPlaying(!playing)}}>{playing?<Pause size={15}/>:<Play size={15}/>}</button><span>{format(time)} / {format(duration)}</span><input aria-label="Scrub message preview" type="range" min="0" max={duration} step="0.01" value={time} onChange={e=>{setPlaying(false);setTime(Number(e.target.value))}}/></div>
  </div>;
}

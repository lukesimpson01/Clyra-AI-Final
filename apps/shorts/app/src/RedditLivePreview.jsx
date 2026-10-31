import React,{useEffect,useRef,useState} from 'react';
import {Maximize,Pause,Play,X,ArrowBigUp,MessageCircle} from 'lucide-react';
import './reddit-live-preview.css';

const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
export const REDDIT_SLOT=5;
export const redditDuration=posts=>Math.max(REDDIT_SLOT,posts.length*REDDIT_SLOT);
const ease=x=>1-Math.pow(1-x,3);

/* The Reddit story as it plays: one post card per 5 s slot over the gameplay, its words revealed as they are read.
   `renderOnly` (the MP4 export) shows the phone alone and is driven by `time`; the card's entrance is then a pure
   function of time instead of a CSS animation, so every frame is exact. */
export default function RedditLivePreview({posts,videoUrl,posterUrl,dark=false,renderOnly=false,time:controlled}){
 const[ownTime,setTime]=useState(0),[playing,setPlaying]=useState(false),[full,setFull]=useState(false);
 const time=controlled??ownTime;
 const source=useRef(null),side=useRef(null);
 const slot=REDDIT_SLOT,duration=redditDuration(posts),postIndex=clamp(Math.floor(time/slot),0,Math.max(0,posts.length-1));
 const post=posts[postIndex]||{author:'u/creator',title:'Your story title',body:'Write a story to preview it here.',votes:'0',comments:'0'};
 const local=time-postIndex*slot,reveal=clamp((local-.5)/3.8,0,1),words=String(post.body||'').split(/\s+/).filter(Boolean);
 const enter=ease(clamp(local/.32,0,1));
 useEffect(()=>{if(!playing||renderOnly)return;let handle;let previous=performance.now();const tick=now=>{const elapsed=(now-previous)/1000;previous=now;setTime(value=>{const next=value+elapsed;if(next>=duration){setPlaying(false);return duration}return next});handle=requestAnimationFrame(tick)};handle=requestAnimationFrame(tick);return()=>cancelAnimationFrame(handle)},[playing,duration,renderOnly]);
 useEffect(()=>{for(const element of [source.current,side.current]){if(!element)continue;const target=Number.isFinite(element.duration)&&element.duration>0?time%element.duration:0;if(Number.isFinite(element.duration)&&Math.abs(element.currentTime-target)>(playing?.45:renderOnly?.001:.045))element.currentTime=target;if(playing){if(element.paused)element.play().catch(()=>{})}else element.pause()}},[time,playing,full,videoUrl,renderOnly]);
 useEffect(()=>{const key=event=>{if(event.key==='Escape')setFull(false)};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[]);
 const toggle=()=>{if(time>=duration-.05)setTime(0);setPlaying(value=>!value)};
 const card=<article key={post.id||postIndex} className={'rlp-post'+(renderOnly?' still':'')} style={renderOnly?{opacity:.5+.5*enter,transform:`translateY(${(1-enter)*12}px) scale(${.97+.03*enter})`}:undefined}>
  <div className="rlp-author"><span className="rlp-avatar">{post.avatarUrl?<img src={post.avatarUrl} alt=""/>:String(post.author||'u')[0].toUpperCase()}</span><div><strong>{post.author||'u/creator'}</strong><small>Posted just now · Story</small></div></div>
  <h3>{post.title||'Your story title'}</h3>
  {post.imageUrl?<div className="rlp-image"><img src={post.imageUrl} alt=""/></div>:null}
  <p>{words.map((word,index)=><span className={index<Math.ceil(words.length*reveal)?'shown':''} key={index}>{word} </span>)}</p>
  <footer><span><ArrowBigUp size={13}/>{post.votes||'0'}</span><span><MessageCircle size={13}/>{post.comments||'0'}</span><span>Share</span></footer>
 </article>;
 const phone=<div className={'rlp-phone '+(dark?'dark':'light')+(renderOnly?' render':'')}><video ref={source} className="rlp-game" src={videoUrl} poster={posterUrl} muted loop playsInline preload="auto"/>{card}{renderOnly?null:<div className="rlp-controls"><button aria-label={playing?'Pause Reddit preview':'Play Reddit preview'} onClick={toggle}>{playing?<Pause size={17}/>:<Play size={17}/>}</button><span>{Math.floor(time)}s / {duration}s</span><button aria-label="Fullscreen Reddit preview" onClick={()=>setFull(value=>!value)}><Maximize size={16}/></button><input type="range" aria-label="Scrub Reddit timeline" min="0" max={duration} step="0.01" value={time} onPointerDown={()=>setPlaying(false)} onChange={e=>{setPlaying(false);setTime(Number(e.target.value))}}/></div>}</div>;
 if(renderOnly)return phone;
 return <div className="rlp-root"><header><strong>Live preview</strong><span>9:16 · {posts.length} {posts.length===1?'post':'posts'}</span></header><div className="rlp-stage">{full?null:phone}</div>{full&&<div className="rlp-full" role="dialog" aria-label="Fullscreen Reddit preview"><video ref={side} className="rlp-side" src={videoUrl} poster={posterUrl} muted loop playsInline preload="auto"/><button className="rlp-close" aria-label="Close fullscreen Reddit preview" onClick={()=>setFull(false)}><X size={22}/></button>{phone}</div>}</div>
}

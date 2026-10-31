// @ts-nocheck
// Creator Studio engine: Fake Text Story, Would You Rather and AI Clipper.
// Framework-free DOM module mounted by CreatorStudio.tsx. It owns its own
// state, previews and in-browser MP4 export, and is scoped by `.cs-root`.

const SPRITE = `<svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true"><defs>
<symbol id="chev-left" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></symbol><symbol id="chev-right" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></symbol>
<symbol id="swap" viewBox="0 0 24 24"><path d="M7 7h14m-4-4 4 4-4 4M17 17H3m4-4-4 4 4 4"/></symbol>
<symbol id="trash" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m5 4v6m4-6v6"/></symbol>
<symbol id="music" viewBox="0 0 24 24"><path d="M9 18V5l12-2v13M9 9l12-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="18" cy="16" rx="3" ry="2"/></symbol>
<symbol id="message" viewBox="0 0 24 24"><path d="M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 3V7a2 2 0 0 1 2-2Z"/><path d="M8 10h8m-8 4h6"/></symbol>
<symbol id="image" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></symbol>
<symbol id="send" viewBox="0 0 24 24"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></symbol>
<symbol id="plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></symbol>
<symbol id="text" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 8h10m-5 0v9m-3 0h6"/></symbol>
<symbol id="palette" viewBox="0 0 24 24"><path d="m14 3 7 7-11 11H3v-7L14 3Z"/><path d="m11 6 7 7M3 18c5 0 10 0 18-2"/></symbol>
<symbol id="game" viewBox="0 0 24 24"><path d="M6 7h12a4 4 0 0 1 4 4v4a3 3 0 0 1-5 2l-2-2H9l-2 2a3 3 0 0 1-5-2v-4a4 4 0 0 1 4-4Z"/><path d="M8 10v5m-2.5-2.5h5M16 11h.01M19 13h.01"/></symbol>
<symbol id="audio" viewBox="0 0 24 24"><path d="M4 9v6m5-10v14m6-11v8m5-11v14"/></symbol>
<symbol id="video" viewBox="0 0 24 24"><rect x="2" y="5" width="15" height="14" rx="2"/><path d="m17 10 5-3v10l-5-3"/></symbol>
<symbol id="phone-call" viewBox="0 0 24 24"><path d="M6 3h4l1 5-2 2a17 17 0 0 0 5 5l2-2 5 1v4a3 3 0 0 1-3 3A16 16 0 0 1 3 6a3 3 0 0 1 3-3Z"/></symbol>
<symbol id="play" viewBox="0 0 24 24"><path d="m8 4 12 8-12 8z" fill="currentColor" stroke="none"/></symbol>
<symbol id="pause" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/></symbol>
<symbol id="volume" viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4V5ZM15 9a5 5 0 0 1 0 6m3-9a9 9 0 0 1 0 12"/></symbol>
<symbol id="full" viewBox="0 0 24 24"><path d="M9 3H3v6m18 0V3h-6M3 15v6h6m6 0h6v-6"/></symbol>
<symbol id="upload" viewBox="0 0 24 24"><path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5"/></symbol>
<symbol id="spark" viewBox="0 0 24 24"><path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5Z"/></symbol>
<symbol id="check" viewBox="0 0 24 24"><path d="m4 12 5 5L20 6"/></symbol>
<symbol id="arrow-up-right" viewBox="0 0 24 24"><path d="M6 18 18 6M8 6h10v10"/></symbol></defs></svg>`;

const SHELL = `<div class="app" id="app"><div class="workspace"><main class="panel editor" id="editor"></main><aside class="panel previewPanel" id="right" aria-label="Video preview"></aside></div><footer class="footer"><div class="steps" id="steps"></div><div class="footerBtns"><button class="navBtn" id="back" type="button"></button><button class="navBtn primaryAction" id="next" type="button"></button></div></footer></div><input type="file" id="importFile" accept=".txt,.json,text/plain,application/json" class="hidden">`;

export function mountCreatorStudio(host, opts) {
'use strict';
const css = opts.css || '';
host.classList.add('cs-root');
host.innerHTML = SPRITE + SHELL;
// Dialogs, fullscreen layers and toasts live outside the host so no ancestor
// transform in the surrounding app can trap their fixed positioning.
const overlay = document.createElement('div');
overlay.className = 'cs-root cs-overlay';
overlay.innerHTML = '<div id="modalRoot"></div>';
document.body.appendChild(overlay);
let destroyed = false;
const disposers = [];
const listen = (target, type, fn) => { target.addEventListener(type, fn); disposers.push(() => target.removeEventListener(type, fn)); };

const icons=(name,cls='')=>`<svg class="i ${cls}" aria-hidden="true"><use href="#${name}"></use></svg>`;
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state={clipper:{url:'',fileName:'',duration:0,start:0,end:0,theme:0,source:'file',format:'9:16',captionText:'MAKE EVERY SECOND COUNT',captionColor:'#fff236',outlineColor:'#131722',font:'Impact',position:'bottom',wordMode:'group',mockTime:0},tool:opts.tool||'text',wyrQuestions:[{id:1,a:'Get GTA VI early',b:'Feed the homeless',percent:78,label:true},{id:2,a:'£10m now but you can never play video games again',b:'A 10% chance of £100m',percent:22,label:true},{id:3,a:'Be able to fly',b:'Be able to turn invisible',percent:55,label:true}],wyrNextId:4,wyrTime:0,wyrPlaying:false,wyrTiming:{countdown:3,results:2.4,gap:.55},step:0,profile:'Unknown',theme:'ios-dark',messages:[{id:1,text:'hello',from:'receiver'},{id:2,text:'hey bro',from:'sender'},{id:3,text:'what is going on?',from:'sender'},{id:4,text:'nothing much',from:'receiver'}],nextId:5,draft:'',draftSide:'sender',background:'green',playing:false,playIndex:0,audio:{enabled:true,contactVoice:'Chloe',userVoice:'Ryan',speed:1},gameplay:null,wyrVoice:{enabled:true,voice:'Ryan',speed:1}};
const editor=host.querySelector('#editor'),right=host.querySelector('#right'),steps=host.querySelector('#steps'),back=host.querySelector('#back'),next=host.querySelector('#next'),modalRoot=overlay.querySelector('#modalRoot'),importer=host.querySelector('#importFile');
const stepNames=['Script','Theme','Gameplay Video','Audio'],stepIcons=['text','palette','game','audio'];let activeTimeout=0;
const profileName=()=>state.profile.trim()||'Unknown';
const allLines=()=>state.messages.filter(m=>m.text.trim());
const $=id=>host.querySelector('#'+id)||overlay.querySelector('#'+id);


/* ---------------- Voices (Creator TTS service) ---------------- */
const VOICES=["Max","Ryan","Aiden","Aaron","Abigail","Anaya","Andy","Archer","Brian","Chloe","Dylan","Emmanuel","Ethan","Evelyn","Gavin","Gordon","Ivan","Laura","Lucy","Madison","Marisol","Meera","Walter"];
const speech=new Map();let audioCtx=null;const liveSources=[];
const getCtx=()=>audioCtx||(audioCtx=new (window.AudioContext||window.webkitAudioContext)());
async function fetchSpeech(text,voice){
 const key=voice+'|'+text;if(speech.has(key))return speech.get(key);
 const res=await fetch('/api/creator/tts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:text.slice(0,600),voice})});
 if(!res.ok){const d=await res.json().catch(()=>({}));throw Error(d.error||'Voice generation failed ('+res.status+')')}
 const ctx=getCtx();const buffer=await ctx.decodeAudioData(await res.arrayBuffer());
 const item={buffer,dur:buffer.duration};speech.set(key,item);return item;
}
async function fetchAll(jobs,onProgress){
 const todo=jobs.filter((j,i)=>!speech.has(j.voice+'|'+j.text)&&jobs.findIndex(k=>k.voice===j.voice&&k.text===j.text)===i);let done=0,failure=null,cursor=0;
 const worker=async()=>{while(cursor<todo.length&&!failure&&!destroyed){const j=todo[cursor++];try{await fetchSpeech(j.text,j.voice)}catch(e){failure=e}done++;onProgress?.(done,todo.length)}};
 await Promise.all([worker(),worker(),worker()]);if(failure)throw failure;return todo.length;
}
function playSpeech(item,rate=1,delay=0){
 const ctx=getCtx();ctx.resume?.();const src=ctx.createBufferSource();src.buffer=item.buffer;src.playbackRate.value=rate;src.connect(ctx.destination);
 src.onended=()=>{const i=liveSources.indexOf(src);if(i>=0)liveSources.splice(i,1)};liveSources.push(src);src.start(ctx.currentTime+delay);
}
function stopAudio(){while(liveSources.length){try{liveSources.pop().stop()}catch{}}}
async function previewVoice(voice,button){
 const label=button?.textContent;if(button){button.disabled=true;button.textContent='…'}
 try{stopAudio();playSpeech(await fetchSpeech('Hey, this is what I sound like.',voice),1)}catch(e){toast(e.message)}finally{if(button){button.disabled=false;button.textContent=label}}
}
const voiceOptions=sel=>VOICES.map(v=>`<option value="${v}" ${v===sel?'selected':''}>${v}</option>`).join('');
// Text-story speech: one clip per message, spoken by the contact or the user.
const voiceFor=m=>m.from==='sender'?state.audio.userVoice:state.audio.contactVoice;
const speechFor=m=>speech.get(voiceFor(m)+'|'+m.text.trim().slice(0,600));
async function ensureTextSpeech(){
 if(!state.audio.enabled)return true;const jobs=allLines().map(m=>({voice:voiceFor(m),text:m.text.trim().slice(0,600)}));
 const missing=jobs.filter(j=>!speech.has(j.voice+'|'+j.text)).length;if(!missing)return true;
 toast('Generating voiceover…');
 try{await fetchAll(jobs,(d,t)=>{const b=$('voiceStatus');if(b)b.textContent=`Generating voiceover ${d}/${t}…`});return true}catch(e){toast('Voiceover failed: '+e.message);return false}
}
// Would-you-rather speech: option A and option B per question.
const wyrLines=q=>({a:'Would you rather '+q.a.trim(),b:'Or '+q.b.trim()});
const wyrSpeech=q=>{if(!state.wyrVoice.enabled)return null;const l=wyrLines(q),v=state.wyrVoice.voice;const a=speech.get(v+'|'+l.a.slice(0,600)),b=speech.get(v+'|'+l.b.slice(0,600));return a&&b?{a,b}:null};
async function ensureWyrSpeech(){
 if(!state.wyrVoice.enabled)return true;const v=state.wyrVoice.voice;const jobs=state.wyrQuestions.flatMap(q=>{const l=wyrLines(q);return [{voice:v,text:l.a.slice(0,600)},{voice:v,text:l.b.slice(0,600)}]});
 if(!jobs.filter(j=>!speech.has(j.voice+'|'+j.text)).length)return true;toast('Generating voiceover…');
 try{await fetchAll(jobs,(d,t)=>{const b=$('voiceStatus');if(b)b.textContent=`Generating voiceover ${d}/${t}…`});return true}catch(e){toast('Voiceover failed: '+e.message);return false}
}
// Records a canvas (and optional scheduled speech) in real time to MP4/WebM.
async function recordRealtime({canvas,count,fps,draw,plan,progress,label,bgVideo}){
 const withAudio=plan.length>0;
 const mime=(withAudio?['video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/mp4;codecs=avc1.42001f,mp4a.40.2','video/mp4','video/webm;codecs=vp9,opus','video/webm']:['video/mp4;codecs=avc1.42E01E','video/mp4;codecs=avc1.42001f','video/mp4','video/webm;codecs=vp9','video/webm']).find(x=>window.MediaRecorder?.isTypeSupported(x));
 if(!mime)throw Error('Video recording is not supported in this browser');
 const vstream=canvas.captureStream(0),track=vstream.getVideoTracks()[0],tracks=[track];let ac=null,dest=null;
 if(withAudio){ac=new (window.AudioContext||window.webkitAudioContext)();await ac.resume();dest=ac.createMediaStreamDestination();tracks.push(dest.stream.getAudioTracks()[0])}
 const rec=new MediaRecorder(new MediaStream(tracks),{mimeType:mime,videoBitsPerSecond:4000000,audioBitsPerSecond:128000});
 const chunks=[];const done=new Promise((resolve,reject)=>{rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};rec.onerror=e=>reject(e.error||Error('Recorder failed'));rec.onstop=resolve});
 if(bgVideo){bgVideo.currentTime=0;await bgVideo.play().catch(()=>{})}
 draw(0);track.requestFrame?.();rec.start();
 const lead=.25,startAt=performance.now()+lead*1000;
 if(ac)for(const p of plan){const src=ac.createBufferSource();src.buffer=p.buffer;src.playbackRate.value=p.rate||1;src.connect(dest);src.start(ac.currentTime+lead+p.at)}
 for(let i=0;i<count;i++){
  if(destroyed)break;
  const delay=startAt+i*1000/fps-performance.now();if(delay>1)await new Promise(r=>setTimeout(r,delay));
  draw(i/fps);track.requestFrame?.();
  if(i%6===0)progress(7+Math.round(i/count*88),label);
 }
 await new Promise(r=>setTimeout(r,300));rec.stop();await done;
 if(bgVideo)bgVideo.pause();if(ac)ac.close().catch(()=>{});vstream.getTracks().forEach(t=>t.stop());
 if(!chunks.length)throw Error('No video frames were recorded');
 return {blob:new Blob(chunks,{type:mime}),mime,ext:mime.includes('mp4')?'mp4':'webm'};
}
function loadBgVideo(url){return new Promise((resolve,reject)=>{const v=document.createElement('video');v.muted=true;v.loop=true;v.playsInline=true;v.preload='auto';v.src=url;v.onloadeddata=()=>resolve(v);v.onerror=()=>reject(Error('Could not load the gameplay clip'));})}
function drawCover(ctx,v,w,h){const sw=v.videoWidth,sh=v.videoHeight;if(!sw||!sh)return;const sc=Math.max(w/sw,h/sh),dw=sw*sc,dh=sh*sc;ctx.drawImage(v,(w-dw)/2,(h-dh)/2,dw,dh)}

// Track the host height so the studio fills its container instead of the window.
const syncHeight=()=>{host.style.setProperty('--cs-h',host.clientHeight+'px');overlay.style.setProperty('--cs-h',host.clientHeight+'px')};
const resizeObserver=new ResizeObserver(()=>{syncHeight();if(state.tool==='text')updatePreview()});resizeObserver.observe(host);syncHeight();

function stepNav(){
 const names=state.tool==='wyr'?['Questions','Timing']:state.tool==='clipper'?['Import','Moments','Captions','Clips']:stepNames;
 const symbols=state.tool==='wyr'?['text','audio']:state.tool==='clipper'?['upload','spark','text','video']:stepIcons;
 steps.innerHTML=`<button type="button" class="allTools" id="allTools" title="Back to Shorts">${icons('chev-left','sm')} Studio</button><span class="stepDivider"></span>`+names.map((t,i)=>`${i?`<span class="stepSep">›</span>`:''}<button type="button" class="step ${i===state.step?'current':''}" data-step="${i}" aria-current="${i===state.step?'step':'false'}"><span class="stepIcon">${icons(symbols[i])}</span><span>${t}</span></button>`).join('');
 back.style.display='flex';back.innerHTML=`${icons('chev-left')}Back`;
 next.innerHTML=state.tool==='clipper'&&state.step===3?`${clipRun.status==='running'?'Working…':clipRun.cards.length?'Run again':'Generate clips'} ${icons('chev-right')}`:state.step===names.length-1?`Export ${icons('chev-right')}`:`Next ${icons('chev-right')}`;
 steps.querySelector('#allTools').onclick=goHome;
 steps.querySelectorAll('[data-step]').forEach(el=>el.onclick=()=>setStep(Number(el.dataset.step)));
 back.onclick=()=>state.step===0?goHome():setStep(state.step-1);
 next.onclick=()=>state.step===names.length-1?(state.tool==='clipper'?startClipRun():exportModal()):(state.tool==='clipper'&&state.step===0&&!clipReady()?toast('Add a video first — upload a file or load a YouTube link'):setStep(state.step+1));
}

function stopAll(){stopAudio();if(state.tool==='wyr')stopWyr();else if(state.tool==='text')stopPlayback();else{host.querySelectorAll('.clipSourceVideo').forEach(v=>v.pause())}}
function setStep(n){const max=state.tool==='wyr'?1:state.tool==='clipper'?3:3;if(n<0||n>max)return;stopAll();state.step=n;render(true)}
function goHome(){stopAll();opts.onExit?.()}

function render(animate=false){
 app_toggle();
 stepNav();editor.className='panel editor'+(state.tool==='wyr'?' wyrEditor':state.tool==='clipper'?' clipperEditor':'');right.className='panel previewPanel';
 if(state.tool==='wyr'){
   if(state.step===0)renderWyrEditor();else renderWyrSettings();renderWyrPreview();
 }else if(state.tool==='clipper'){
   if(state.step===0)renderClipperSource();else if(state.step===1)renderClipperMoments();else if(state.step===2)renderClipperCaptions();else renderClipperClips();
 }else{
   if(state.step===0)renderScript();if(state.step===1)renderThemes();if(state.step===2)renderGameplay();if(state.step===3)renderSilenceSettings();renderPreview();
 }
 if(animate){[editor,...(state.tool==='clipper'?[]:[right])].forEach(el=>{el.classList.remove('pageEnter');void el.offsetWidth;el.classList.add('pageEnter')})}
}
function app_toggle(){host.querySelector('#app').classList.toggle('clipperMode',state.tool==='clipper')}

function renderScript(){editor.innerHTML=`<div class="inner"><header class="pagehead"><h1>Text Script</h1><div class="topButtons"><button class="pill" id="importBtn" type="button">Import</button><button class="pill primary" id="aiBtn" type="button">AI Writer</button></div></header><section class="profile"><div class="avatarBig" id="profileAvatar">${escapeHtml(profileName()[0].toUpperCase())}</div><div class="profileEdit"><div class="fieldLabel">Profile Name</div><input aria-label="Profile Name" id="profileInput" value="${escapeHtml(state.profile)}" placeholder="Contact name" maxlength="35"></div></section><div class="messagesHead"><strong>Messages</strong><div class="smallActions"><button class="outlineBtn" id="swapAll">Swap All ${icons('swap')}</button><button class="outlineBtn" id="deleteAll">Delete All ${icons('trash','sm')}</button></div></div><div class="messageList" id="messageList"></div><div class="messageComposer"><div class="composeBox">${icons('image')}<input type="text" id="draft" placeholder="Type your message here..." aria-label="New message" maxlength="500" value="${escapeHtml(state.draft)}"></div><button class="sideSwitch ${state.draftSide==='sender'?'sender':''}" id="draftSide" title="Toggle sender / receiver" aria-label="New message sent by ${state.draftSide}"><span class="sideKnob">${icons('message','sm')}</span></button><button class="actionRound" id="addDraft" title="Send new message" aria-label="Send new message">${icons('send','lg')}</button></div><button class="addMessage" id="addBlank">+ &nbsp;Add Message</button></div>`;
const pi=editor.querySelector('#profileInput');pi.oninput=e=>{state.profile=e.target.value;editor.querySelector('#profileAvatar').textContent=profileName()[0].toUpperCase();updatePreview();};
editor.querySelector('#importBtn').onclick=()=>importer.click();editor.querySelector('#aiBtn').onclick=aiWriterModal;
editor.querySelector('#swapAll').onclick=()=>{state.messages.forEach(m=>m.from=m.from==='sender'?'receiver':'sender');renderMessageList();updatePreview()};
editor.querySelector('#deleteAll').onclick=()=>openDialog('Delete all messages?',`This will clear the script. You can add messages again immediately.`,[{label:'Cancel'},{label:'Delete All',primary:true,fn:()=>{state.messages=[];renderMessageList();updatePreview();toast('Messages cleared')}}]);
const dr=editor.querySelector('#draft');dr.oninput=e=>state.draft=e.target.value;dr.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();addDraft()}};
editor.querySelector('#draftSide').onclick=()=>{state.draftSide=state.draftSide==='sender'?'receiver':'sender';editor.querySelector('#draftSide').classList.toggle('sender',state.draftSide==='sender')};editor.querySelector('#addDraft').onclick=addDraft;
editor.querySelector('#addBlank').onclick=()=>{state.messages.push({id:state.nextId++,text:'',from:state.draftSide});renderMessageList();updatePreview();const inputs=editor.querySelectorAll('.messageText input');inputs[inputs.length-1]?.focus()};renderMessageList();}
function renderMessageList(keepScroll=false){const c=editor.querySelector('#messageList');if(!c)return;let old=keepScroll?c.scrollTop:null;c.innerHTML=state.messages.map((m,ix)=>`<div class="messageRow" data-id="${m.id}"><label class="messageText">${icons('music')}<input aria-label="Message ${ix+1}" data-mid="${m.id}" maxlength="500" value="${escapeHtml(m.text)}" placeholder="Type a message..."></label><button class="sideSwitch ${m.from==='sender'?'sender':''}" data-swap="${m.id}" title="Toggle sender/receiver" aria-label="Toggle message ${ix+1} side"><span class="sideKnob">${icons('message','sm')}</span></button><button class="actionRound" data-del="${m.id}" title="Delete message ${ix+1}" aria-label="Delete message ${ix+1}">${icons('trash')}</button></div>`).join('');c.querySelectorAll('[data-mid]').forEach(el=>el.oninput=e=>{const msg=state.messages.find(m=>m.id===Number(e.target.dataset.mid));if(msg){msg.text=e.target.value;updatePreview()}});c.querySelectorAll('[data-swap]').forEach(el=>el.onclick=()=>{let msg=state.messages.find(m=>m.id===Number(el.dataset.swap));if(msg){msg.from=msg.from==='sender'?'receiver':'sender';el.classList.toggle('sender',msg.from==='sender');updatePreview()}});c.querySelectorAll('[data-del]').forEach(el=>el.onclick=()=>{state.messages=state.messages.filter(m=>m.id!==Number(el.dataset.del));renderMessageList(true);updatePreview()});if(old!==null)c.scrollTop=old;else c.scrollTop=0}
function addDraft(){const value=state.draft.trim();if(!value){editor.querySelector('#draft').focus();return}state.messages.push({id:state.nextId++,text:value,from:state.draftSide});state.draft='';editor.querySelector('#draft').value='';renderMessageList();updatePreview();editor.querySelector('#draft').focus()}
function makeThemeCard(theme,label){const ios=theme.startsWith('ios');const first=allLines().find(m=>m.from==='receiver')?.text||'Hey, you got a minute?',second=allLines().find(m=>m.from==='sender')?.text||"Yeah, what’s up?";return `<button type="button" class="themeCard ${state.theme===theme?'selected':''}" data-theme="${theme}" aria-pressed="${state.theme===theme}"><span class="themeShot ${theme}"><span class="themeTop"><span class="themeBack">‹</span><span class="themeContact"><span class="miniAvatar">${escapeHtml(profileName()[0].toUpperCase())}</span><span><span class="name">${escapeHtml(profileName())}</span>${ios?'':'<br><span class="online">Online</span>'}</span></span><span class="themeContactsButtons">${icons('video','lg')}${ios?'':icons('phone-call','lg')}</span></span><span class="sampleMessages"><span class="sampleLine"><span class="sampleBub in">${escapeHtml(first)}</span></span><span class="sampleLine out"><span class="sampleBub out">${escapeHtml(second)}</span></span></span></span><strong>${label}</strong></button>`}
function renderThemes(){editor.innerHTML=`<div class="inner"><header class="pagehead"><h1>Choose Theme</h1></header><div class="themeGrid">${makeThemeCard('whatsapp-light','WhatsApp Light')}${makeThemeCard('whatsapp-dark','WhatsApp Dark')}${makeThemeCard('ios-light','iOS Light')}${makeThemeCard('ios-dark','iOS Dark')}</div></div>`;editor.querySelectorAll('[data-theme]').forEach(el=>el.onclick=()=>{state.theme=el.dataset.theme;editor.querySelectorAll('.themeCard').forEach(e=>{e.classList.toggle('selected',e===el);e.setAttribute('aria-pressed',e===el?'true':'false')});updatePreview()})}
let gameplayClips=null;
async function loadGameplay(){if(gameplayClips)return gameplayClips;try{const r=await fetch('/api/shorts/faketext/gameplay-library');const d=await r.json();gameplayClips=Array.isArray(d.clips)?d.clips:[]}catch{gameplayClips=[]}return gameplayClips}
function renderGameplay(){const solid=[{id:'green',title:'Green Screen',kind:'green',subtitle:'Chroma-key green for your video editor'},{id:'soft',title:'Soft Background',kind:'blue',subtitle:'Subtle static blue gradient'},{id:'dark',title:'Dark Background',kind:'dark',subtitle:'Dark neutral background'}];
 const clips=gameplayClips||[];const cats=[...new Set(clips.map(c=>c.category))];
 const clipCard=c=>`<button type="button" class="gameCard ${state.background==='video'&&state.gameplay?.id===c.id?'selected':''}" data-clip="${escapeHtml(c.id)}" aria-pressed="${state.background==='video'&&state.gameplay?.id===c.id}"><div class="gameVisual clipPoster" style="${c.posterUrl?`background-image:url('${escapeHtml(c.posterUrl)}')`:''}"><span class="posterTag">${escapeHtml(c.category)}</span></div><div class="gameDetails"><div class="name">${escapeHtml(c.label)}</div><div class="metaLine"><span class="chip">Silent loop</span><span class="chip">Free</span></div></div></button>`;
 editor.innerHTML=`<div class="inner"><header class="pagehead"><h1>Choose Background</h1><div class="topButtons"><span class="questionCount">${clips.length?clips.length+' gameplay clips':gameplayClips?'No clips found':'Loading clips…'}</span></div></header><div class="gameplayGrid"><div class="gameSection">Solid backgrounds</div>${solid.map(c=>`<button type="button" class="gameCard ${state.background===c.id?'selected':''}" data-background="${c.id}" aria-pressed="${state.background===c.id}"><div class="gameVisual ${c.kind}"><div class="visualIcon">${icons('video','lg')}</div><span>${c.id==='green'?'Green screen':'No gameplay footage'}</span></div><div class="gameDetails"><div class="name">${c.title}</div><div class="viewFull">${c.subtitle} &nbsp; ›</div></div></button>`).join('')}${cats.map(cat=>`<div class="gameSection">${escapeHtml(cat.replace(/^\w/,x=>x.toUpperCase()))} gameplay</div>${clips.filter(c=>c.category===cat).map(clipCard).join('')}`).join('')}</div></div>`;
 const mark=el=>{editor.querySelectorAll('.gameCard').forEach(c=>{c.classList.toggle('selected',c===el);c.setAttribute('aria-pressed',c===el?'true':'false')})};
 editor.querySelectorAll('[data-background]').forEach(el=>el.onclick=()=>{state.background=el.dataset.background;state.gameplay=null;mark(el);updatePreview();toast('Background updated')});
 editor.querySelectorAll('[data-clip]').forEach(el=>el.onclick=()=>{const c=clips.find(x=>x.id===el.dataset.clip);if(!c)return;state.background='video';state.gameplay=c;mark(el);updatePreview();toast(c.label+' selected')});
 if(!gameplayClips)loadGameplay().then(()=>{if(!destroyed&&state.tool==='text'&&state.step===2)renderGameplay()});
}
function renderPreview(){right.innerHTML=`<div class="previewHead"><h2>Video Preview</h2></div><div class="phoneSpace"><div class="phone ${state.theme}" id="phone"></div></div>`;updatePreview()}
function waHeader(){return `<div class="waBar"><span class="waBack">${icons('chev-left')}</span><span class="miniAvatar">${escapeHtml(profileName()[0].toUpperCase())}</span><div class="waContact"><div class="waName">${escapeHtml(profileName())}</div><div class="waStatus">online</div></div><span class="waHeaderIcons">${icons('video')}${icons('phone-call')}</span></div>`}
function iosHeader(){return `<div class="iosbar"><div class="backBadge">${icons('chev-left','sm')}<span class="badge99">99</span></div><div class="contactMini"><span class="miniAvatar">${escapeHtml(profileName()[0].toUpperCase())}</span><div class="contactName">${escapeHtml(profileName())}<span class="contactChevron">›</span></div></div>${icons('video','sm')}</div>`}
function phoneMarkup(full=false){let msgs=allLines();let visible=msgs.slice(0,state.playIndex);let duration=getTotalDuration(),wa=state.theme.startsWith('whatsapp');let messages=visible.map((m,i)=>`<div class="bubbleLine ${m.from==='sender'?'from-sender':''}" data-message-id="${m.id}"><div class="bubble"><span class="messageCopy">${escapeHtml(m.text)}</span>${wa?`<span class="waMeta"><span>10:${String(40+i).padStart(2,'0')}</span>${m.from==='sender'?'<span class="waTicks" aria-label="Read"></span>':''}</span>`:''}</div></div>`).join('');const bgv=state.background==='video'&&state.gameplay?`<video class="bgVideo" src="${escapeHtml(state.gameplay.videoUrl)}" muted loop autoplay playsinline></video>`:'';return `${bgv}<div class="storyChat" id="storyChat">${wa?waHeader():iosHeader()}<div class="chatMessages" id="chatMessages">${messages}</div></div><div class="playerControls"><button class="playButton" data-control="play" title="${state.playing?'Pause':'Play'} preview" aria-label="${state.playing?'Pause':'Play'} preview">${icons(state.playing?'pause':'play','lg')}</button><span class="timeStamp" id="timeStamp">${displayDuration(currentElapsed)} / ${displayDuration(duration)}</span><button class="playButton fullScreen" data-control="full" title="Enlarge preview" aria-label="Enlarge preview">${icons('full','lg')}</button><div class="rangeTrack"><div class="rangeFill" id="rangeFill" style="width:${duration?currentElapsed/duration*100:0}%"></div><input type="range" class="transportSeek" data-text-seek min="0" max="${duration}" step="0.01" value="${currentElapsed}" aria-label="Scrub text story timeline"></div></div>`}
let currentElapsed=0;
function getMessageSeconds(msg){if(state.audio.enabled){const sp=speechFor(msg);if(sp)return Math.max(1,sp.dur/state.audio.speed+.25)}return Math.max(1.15,Math.min(7, (msg.text.length/15)+.75))}
function getTotalDuration(){return Math.max(1,allLines().reduce((a,m)=>a+getMessageSeconds(m)+.45,0))}
function displayDuration(n){n=Math.round(n);return `${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`}
let forceResetChatHeight=false;
let textFrame=0,textOrigin=0;
function textIndexAt(seconds){let at=.35,num=0;for(const m of allLines()){if(seconds+1e-5<at)break;num++;at+=getMessageSeconds(m)+.45}return num}
function livePhones(){return [$('phone'),$('modalPhone')].filter(Boolean)}
function updateTextClock(){for(const ph of livePhones()){
 const time=ph.querySelector('#timeStamp');if(time)time.textContent=`${displayDuration(currentElapsed)} / ${displayDuration(getTotalDuration())}`;
 const progress=ph.querySelector('#rangeFill');if(progress)progress.style.width=Math.min(100,currentElapsed/getTotalDuration()*100)+'%';
 const seek=ph.querySelector('[data-text-seek]');if(seek){seek.max=getTotalDuration();if(document.activeElement!==seek)seek.value=String(currentElapsed)}
 const play=ph.querySelector('[data-control="play"]');if(play){play.innerHTML=icons(state.playing?'pause':'play','lg');play.setAttribute('aria-label',state.playing?'Pause preview':'Play preview')}
}}
// Keeps the newest messages visible once the chat is taller than its card.
function fitChat(card,chat,head,target){chat.style.marginTop=-Math.max(0,head+chat.scrollHeight-target)+'px'}
function refreshPhone(phone,full){
 if(full)phone.style.setProperty('--chat-scale',String(phone.offsetWidth/256));
 const signature=[full,state.theme,state.background,state.gameplay?.id||'',profileName()].join('|');
 if(phone.dataset.signature!==signature||!phone.querySelector('.storyChat')){
   phone.className='phone '+(full?'full ':'')+state.theme+' bg-'+state.background;phone.innerHTML=phoneMarkup(full);
   phone.dataset.signature=signature;bindPhoneControls(phone);forceResetChatHeight=true;
 }
 const card=phone.querySelector('.storyChat'),chat=phone.querySelector('.chatMessages');if(!card||!chat)return;
 const lines=allLines().slice(0,state.playIndex),wa=state.theme.startsWith('whatsapp');
 const nodes=[...chat.querySelectorAll('.bubbleLine')];const changed=nodes.findIndex((node,i)=>!lines[i]||Number(node.dataset.messageId)!==lines[i].id);
 if(changed>=0)nodes.slice(changed).forEach(node=>node.remove());
 let existing=chat.querySelectorAll('.bubbleLine').length;
 for(let i=0;i<existing;i++){const node=chat.children[i],m=lines[i];if(!node||!m)continue;
  node.classList.toggle('from-sender',m.from==='sender');const copy=node.querySelector('.messageCopy');if(copy&&copy.textContent!==m.text)copy.textContent=m.text;
 }
 for(let i=existing;i<lines.length;i++){
  const m=lines[i],node=document.createElement('div');node.className='bubbleLine'+(m.from==='sender'?' from-sender':'');node.dataset.messageId=m.id;
  const bubble=document.createElement('div'),msg=document.createElement('span');bubble.className='bubble';msg.className='messageCopy';msg.textContent=m.text;bubble.append(msg);
  if(wa){const meta=document.createElement('span');meta.className='waMeta';meta.innerHTML=`<span>10:${String(40+i).padStart(2,'0')}</span>${m.from==='sender'?'<span class="waTicks" aria-label="Read"></span>':''}`;bubble.append(meta)}
  node.append(bubble);chat.append(node);if(state.playing&&!forceResetChatHeight){node.classList.add('entering');node.addEventListener('animationend',()=>node.classList.remove('entering'),{once:true})}
 }
 const scale=full?phone.offsetWidth/256:1,head=card.firstElementChild.offsetHeight;
 const target=Math.max(head+8*scale,Math.min(phone.offsetHeight*.77,head+chat.scrollHeight));
 const prev=Number.parseFloat(card.style.height)||target;
 if(forceResetChatHeight||state.playIndex<Number(card.dataset.visibleCount||0)){
   card.style.transition='none';card.style.height=target+'px';
 }else if(Math.abs(target-prev)>.5){
   card.style.transition='height .45s cubic-bezier(.22,.8,.2,1)';card.style.height=target+'px';
 }
 fitChat(card,chat,head,target);
 card.dataset.visibleCount=String(state.playIndex);
 updateTextClock();
}
function updatePreview(){const p=$('phone');if(p)refreshPhone(p,false);const f=$('modalPhone');if(f)refreshPhone(f,true);forceResetChatHeight=false}
function bindPhoneControls(ph){
 ph.querySelectorAll('[data-control]').forEach(btn=>btn.onclick=()=>{const k=btn.dataset.control;if(k==='play')state.playing?pausePlayback():startPlayback();else if(k==='full')$('modalPhone')?closeDialog():openFullscreen()});
 const seek=ph.querySelector('[data-text-seek]');if(seek){seek.addEventListener('pointerdown',()=>{if(state.playing)pausePlayback()});seek.oninput=()=>seekText(Number(seek.value))}
}
function pausePlayback(){cancelAnimationFrame(textFrame);state.playing=false;stopAudio();updateTextClock()}
function stopPlayback(){pausePlayback();currentElapsed=0;state.playIndex=0;forceResetChatHeight=true;updatePreview()}
function seekText(t){pausePlayback();currentElapsed=Math.min(getTotalDuration(),Math.max(0,t));state.playIndex=textIndexAt(currentElapsed);forceResetChatHeight=true;updatePreview()}
async function startPlayback(){if(!allLines().length){toast('Add messages to play the preview');return}
 if(state.playing)return;
 if(!(await ensureTextSpeech()))return;
 const len=getTotalDuration();
 if(currentElapsed>=len-.02){currentElapsed=0;state.playIndex=0;forceResetChatHeight=true;updatePreview()}
 state.playing=true;textOrigin=performance.now()-currentElapsed*1000;
 const speak=i=>{const m=allLines()[i];if(!m||!state.audio.enabled)return;const sp=speechFor(m);if(sp)playSpeech(sp,state.audio.speed)};
 const tick=now=>{if(!state.playing||destroyed)return;currentElapsed=Math.min(len,Math.max(0,(now-textOrigin)/1000));const idx=textIndexAt(currentElapsed);
  if(idx!==state.playIndex){const prev=state.playIndex;state.playIndex=idx;if(idx>prev)speak(idx-1);updatePreview()}else updateTextClock();
  if(currentElapsed<len)textFrame=requestAnimationFrame(tick);else{state.playing=false;updateTextClock()}
 };textFrame=requestAnimationFrame(tick);updateTextClock();
}
async function openFullscreen(){
  if(state.tool==='wyr')return openWyrFullscreen();
  if($('modalPhone'))return;
  modalRoot.innerHTML=`<div class="dialogShade fullShade" id="shade"><button class="closeFull" id="closeFull" title="Exit fullscreen" aria-label="Exit fullscreen">×</button><div class="dialog"><div class="phone full ${state.theme} bg-${state.background}" id="modalPhone"></div></div></div>`;
  modalRoot.querySelector('#closeFull').onclick=closeDialog;
  const shade=modalRoot.querySelector('#shade');
  shade.onclick=e=>{if(e.target===shade)closeDialog()};
  try{if(shade.requestFullscreen)await shade.requestFullscreen({navigationUI:'hide'});}catch(e){/* overlay fallback */}
  forceResetChatHeight=true;updatePreview();
}
listen(document,'fullscreenchange',()=>{if(!document.fullscreenElement&&($('modalPhone')||$('wyrModalPhone')))closeDialog();else if($('modalPhone'))updatePreview();else if($('wyrModalPhone'))paintWyrAt(state.wyrTime)});
listen(window,'resize',()=>{if(state.tool==='text'&&$('modalPhone'))updatePreview()});

function closeDialog(){if(document.fullscreenElement&&modalRoot.contains(document.fullscreenElement))document.exitFullscreen().catch(()=>{});modalRoot.innerHTML=''}
function openDialog(title,description,buttons){modalRoot.innerHTML=`<div class="dialogShade" id="shade"><section class="dialog" role="dialog" aria-modal="true"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p><div class="dialogActions" id="dialogActions"></div></section></div>`;modalRoot.querySelector('#shade').onclick=e=>{if(e.target.id==='shade')closeDialog()};let actions=modalRoot.querySelector('#dialogActions');buttons.forEach(btn=>{let b=document.createElement('button');b.className='dialogBtn '+(btn.primary?'strong':'');b.textContent=btn.label;b.onclick=()=>{closeDialog();btn.fn?.()};actions.appendChild(b)})}
const TONES=['engaging','funny','dramatic','wholesome','dark-humor','suspenseful'];
async function generateScript(body){
 const res=await fetch('/api/shorts/ai/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const data=await res.json().catch(()=>({}));
 if(!res.ok||!data.ok)throw Error(data.error||'Script generation failed ('+res.status+')');
 return data.script;
}
function writerModal({title,intro,kind,fields,sample,apply}){
 modalRoot.innerHTML=`<div class="dialogShade" id="shade"><div class="dialog writerDialog" role="dialog" aria-modal="true"><div class="modalBrandIcon">${icons('spark','lg')}</div><h3>${title}</h3><p>${intro}</p><label for="wPrompt">What is it about?</label><textarea id="wPrompt" class="promptSelect" rows="3" maxlength="400" placeholder="e.g. my roommate ate my leftovers"></textarea>${fields}<label for="wTone">Tone</label><select id="wTone" class="promptSelect">${TONES.map(t=>`<option value="${t}">${t.replace('-',' ')}</option>`).join('')}</select><label for="wCount">Length: <output id="wCountOut">8</output></label><input type="range" id="wCount" min="3" max="12" value="8" style="width:100%"><p class="writerError hidden" id="wError"></p><div class="dialogActions"><button class="dialogBtn" id="wCancel">Cancel</button><button class="dialogBtn" id="wSample">Use sample</button><button class="dialogBtn strong" id="wGo">${icons('spark','sm')} Generate with AI</button></div></div></div>`;
 modalRoot.querySelector('#shade').onclick=e=>{if(e.target.id==='shade')closeDialog()};
 $('wCancel').onclick=closeDialog;$('wCount').oninput=e=>$('wCountOut').textContent=e.target.value;
 $('wSample').onclick=()=>{sample();closeDialog()};
 $('wGo').onclick=async()=>{const prompt=$('wPrompt').value.trim(),err=$('wError');err.classList.add('hidden');
  if(!prompt){err.textContent='Describe the video first.';err.classList.remove('hidden');return}
  const go=$('wGo');go.disabled=true;go.textContent='Writing…';
  try{const extra={};modalRoot.querySelectorAll('[data-extra]').forEach(el=>{extra[el.dataset.extra]=el.value});
   const script=await generateScript({kind,prompt,tone:$('wTone').value,count:Number($('wCount').value),...extra});apply(script);closeDialog();toast('Script written · edit anything you like')}
  catch(e){err.textContent=e.message;err.classList.remove('hidden');go.disabled=false;go.innerHTML=icons('spark','sm')+' Generate with AI'}};
 $('wPrompt').focus();
}
function aiWriterModal(){
 writerModal({title:'AI Writer',intro:'Describe the story and the AI writes the whole chat. You can edit every message afterwards.',kind:'fake-text',
  fields:`<label for="wRel">Relationship (optional)</label><input class="promptSelect" id="wRel" data-extra="relationship" placeholder="Roommates, siblings, coworkers" maxlength="80">`,
  sample(){const examples=[['receiver','We need to talk.'],['sender','Wait, what happened?'],['receiver','I just found out what you did last night.'],['sender','It is not what you think.'],['receiver','Then explain why I have a screenshot.'],['sender','Okay... you got me.']];state.messages=examples.map(([from,text])=>({id:state.nextId++,from,text}));stopPlayback();render();toast('Sample script added')},
  apply(script){const msgs=script.messages;const contact=msgs.find(m=>m.side==='left')?.sender;if(contact)state.profile=contact.slice(0,35);
   state.messages=msgs.map(m=>({id:state.nextId++,from:m.side==='right'?'sender':'receiver',text:m.text}));stopPlayback();render()}});
}
importer.onchange=async e=>{const file=e.target.files?.[0];if(!file)return;try{let text=await file.text();let lines=[];if(file.name.toLowerCase().endsWith('.json')){let obj=JSON.parse(text);if(Array.isArray(obj))lines=obj;else if(Array.isArray(obj.messages)){lines=obj.messages;if(obj.profile)state.profile=String(obj.profile);if(obj.theme&&['ios-light','ios-dark','whatsapp-light','whatsapp-dark'].includes(obj.theme))state.theme=obj.theme}else throw Error('JSON must contain a messages array')}else lines=text.split(/\r?\n/).filter(Boolean).map(x=>{let match=x.match(/^(sender|receiver|a|b)\s*:\s*(.*)$/i);return {from:match&&/^(sender|a)$/i.test(match[1])?'sender':'receiver',text:match?match[2]:x}});state.messages=lines.map((m,i)=>({id:state.nextId++,from:m.from==='sender'?'sender':i%2?'sender':'receiver',text:String(m.text||m.message||'').slice(0,500)})).filter(m=>m.text.trim());stopPlayback();render();toast(`${state.messages.length} messages imported`)}catch(err){toast('Import failed: '+err.message)}finally{importer.value=''}};
function toast(str){overlay.querySelector('.toast')?.remove();let e=document.createElement('div');e.className='toast';e.textContent=str;overlay.appendChild(e);setTimeout(()=>e.remove(),2900)}
function exportModal(){const wyr=state.tool==='wyr';modalRoot.innerHTML=`<div class="dialogShade" id="shade"><section class="dialog exportDialog" role="dialog" aria-modal="true"><div class="modalBrandIcon">${icons('video','lg')}</div><h3>Export ${wyr?'Would You Rather':'Fake Text Story'}</h3><p>Create a crisp vertical MP4 with your preview's visuals and animations, directly in your browser.</p><div class="exportSpecs"><span>${icons('check','sm')} MP4 · H.264</span><span>${icons('check','sm')} 720 × 1280</span><span>${icons('check','sm')} 30 FPS</span></div><p class="noAudioInfo">${wyr?(state.wyrVoice.enabled?'Voiceover is included.':'Voiceover is off. This export is silent.'):(state.audio.enabled?'Voiceover is included.':'Voiceover is off. This export is silent.')} Videos with voiceover or gameplay are recorded in real time, so allow roughly the video length.</p><div id="exportProgressBlock" class="exportStatus hidden"><div class="ringWrap"><svg class="exportRing" viewBox="0 0 90 90"><circle class="ringBack" cx="45" cy="45" r="36"></circle><circle class="ringMeter" id="ringMeter" cx="45" cy="45" r="36"></circle></svg><span id="ringPct">0%</span></div><div class="exportTaskLabel" id="progressLabel">Preparing frames</div><div class="exportProgress"><div id="progressBar"></div></div></div><div class="dialogActions"><button class="dialogBtn" id="cancelExport">Close</button><button class="dialogBtn" id="saveProject">Save Project</button><button class="dialogBtn strong" id="makeVideo">${icons('video','sm')} Export MP4</button></div></section></div>`;
 const shade=modalRoot.querySelector('#shade');shade.onclick=e=>{if(e.target.id==='shade')closeDialog()};modalRoot.querySelector('#cancelExport').onclick=closeDialog;modalRoot.querySelector('#saveProject').onclick=saveProject;modalRoot.querySelector('#makeVideo').onclick=renderMp4;
}
function exportProgress(n,msg){let pct=Math.max(0,Math.min(100,Math.round(n))),label=$('progressLabel'),bar=$('progressBar'),ring=$('ringMeter'),txt=$('ringPct');if(label)label.textContent=msg;if(bar)bar.style.width=pct+'%';if(ring)ring.style.strokeDashoffset=String(226.2*(1-pct/100));if(txt)txt.textContent=pct+'%';}
function saveProject(){let payload=state.tool==='wyr'?{tool:'would-you-rather',questions:state.wyrQuestions,timing:state.wyrTiming}:{tool:'fake-text-story',profile:state.profile,theme:state.theme,messages:state.messages};downloadBlob(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),state.tool==='wyr'?'would-you-rather-project.json':'fake-text-story-project.json');toast('Project JSON saved')}
function downloadBlob(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000)}
function wrapText(ctx,text,maxWidth){let out=[];for(let raw of String(text).split('\n')){let words=raw.split(/\s+/);let line='';for(let word of words){if(!word)continue;let test=line?line+' '+word:word;if(ctx.measureText(test).width<=maxWidth){line=test;continue}if(line)out.push(line);line=word;while(ctx.measureText(line).width>maxWidth&&line.length>1){let len=line.length-1;while(len>1&&ctx.measureText(line.slice(0,len)).width>maxWidth)len--;out.push(line.slice(0,len));line=line.slice(len)}}out.push(line||' ')}return out.length?out:[' ']}
const VIDEO_W=720,VIDEO_H=1280,VIDEO_FPS=30;
function binaryJoin(parts){const size=parts.reduce((n,p)=>n+p.length,0),out=new Uint8Array(size);let i=0;for(const p of parts){out.set(p,i);i+=p.length}return out}
function num8(...v){return new Uint8Array(v)}
function num16(v){return num8((v>>>8)&255,v&255)}
function num32(v){return num8((v>>>24)&255,(v>>>16)&255,(v>>>8)&255,v&255)}
function bytesOf(s){return new TextEncoder().encode(s)}
function mp4Box(type,...parts){let payload=binaryJoin(parts),total=payload.length+8;return binaryJoin([num32(total),bytesOf(type),payload])}
function mp4Full(type,flags,...parts){return mp4Box(type,num8(0,(flags>>16)&255,(flags>>8)&255,flags&255),...parts)}
function mp4Movie(samples,avcDescription,width=VIDEO_W,height=VIDEO_H){
 const W=width,H=height,N=samples.length,TIME=30000,DELTA=1000;
 if(!N||!avcDescription||!avcDescription.byteLength)throw Error('H.264 configuration unavailable');
 const ftyp=mp4Box('ftyp',bytesOf('isom'),num32(512),bytesOf('isomiso2avc1mp41'));
 const mdat=mp4Box('mdat',...samples.map(s=>s.bytes));
 const ident=binaryJoin([num32(0x10000),num32(0),num32(0),num32(0),num32(0x10000),num32(0),num32(0),num32(0),num32(0x40000000)]);
 const mvhd=mp4Full('mvhd',0,num32(0),num32(0),num32(TIME),num32(N*DELTA),num32(0x10000),num16(256),new Uint8Array(10),ident,new Uint8Array(24),num32(2));
 const tkhd=mp4Full('tkhd',7,num32(0),num32(0),num32(1),num32(0),num32(N*DELTA),new Uint8Array(8),num16(0),num16(0),num16(0),num16(0),ident,num32(W*65536),num32(H*65536));
 const mdhd=mp4Full('mdhd',0,num32(0),num32(0),num32(TIME),num32(N*DELTA),num16(0x55c4),num16(0));
 const hdlr=mp4Full('hdlr',0,num32(0),bytesOf('vide'),new Uint8Array(12),bytesOf('VideoHandler\0'));
 const vmhd=mp4Full('vmhd',1,num16(0),num16(0),num16(0),num16(0));
 const dref=mp4Full('dref',0,num32(1),mp4Full('url ',1));
 const dinf=mp4Box('dinf',dref);
 const avcC=mp4Box('avcC',new Uint8Array(avcDescription));
 const avc1=mp4Box('avc1',new Uint8Array(6),num16(1),new Uint8Array(16),num16(W),num16(H),num32(0x00480000),num32(0x00480000),num32(0),num16(1),new Uint8Array(32),num16(24),num16(0xffff),avcC);
 const stsd=mp4Full('stsd',0,num32(1),avc1);
 const stts=mp4Full('stts',0,num32(1),num32(N),num32(DELTA));
 const syncs=samples.map((s,i)=>s.type==='key'?i+1:0).filter(Boolean);
 const stss=mp4Full('stss',0,num32(syncs.length),...syncs.map(num32));
 const stsc=mp4Full('stsc',0,num32(1),num32(1),num32(N),num32(1));
 const stsz=mp4Full('stsz',0,num32(0),num32(N),...samples.map(s=>num32(s.bytes.byteLength)));
 const stco=mp4Full('stco',0,num32(1),num32(ftyp.byteLength+8));
 const stbl=mp4Box('stbl',stsd,stts,stss,stsc,stsz,stco);
 const minf=mp4Box('minf',vmhd,dinf,stbl);
 const mdia=mp4Box('mdia',mdhd,hdlr,minf);
 const trak=mp4Box('trak',tkhd,mdia);
 const moov=mp4Box('moov',mvhd,trak);
 return new Blob([ftyp,mdat,moov],{type:'video/mp4'});
}
// Rasterises the live chat markup, so exports match the preview exactly.
async function exactFrameSnapshot(visibleCount,styles,spriteMarkup){
 const isPlaying=state.playing,playIndex=state.playIndex;
 state.playing=true;state.playIndex=visibleCount;
 const holder=document.createElement('div');
 holder.className='cs-root';
 holder.style.cssText='position:fixed;top:-9999px;left:-9999px;width:256px;height:454px;overflow:hidden;pointer-events:none;background:transparent';
 const preview=document.createElement('div');
 preview.className='phone '+state.theme+' bg-'+state.background;
 preview.style.cssText='width:256px;height:454px;';
 preview.innerHTML=phoneMarkup(false);
 state.playing=isPlaying;state.playIndex=playIndex;
 holder.appendChild(preview);document.body.appendChild(holder);
 const card=preview.querySelector('.storyChat'),chat=preview.querySelector('.chatMessages');
 card.style.transition='none';
 const head=card.firstElementChild.offsetHeight;
 const natural=chat.scrollHeight;
 const height=Math.max(head+8,Math.min(454*.77,head+natural));
 card.style.height=height+'px';
 fitChat(card,chat,head,height);
 preview.querySelector('.playerControls')?.remove();preview.querySelector('.bgVideo')?.remove();
 const phoneMarkupHtml=preview.outerHTML;
 holder.remove();
 const styleXml=styles.replace(/&/g,'&amp;').replace(/</g,'&lt;');
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="256" height="454" viewBox="0 0 256 454"><foreignObject width="256" height="454"><div xmlns="http://www.w3.org/1999/xhtml" class="cs-root" style="height:454px;width:256px;overflow:hidden;background:transparent"><style>${styleXml}</style>${spriteMarkup}${phoneMarkupHtml}</div></foreignObject></svg>`;
 const img=new Image();
 await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error('Unable to render chat appearance to video'));img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg)});
 return {img,height};
}
async function renderSnapSequence(update){
 const count=allLines().length;
 const shots=[];
 for(let i=0;i<=count;i++){
  shots.push(await exactFrameSnapshot(i,css,SPRITE));
  if(update)update(Math.round(7*i/Math.max(1,count)));
 }
 return shots;
}
function drawExactStoryFrame(ctx,shots,seconds,appearanceTimes,bgVideo){
 let n=0;while(n<appearanceTimes.length&&appearanceTimes[n]<=seconds)n++;
 const curr=shots[n],old=shots[Math.max(0,n-1)];
 const appearing=n>0?Math.max(0,Math.min(1,(seconds-appearanceTimes[n-1])/.46)):1;
 const easing=1-Math.pow(1-appearing,3);
 const h=old.height+(curr.height-old.height)*easing;
 ctx.clearRect(0,0,VIDEO_W,VIDEO_H);
 if(bgVideo){ctx.fillStyle='#000';ctx.fillRect(0,0,VIDEO_W,VIDEO_H);drawCover(ctx,bgVideo,VIDEO_W,VIDEO_H)}else if(state.background==='soft'){
  let grad=ctx.createLinearGradient(0,0,VIDEO_W,VIDEO_H);grad.addColorStop(0,'#e9f0ff');grad.addColorStop(1,'#b0c6f5');ctx.fillStyle=grad;
 }else ctx.fillStyle=state.background==='dark'?'#151c2b':'#00ff00';
 if(!bgVideo)ctx.fillRect(0,0,VIDEO_W,VIDEO_H);
 const sx=VIDEO_W/256,sy=VIDEO_H/454;
 const x=25.6*sx,y=454*.11*sy,w=204.8*sx,height=h*sy;
 ctx.save();ctx.shadowColor='#00000033';ctx.shadowBlur=7*sx;ctx.shadowOffsetY=2*sy;
 ctx.beginPath();ctx.roundRect(x,y,w,height,11*sx);ctx.fillStyle=state.theme.startsWith('whatsapp')?(state.theme.endsWith('light')?'#efeae2':'#0b141a'):(state.theme.endsWith('light')?'#fff':'#000');ctx.fill();ctx.restore();
 ctx.save();ctx.beginPath();ctx.roundRect(x,y,w,height,11*sx);ctx.clip();ctx.drawImage(curr.img,0,0,VIDEO_W,VIDEO_H);ctx.restore();
}
// MediaRecorder MP4 has variable timestamps; repackage its H.264 samples as constant 30 fps.
function remuxRecorderToCfr(arraybuffer,width=VIDEO_W,height=VIDEO_H){
 const data=new Uint8Array(arraybuffer),view=new DataView(arraybuffer);
 const U32=at=>view.getUint32(at,false),I32=at=>view.getInt32(at,false);
 const fourcc=at=>String.fromCharCode(data[at],data[at+1],data[at+2],data[at+3]);
 const children=(start,end)=>{let result=[];while(start+8<=end){let size=U32(start),type=fourcc(start+4);if(size===0)size=end-start;if(size===1||size<8||start+size>end)break;result.push({start,end:start+size,size,type});start+=size}return result};
 const root=children(0,data.byteLength),moov=root.find(b=>b.type==='moov');
 if(!moov)throw Error('The recorder did not produce a valid MP4');
 const avcIndex=(()=>{for(let at=moov.start+8;at<moov.end-8;at++)if(fourcc(at)==='avcC')return at;return -1})();
 if(avcIndex<4)throw Error('MP4 H.264 configuration was not found');
 const avcSize=U32(avcIndex-4);
 const avcDesc=data.slice(avcIndex+4,avcIndex-4+avcSize);
 let samples=[];
 for(const moof of root.filter(b=>b.type==='moof')){
  const traf=children(moof.start+8,moof.end).find(b=>b.type==='traf');
  if(!traf)continue;
  const child=children(traf.start+8,traf.end);
  const tfhd=child.find(b=>b.type==='tfhd'),trun=child.find(b=>b.type==='trun');
  if(!tfhd||!trun)continue;
  const fhdFlags=U32(tfhd.start+8)&0xffffff,flags=U32(trun.start+8)&0xffffff;
  let defaultSampleSize=0,tfhdPos=tfhd.start+16;
  if(fhdFlags&1)tfhdPos+=8;
  if(fhdFlags&2)tfhdPos+=4;
  if(fhdFlags&8)tfhdPos+=4;
  if(fhdFlags&16){defaultSampleSize=U32(tfhdPos);tfhdPos+=4}
  let pos=trun.start+12,count=U32(pos);pos+=4;
  let chunkPos=moof.start;
  if(flags&1){chunkPos=moof.start+I32(pos);pos+=4}
  let firstFlags=0;
  if(flags&4){firstFlags=U32(pos);pos+=4}
  for(let j=0;j<count;j++){
   if(flags&0x100)pos+=4;
   const size=(flags&0x200)?U32(pos):defaultSampleSize;
   if(flags&0x200)pos+=4;
   let sampleFlags=j===0?firstFlags:0;
   if(flags&0x400){sampleFlags=U32(pos);pos+=4}
   if(flags&0x800)pos+=4;
   if(!size||chunkPos+size>data.byteLength)throw Error('Invalid frame size in browser MP4');
   samples.push({bytes:data.slice(chunkPos,chunkPos+size),type:(sampleFlags&0x10000)?'delta':'key'});
   chunkPos+=size;
  }
 }
 if(!samples.length)throw Error('No H.264 frames found in browser MP4');
 return mp4Movie(samples,avcDesc,width,height);
}

async function renderMp4(){
 if(state.tool==='wyr')return renderWyrMp4();
 if(!allLines().length){toast('Add messages before exporting');return}
 const btn=$('makeVideo');if(!btn)return;
 if(!HTMLCanvasElement.prototype.captureStream&&typeof VideoEncoder==='undefined'){toast('Video encoding is not available in this browser');return}
 btn.disabled=true;
 const block=$('exportProgressBlock'),label=$('progressLabel');block.classList.remove('hidden');
 const progress=(n,msg)=>exportProgress(n,msg);
 let stream=null;
 try{
  progress(0,'Preparing visuals');
  if(!(await ensureTextSpeech()))throw Error('The voiceover could not be generated');
  const shots=await renderSnapSequence(n=>progress(n,'Preparing visuals'));
  const canvas=document.createElement('canvas');canvas.width=VIDEO_W;canvas.height=VIDEO_H;
  const ctx=canvas.getContext('2d',{alpha:false});
  let times=[],moment=.35;for(const m of allLines()){times.push(moment);moment+=getMessageSeconds(m)+.45}
  const count=Math.ceil((getTotalDuration()+1.3)*VIDEO_FPS);
  const lines=allLines(),plan=state.audio.enabled?lines.map((m,i)=>({buffer:speechFor(m)?.buffer,at:times[i],rate:state.audio.speed})).filter(p=>p.buffer):[];
  const bgUrl=state.background==='video'&&state.gameplay?state.gameplay.videoUrl:null;
  if(plan.length||bgUrl){
    const bg=bgUrl?await loadBgVideo(bgUrl):null;
    const out=await recordRealtime({canvas,count,fps:VIDEO_FPS,draw:t=>{drawExactStoryFrame(ctx,shots,t,times,bg)},plan,progress,label:plan.length?'Recording video + voiceover':'Recording video',bgVideo:bg});
    progress(100,'Finished');downloadBlob(out.blob,'fake-text-story.'+out.ext);toast('Exported'+(plan.length?' with voiceover':'')+' · '+out.ext.toUpperCase());
    return;
  }
  const canUseWebCodecs=typeof VideoEncoder!=='undefined'&&typeof VideoFrame!=='undefined'&&(await VideoEncoder.isConfigSupported({codec:'avc1.42001f',width:VIDEO_W,height:VIDEO_H,bitrate:3500000,framerate:VIDEO_FPS,avc:{format:'avc'}})).supported;
  if(canUseWebCodecs){
    let samples=[],codecDescription=null,encodeError=null;
    const encoder=new VideoEncoder({
      output:(chunk,meta)=>{let bytes=new Uint8Array(chunk.byteLength);chunk.copyTo(bytes);samples.push({type:chunk.type,bytes,timestamp:chunk.timestamp});if(meta?.decoderConfig?.description)codecDescription=meta.decoderConfig.description;},
      error:e=>{encodeError=e}
    });
    encoder.configure({codec:'avc1.42001f',width:VIDEO_W,height:VIDEO_H,bitrate:3500000,framerate:VIDEO_FPS,avc:{format:'avc'},latencyMode:'quality'});
    for(let i=0;i<count;i++){
      if(encodeError)throw encodeError;
      drawExactStoryFrame(ctx,shots,i/VIDEO_FPS,times);
      const frame=new VideoFrame(canvas,{timestamp:Math.round(i*1000000/VIDEO_FPS),duration:Math.round(1000000/VIDEO_FPS)});
      encoder.encode(frame,{keyFrame:i%60===0});frame.close();
      if(i%10===0){progress(7+Math.round(i/count*85),'Encoding MP4');await new Promise(r=>setTimeout(r,0))}
      if(encoder.encodeQueueSize>12)await encoder.flush();
    }
    await encoder.flush();encoder.close();if(encodeError)throw encodeError;
    samples.sort((a,b)=>a.timestamp-b.timestamp);
    const mp4=mp4Movie(samples,codecDescription);
    progress(100,'Finished');downloadBlob(mp4,'fake-text-story-30fps.mp4');toast('MP4 exported at exactly 30 FPS');
  }else{
    const mime=['video/mp4;codecs=avc1.42E01E','video/mp4;codecs=avc1.42001f','video/mp4'].find(x=>window.MediaRecorder?.isTypeSupported(x));
    if(!mime)throw Error('H.264 MP4 recording is unsupported in this browser.');
    stream=canvas.captureStream(0);
    const track=stream.getVideoTracks()[0],chunks=[];
    const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:4000000});
    const done=new Promise((resolve,reject)=>{recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};recorder.onerror=e=>reject(e.error||Error('MP4 recorder error'));recorder.onstop=()=>resolve()});
    recorder.start();
    const start=performance.now();
    for(let i=0;i<count;i++){
      const target=start+i*1000/VIDEO_FPS,delay=target-performance.now();if(delay>1)await new Promise(r=>setTimeout(r,delay));
      drawExactStoryFrame(ctx,shots,i/VIDEO_FPS,times);track.requestFrame?.();
      if(i%6===0)progress(7+Math.round(i/count*85),'Recording MP4');
    }
    await new Promise(r=>setTimeout(r,130));recorder.stop();await done;
    if(!chunks.length)throw Error('No video frames were recorded');
    const captured=new Blob(chunks,{type:'video/mp4'});
    const exactMp4=remuxRecorderToCfr(await captured.arrayBuffer());
    progress(100,'Finished');downloadBlob(exactMp4,'fake-text-story-30fps.mp4');
    toast('MP4 exported at exactly 30 FPS');
  }
 }catch(e){console.error('MP4 export failed',e);toast('MP4 export failed: '+(e?.message||String(e)));if(label)label.textContent='Export failed: '+(e?.message||String(e));}
 finally{btn.disabled=false;if(stream)stream.getTracks().forEach(t=>t.stop())}
}

function voiceBlock(id,label,voice){return `<div class="voiceRow"><label for="${id}">${label}</label><div class="voiceControl"><select id="${id}" class="promptSelect">${voiceOptions(voice)}</select><button type="button" class="outlineBtn" data-preview="${id}">${icons('play','sm')} Preview</button></div></div>`}
function renderSilenceSettings(){const au=state.audio;
 editor.innerHTML=`<div class="inner quietInner"><header class="pagehead"><h1>Audio & Timing</h1></header><section class="timingCard"><div class="timingBadge">${icons('volume','lg')}</div><div><h2>Voiceover</h2><p>Every message is spoken by a text-to-speech voice, and the message timing follows the real speech length. The voiceover is included in your MP4.</p></div></section><div class="timingList"><div class="timingRow"><div class="timingTop"><label>Voiceover</label><button class="sideSwitch ${au.enabled?'sender':''}" id="voiceToggle" aria-label="Toggle voiceover"><span class="sideKnob">${icons('volume','sm')}</span></button></div></div>${voiceBlock('contactVoice','Contact voice',au.contactVoice)}${voiceBlock('userVoice','Your voice',au.userVoice)}<div class="timingRow"><div class="timingTop"><label for="voiceSpeed">Speech speed</label><output id="voiceSpeedOut">${au.speed.toFixed(2)}×</output></div><input type="range" id="voiceSpeed" min="0.8" max="1.5" step="0.05" value="${au.speed}"></div></div><div class="quietStats" style="margin:10px 10px 0;gap:36px"><div><span>Messages</span><strong>${allLines().length}</strong></div><div><span>Duration</span><strong id="durStat">${displayDuration(getTotalDuration())}</strong></div><div><span>Export</span><strong>MP4 · 30 fps${au.enabled?' · audio':''}</strong></div></div><div style="display:flex;gap:10px;align-items:center;margin:16px 10px"><button class="quietPreview" id="genVoice">${icons('audio','sm')} Generate voiceover</button><button class="quietPreview" id="restartStory">${icons('play','sm')} Play preview</button><span class="quietFine" id="voiceStatus" style="margin:0"></span></div></div>`;
 const refresh=()=>{const d=$('durStat');if(d)d.textContent=displayDuration(getTotalDuration())};
 $('voiceToggle').onclick=()=>{au.enabled=!au.enabled;$('voiceToggle').classList.toggle('sender',au.enabled);stopPlayback();refresh()};
 $('contactVoice').onchange=e=>{au.contactVoice=e.target.value;stopPlayback();refresh()};
 $('userVoice').onchange=e=>{au.userVoice=e.target.value;stopPlayback();refresh()};
 $('voiceSpeed').oninput=e=>{au.speed=Number(e.target.value);$('voiceSpeedOut').textContent=au.speed.toFixed(2)+'×';refresh()};
 editor.querySelectorAll('[data-preview]').forEach(b=>b.onclick=()=>previewVoice($(b.dataset.preview).value,b));
 $('genVoice').onclick=async()=>{const b=$('genVoice');b.disabled=true;const ok=await ensureTextSpeech();b.disabled=false;const st=$('voiceStatus');if(st)st.textContent=ok?'Voiceover ready.':'';refresh();if(ok)toast('Voiceover ready · '+displayDuration(getTotalDuration()))};
 $('restartStory').onclick=startPlayback;
}
function renderWyrEditor(){
 editor.innerHTML=`<div class="inner wyrInner"><header class="pagehead"><h1>Questions</h1><div class="topButtons"><span class="questionCount">${state.wyrQuestions.length} questions</span><button class="pill primary" id="wyrAi" type="button">AI Writer</button></div></header><div class="questionScroller" id="questionScroller"></div><button class="addMessage addQuestion" id="addQuestion">+ &nbsp;Add Question</button></div>`;
 renderWyrQuestionList();editor.querySelector('#wyrAi').onclick=wyrWriterModal;editor.querySelector('#addQuestion').onclick=()=>{state.wyrQuestions.push({id:state.wyrNextId++,a:'New choice A',b:'New choice B',percent:50,label:true});renderWyrQuestionList();editor.querySelector('#questionScroller').scrollTop=editor.querySelector('#questionScroller').scrollHeight;stopWyr();renderWyrPreview();toast('Question added')};
}
function wyrWriterModal(){
 writerModal({title:'AI Writer',intro:'The AI writes a set of would-you-rather rounds. Vote splits are simulated, and you can edit everything afterwards.',kind:'would-rather',
  fields:`<label for="wMode">Style</label><select id="wMode" class="promptSelect" data-extra="mode">${['classic','funny','impossible','relationship','gaming','food','dark-humour'].map(m=>`<option value="${m}">${m.replace('-',' ')}</option>`).join('')}</select>`,
  sample(){state.wyrQuestions=[{a:'Be able to fly',b:'Be able to turn invisible',percent:55},{a:'Never use social media again',b:'Never watch another movie',percent:40},{a:'Always be 10 minutes late',b:'Always be 20 minutes early',percent:35}].map(q=>({...q,id:state.wyrNextId++,label:true}));stopWyr();renderWyrQuestionList();renderWyrPreview()},
  apply(script){state.wyrQuestions=script.rounds.map(r=>({id:state.wyrNextId++,a:r.left,b:r.right,percent:Math.max(0,Math.min(100,Math.round(r.leftPercent))),label:true}));stopWyr();renderWyrQuestionList();renderWyrPreview()}});
}
function renderWyrQuestionList(keep=false){const sc=editor.querySelector('#questionScroller');if(!sc)return;const label=editor.querySelector('.questionCount');if(label)label.textContent=state.wyrQuestions.length+' question'+(state.wyrQuestions.length===1?'':'s');const previous=keep?sc.scrollTop:0;
 sc.innerHTML=state.wyrQuestions.map((q,i)=>`<section class="questionCard" data-qid="${q.id}"><div class="questionTop"><span>Question ${i+1}</span><span class="qNumber">${String(i+1).padStart(2,'0')}</span></div><div class="questionLine"><label class="qChoiceField"><span class="qDot red"></span><input aria-label="Question ${i+1} option A" data-qa="${q.id}" value="${escapeHtml(q.a)}" maxlength="160" placeholder="First option"></label><label class="qChoiceField"><span class="qDot blue"></span><input aria-label="Question ${i+1} option B" data-qb="${q.id}" value="${escapeHtml(q.b)}" maxlength="160" placeholder="Second option"></label><button class="actionRound questionTrash" title="Delete question ${i+1}" aria-label="Delete question ${i+1}" data-qdel="${q.id}">${icons('trash')}</button></div><div class="questionMore"><div class="voteSliderWrap"><div class="voteSliderLabels"><span class="sliderA"><i></i> A <b data-pcta="${q.id}">${q.percent}%</b></span><span class="sliderB">B <b data-pctb="${q.id}">${100-q.percent}%</b><i></i></span></div><input type="range" class="voteRange" min="0" max="100" step="1" data-percent="${q.id}" value="${q.percent}" style="--fill:${q.percent}%" aria-label="Option A votes percentage (Option B is the remainder)"></div><button class="sideSwitch ${q.label?'sender':''}" data-qlabel="${q.id}" aria-label="Show question label"><span class="sideKnob">${icons('message','sm')}</span></button><span class="toggleLabel">Question</span></div></section>`).join('');sc.scrollTop=previous;
 const get=id=>state.wyrQuestions.find(q=>q.id===Number(id));
 sc.querySelectorAll('[data-qa]').forEach(el=>el.oninput=()=>{get(el.dataset.qa).a=el.value;paintWyrAt(state.wyrTime)});
 sc.querySelectorAll('[data-qb]').forEach(el=>el.oninput=()=>{get(el.dataset.qb).b=el.value;paintWyrAt(state.wyrTime)});
 sc.querySelectorAll('[data-percent]').forEach(el=>el.oninput=()=>{let q=get(el.dataset.percent);q.percent=Math.min(100,Math.max(0,Math.round(Number(el.value)||0)));el.style.setProperty('--fill',q.percent+'%');sc.querySelector(`[data-pcta="${q.id}"]`).textContent=q.percent+'%';sc.querySelector(`[data-pctb="${q.id}"]`).textContent=(100-q.percent)+'%';paintWyrAt(state.wyrTime)});
 sc.querySelectorAll('[data-qlabel]').forEach(el=>el.onclick=()=>{let q=get(el.dataset.qlabel);q.label=!q.label;el.classList.toggle('sender',q.label);paintWyrAt(state.wyrTime)});
 sc.querySelectorAll('[data-qdel]').forEach(el=>el.onclick=()=>{if(state.wyrQuestions.length===1){toast('Keep at least one question');return}state.wyrQuestions=state.wyrQuestions.filter(q=>q.id!==Number(el.dataset.qdel));stopWyr();renderWyrQuestionList(true);renderWyrPreview();});
}
function renderWyrSettings(){const cfg=state.wyrTiming;
 editor.innerHTML=`<div class="inner quietInner"><header class="pagehead"><h1>Audio & Timing</h1></header><section class="timingCard"><div class="timingBadge">${icons('audio','lg')}</div><div><h2>Set the pace</h2><p>Fine-tune how your choices appear, how long the countdown lasts, and when the vote results display. Video and export are silent.</p></div></section><div class="timingList"><div class="timingRow"><div class="timingTop"><label>Voiceover</label><button class="sideSwitch ${state.wyrVoice.enabled?'sender':''}" id="wyrVoiceToggle" aria-label="Toggle voiceover"><span class="sideKnob">${icons('volume','sm')}</span></button></div></div>${voiceBlock('wyrVoiceSel','Voice',state.wyrVoice.voice)}<div class="timingRow"><div class="timingTop"><label for="wyrSpeed">Speech speed</label><output id="wyrSpeedOut">${state.wyrVoice.speed.toFixed(2)}×</output></div><input type="range" id="wyrSpeed" min="0.8" max="1.5" step="0.05" value="${state.wyrVoice.speed}"></div>${[{id:'countdown',title:'Countdown',min:2,max:8,step:1,unit:'seconds'},{id:'results',title:'Show results for',min:1,max:6,step:.2,unit:'seconds'},{id:'gap',title:'Transition between questions',min:.2,max:2,step:.05,unit:'seconds'}].map(it=>`<div class="timingRow"><div class="timingTop"><label for="time-${it.id}">${it.title}</label><output id="out-${it.id}">${cfg[it.id]} s</output></div><input type="range" id="time-${it.id}" data-timing="${it.id}" min="${it.min}" max="${it.max}" step="${it.step}" value="${cfg[it.id]}"></div>`).join('')}</div><div class="silenceNotice">${icons('check','sm')} The voice reads each option, then the countdown and vote results play. <span id="voiceStatus"></span></div><button class="quietPreview" id="startWyrFromAudio">${icons('play','sm')} Preview with voice</button></div>`;
 $('wyrVoiceToggle').onclick=()=>{state.wyrVoice.enabled=!state.wyrVoice.enabled;$('wyrVoiceToggle').classList.toggle('sender',state.wyrVoice.enabled);stopWyr();renderWyrPreview()};
 $('wyrVoiceSel').onchange=e=>{state.wyrVoice.voice=e.target.value;stopWyr();renderWyrPreview()};
 $('wyrSpeed').oninput=e=>{state.wyrVoice.speed=Number(e.target.value);$('wyrSpeedOut').textContent=state.wyrVoice.speed.toFixed(2)+'×';stopWyr();renderWyrPreview()};
 editor.querySelectorAll('[data-preview]').forEach(b=>b.onclick=()=>previewVoice($(b.dataset.preview).value,b));
 editor.querySelectorAll('[data-timing]').forEach(el=>el.oninput=()=>{const id=el.dataset.timing;state.wyrTiming[id]=Number(el.value);editor.querySelector('#out-'+id).textContent=el.value+' s';stopWyr();renderWyrPreview()});
 editor.querySelector('#startWyrFromAudio').onclick=startWyr;
}
function wyrQ(q){const t=state.wyrTiming,first=.48,r=state.wyrVoice.speed;const sp=wyrSpeech(q);let second=1.33,count=2.45;
 if(sp){second=Math.max(1.33,first+sp.a.dur/r+.3);count=Math.max(2.45,second+sp.b.dur/r+.5)}
 return {first,second,count,reveal:count+t.countdown,one:count+t.countdown+t.results+t.gap}}
function wyrOffsets(){let o=0;return state.wyrQuestions.map(q=>{const d=wyrQ(q),r={off:o,d};o+=d.one;return r})}
function wyrDuration(){return state.wyrQuestions.reduce((a,q)=>a+wyrQ(q).one,0)}
function getWyrFrame(time){const offs=wyrOffsets(),total=wyrDuration(),t=Math.min(Math.max(0,time),Math.max(0,total-1/30));let n=offs.findIndex(x=>t<x.off+x.d.one);if(n<0)n=offs.length-1;return {q:state.wyrQuestions[n],index:n,time:t-offs[n].off,d:offs[n].d,duration:total}}
function wyrEvents(){const out=[];wyrOffsets().forEach((o,i)=>{const sp=wyrSpeech(state.wyrQuestions[i]);if(!sp)return;out.push({t:o.off+o.d.first,item:sp.a},{t:o.off+o.d.second,item:sp.b})});return out}
function easeOut(t){t=Math.max(0,Math.min(1,t));return 1-Math.pow(1-t,3)}
function wyrStages(frame){const t=frame.time,d=frame.d;return {a:easeOut((t-d.first)/.52),b:easeOut((t-d.second)/.52),countdown:t>=d.count&&t<d.reveal,number:Math.max(1,Math.ceil(d.reveal-t)),revealed:t>=d.reveal,progress:easeOut((t-d.reveal)/.48)};}
let wyrRaf=0,wyrToken=0;
function renderWyrPreview(){right.innerHTML=`<div class="previewHead"><h2>Video Preview</h2></div><div class="phoneSpace"><div class="phone wyrPhone" id="wyrPhone">${wyrPhoneMarkup()}</div></div>`;bindWyrControls(right);paintWyrAt(state.wyrTime)}
function wyrPhoneMarkup(){return `<div class="wyrStages"><div class="wyrHalf wyrTop"><div class="wyrChoice" data-top-content><span class="wyrOverline" data-top-overline>OPTION A</span><div class="wyrOption" data-opt-a></div><div class="wyrVote" data-vote-a><strong data-percent-a>50%</strong><span class="wyrVoteBar"><i data-bar-a></i></span></div></div></div><div class="wyrHalf wyrBottom"><div class="wyrChoice" data-bottom-content><span class="wyrOverline" data-bottom-overline>OPTION B</span><div class="wyrOption" data-opt-b></div><div class="wyrVote" data-vote-b><strong data-percent-b>50%</strong><span class="wyrVoteBar"><i data-bar-b></i></span></div></div></div><div class="wyrMiddle"><span data-wyr-middle>OR</span></div><span class="wyrQuestionTag" data-qtag></span></div><div class="playerControls"><button class="playButton" data-wyr-control="play" aria-label="Play or pause preview">${icons(state.wyrPlaying?'pause':'play','lg')}</button><span class="timeStamp" data-wyr-clock>0:00 / ${displayDuration(wyrDuration())}</span><button class="playButton fullScreen" data-wyr-control="full" title="Open fullscreen preview" aria-label="Open fullscreen preview">${icons('full','lg')}</button><div class="rangeTrack wyrSeek" title="Seek through video"><div class="rangeFill" data-wyr-fill style="width:0%"></div><input class="transportSeek" type="range" min="0" max="${wyrDuration()}" value="${state.wyrTime}" step="0.01" data-wyr-seek aria-label="Scrub Would You Rather timeline"></div></div>`}
function bindWyrControls(parent){parent.querySelectorAll('[data-wyr-control]').forEach(btn=>btn.onclick=()=>btn.dataset.wyrControl==='play'?(state.wyrPlaying?stopWyr(true):startWyr()):($('wyrModalPhone')?closeDialog():openFullscreen()));parent.querySelectorAll('[data-wyr-seek]').forEach(el=>{el.addEventListener('pointerdown',()=>stopWyr(true));el.oninput=()=>{const seekTo=Number(el.value);stopWyr(true);state.wyrTime=Math.max(0,Math.min(wyrDuration(),seekTo));paintWyrAt(state.wyrTime)}})}
function paintWyrAt(t){const frame=getWyrFrame(t),st=wyrStages(frame);const q=frame.q;if(!q)return;
 host.querySelectorAll('.wyrPhone').forEach(paint);overlay.querySelectorAll('.wyrPhone').forEach(paint);
 function paint(ph){
 const A=ph.querySelector('[data-top-content]'),B=ph.querySelector('[data-bottom-content]');if(!A||!B)return;
 ph.querySelector('[data-opt-a]').textContent=q.a;ph.querySelector('[data-opt-b]').textContent=q.b;
 const transformA=(1-st.a)*-26,transformB=(1-st.b)*26;
 A.style.opacity=st.a;A.style.transform=`translateX(${transformA}px)`;B.style.opacity=st.b;B.style.transform=`translateX(${transformB}px)`;
 const middle=ph.querySelector('[data-wyr-middle]'),outer=ph.querySelector('.wyrMiddle');middle.textContent=st.countdown?String(st.number):'OR';outer.classList.toggle('isCounting',st.countdown);outer.classList.toggle('isResults',st.revealed);
 ph.querySelector('[data-percent-a]').textContent=q.percent+'%';ph.querySelector('[data-percent-b]').textContent=(100-q.percent)+'%';
 ph.querySelector('[data-vote-a]').classList.toggle('isWinner',q.percent>50);ph.querySelector('[data-vote-a]').classList.toggle('isLoser',q.percent<50);
 ph.querySelector('[data-vote-b]').classList.toggle('isWinner',q.percent<50);ph.querySelector('[data-vote-b]').classList.toggle('isLoser',q.percent>50);
 for(const key of ['a','b']){let wrap=ph.querySelector('[data-vote-'+key+']');wrap.style.opacity=st.revealed?st.progress:0;wrap.style.transform=`translateY(${st.revealed?(1-st.progress)*10:10}px)`;ph.querySelector('[data-bar-'+key+']').style.width=(st.revealed?(key==='a'?q.percent:100-q.percent)*st.progress:0)+'%'}
 ph.querySelector('[data-qtag]').textContent=q.label&&st.a>0?'QUESTION '+(frame.index+1):'';
 let time=ph.querySelector('[data-wyr-clock]');if(time)time.textContent=`${displayDuration(t)} / ${displayDuration(wyrDuration())}`;
 let fill=ph.querySelector('[data-wyr-fill]');if(fill)fill.style.width=(wyrDuration()?Math.min(100,t/wyrDuration()*100):0)+'%';const seek=ph.querySelector('[data-wyr-seek]');if(seek){seek.max=wyrDuration();if(document.activeElement!==seek)seek.value=String(t)}
 const play=ph.querySelector('[data-wyr-control="play"]');if(play)play.innerHTML=icons(state.wyrPlaying?'pause':'play','lg');
 }
}
async function startWyr(){if(!state.wyrQuestions.length||state.wyrPlaying)return;
 if(!(await ensureWyrSpeech()))return;
 cancelAnimationFrame(wyrRaf);wyrToken++;const tok=wyrToken;state.wyrPlaying=true;if(state.wyrTime>=wyrDuration()-.05)state.wyrTime=0;
 const origin=performance.now()-state.wyrTime*1000,events=wyrEvents();
 const tick=now=>{if(tok!==wyrToken||destroyed)return;const prev=state.wyrTime;state.wyrTime=Math.min(wyrDuration(),(now-origin)/1000);
  for(const e of events)if(e.t>prev&&e.t<=state.wyrTime)playSpeech(e.item,state.wyrVoice.speed);
  paintWyrAt(state.wyrTime);if(state.wyrTime<wyrDuration())wyrRaf=requestAnimationFrame(tick);else{state.wyrPlaying=false;paintWyrAt(state.wyrTime)}};
 wyrRaf=requestAnimationFrame(tick);paintWyrAt(state.wyrTime)}
function stopWyr(keep=false){wyrToken++;cancelAnimationFrame(wyrRaf);stopAudio();state.wyrPlaying=false;if(!keep)state.wyrTime=0;paintWyrAt(state.wyrTime)}
async function openWyrFullscreen(){if($('wyrModalPhone'))return;
 modalRoot.innerHTML=`<div class="dialogShade fullShade" id="shade"><button class="closeFull" id="closeFull" aria-label="Exit fullscreen">×</button><div class="dialog"><div class="phone wyrPhone full" id="wyrModalPhone">${wyrPhoneMarkup()}</div></div></div>`;
 modalRoot.querySelector('#closeFull').onclick=closeDialog;modalRoot.querySelector('#shade').onclick=e=>{if(e.target.id==='shade')closeDialog()};bindWyrControls(modalRoot);
 const shade=modalRoot.querySelector('#shade');try{if(shade.requestFullscreen)await shade.requestFullscreen({navigationUI:'hide'})}catch(e){}paintWyrAt(state.wyrTime);
}
function drawWyrFrame(ctx,seconds){const w=VIDEO_W,h=VIDEO_H,frame=getWyrFrame(seconds),st=wyrStages(frame),q=frame.q;
 ctx.clearRect(0,0,w,h);ctx.fillStyle='#eb0803';ctx.fillRect(0,0,w,h/2);ctx.fillStyle='#0589dc';ctx.fillRect(0,h/2,w,h/2);
 const white='#fff';ctx.textAlign='center';ctx.textBaseline='middle';
 function drawSide(top){const a=top?st.a:st.b;if(a<.001)return;const y=top?h*.278:h*.72;const txt=top?q.a:q.b;ctx.save();ctx.globalAlpha=a;ctx.translate((top?-26:26)*(1-a)*w/256,0);
 if(q.label){ctx.font='600 29px Arial';ctx.fillStyle='#ffffffc9';ctx.fillText(top?'OPTION A':'OPTION B',w/2,y-155)}
 ctx.fillStyle=white;ctx.font='bold 61px Arial';const rows=wrapText(ctx,txt,w*.83);const lineHeight=72,start=y-(rows.length-1)*lineHeight/2;rows.forEach((r,i)=>ctx.fillText(r,w/2,start+i*lineHeight));
 if(st.revealed){ctx.globalAlpha=a*st.progress;ctx.font='bold 92px Arial';const pct=top?q.percent:100-q.percent;ctx.shadowColor='#0b122666';ctx.shadowBlur=12;ctx.fillStyle=pct>50?'#49ee8f':pct<50?'#ff616e':'#ffffff';ctx.fillText(pct+'%',w/2,y+112);ctx.shadowBlur=0;}
 ctx.restore();}
 drawSide(true);drawSide(false);
 ctx.fillStyle='#111';ctx.fillRect(0,h/2-10,w,20);
 ctx.fillStyle='#070707';ctx.beginPath();ctx.arc(w/2,h/2,62,0,Math.PI*2);ctx.fill();ctx.fillStyle='#fff';ctx.font='bold 47px Arial';ctx.fillText(st.countdown?String(st.number):'OR',w/2,h/2+2);
}
async function encodeWyrVideo(){const btn=$('makeVideo');if(!btn)return;btn.disabled=true;
 const b=$('exportProgressBlock');b?.classList.remove('hidden');const progress=exportProgress;
 let stream=null;
 try{
 const canvas=document.createElement('canvas');canvas.width=VIDEO_W;canvas.height=VIDEO_H;const ctx=canvas.getContext('2d',{alpha:false});
 progress(0,'Preparing video');if(!(await ensureWyrSpeech()))throw Error('The voiceover could not be generated');const count=Math.ceil(wyrDuration()*VIDEO_FPS);const plan=state.wyrVoice.enabled?wyrEvents().map(e=>({buffer:e.item.buffer,at:e.t,rate:state.wyrVoice.speed})):[];if(plan.length){const out=await recordRealtime({canvas,count,fps:VIDEO_FPS,draw:t=>drawWyrFrame(ctx,t),plan,progress,label:'Recording video + voiceover'});progress(100,'Export complete');downloadBlob(out.blob,'would-you-rather.'+out.ext);toast('Exported with voiceover · '+out.ext.toUpperCase());return}
 const support=typeof VideoEncoder!=='undefined'&&typeof VideoFrame!=='undefined'&&(await VideoEncoder.isConfigSupported({codec:'avc1.42001f',width:VIDEO_W,height:VIDEO_H,bitrate:3500000,framerate:VIDEO_FPS,avc:{format:'avc'}})).supported;
 if(support){let samples=[],description=null,error=null;const enc=new VideoEncoder({output:(chunk,meta)=>{const bytes=new Uint8Array(chunk.byteLength);chunk.copyTo(bytes);samples.push({type:chunk.type,bytes,timestamp:chunk.timestamp});if(meta?.decoderConfig?.description)description=meta.decoderConfig.description},error:e=>{error=e}});
 enc.configure({codec:'avc1.42001f',width:VIDEO_W,height:VIDEO_H,bitrate:3500000,framerate:VIDEO_FPS,avc:{format:'avc'},latencyMode:'quality'});
 for(let i=0;i<count;i++){if(error)throw error;drawWyrFrame(ctx,i/VIDEO_FPS);const frame=new VideoFrame(canvas,{timestamp:Math.round(i*1e6/VIDEO_FPS),duration:Math.round(1e6/VIDEO_FPS)});enc.encode(frame,{keyFrame:i%60===0});frame.close();if(i%15===0){progress(5+Math.round(90*i/count),'Encoding MP4');await new Promise(r=>setTimeout(r,0))}if(enc.encodeQueueSize>12)await enc.flush()}
 await enc.flush();enc.close();if(error)throw error;samples.sort((a,b)=>a.timestamp-b.timestamp);downloadBlob(mp4Movie(samples,description),'would-you-rather-30fps.mp4');
 }else{
 const mime=['video/mp4;codecs=avc1.42E01E','video/mp4;codecs=avc1.42001f','video/mp4'].find(x=>window.MediaRecorder?.isTypeSupported(x));if(!mime)throw Error('MP4 encoding is unsupported in this browser');
 stream=canvas.captureStream(0);const track=stream.getVideoTracks()[0],chunks=[];const rec=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:4000000});const done=new Promise((resolve,reject)=>{rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};rec.onerror=e=>reject(e.error||Error('Encoding failed'));rec.onstop=resolve});rec.start();const start=performance.now();
 for(let i=0;i<count;i++){const delay=start+i*1000/VIDEO_FPS-performance.now();if(delay>1)await new Promise(r=>setTimeout(r,delay));drawWyrFrame(ctx,i/VIDEO_FPS);track.requestFrame?.();if(i%8===0)progress(5+Math.round(i/count*90),'Recording MP4')}
 await new Promise(r=>setTimeout(r,130));rec.stop();await done;const captured=new Blob(chunks,{type:'video/mp4'});downloadBlob(remuxRecorderToCfr(await captured.arrayBuffer()),'would-you-rather-30fps.mp4');
 }
 progress(100,'Export complete');toast('MP4 saved · 30 FPS');
 }catch(e){console.error(e);progress(0,'Export failed: '+(e?.message||e));toast('Export failed: '+(e?.message||e))}finally{btn.disabled=false;if(stream)stream.getTracks().forEach(t=>t.stop())}
}
async function renderWyrMp4(){return encodeWyrVideo()}

/* ---------------- AI Clipper ---------------- */
const clipStyles=[['Bold yellow','yellow'],['Clean white','white'],['Mint accent','mint'],['Violet pop','violet'],['Outline classic','outline'],['Minimal','simple'],['Cyan energy','cyan'],['Neon green','neon'],['Black captions','black']];
let clipObjectURL=null;
function youtubeId(raw){try{const u=new URL(raw);const host=u.hostname.toLowerCase().replace(/^www\./,'').replace(/^m\./,'');let id='';if(host==='youtu.be')id=u.pathname.split('/')[1];else if(['youtube.com','youtube-nocookie.com'].includes(host)){id=u.searchParams.get('v')||u.pathname.match(/^\/(?:shorts|embed|live)\/([^/?]+)/)?.[1]||''}return /^[\w-]{11}$/.test(id)?id:null}catch{return null}}
function clipHasYouTube(){return state.clipper.source==='youtube'&&!!state.clipper.youtubeId}
function clipHasLocal(){return state.clipper.source==='file'&&!!clipObjectURL}
function clipPreviewMarkup(){const c=state.clipper;
 const video=clipHasLocal()?`<video class="clipSourceVideo" preload="metadata" playsinline src="${escapeHtml(clipObjectURL)}"></video>`:clipHasYouTube()?`<iframe class="clipYoutubeFrame" src="https://www.youtube.com/embed/${c.youtubeId}?controls=1&playsinline=1&rel=0" title="YouTube video preview" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`:`<div class="clipEmptyCanvas"></div>`;
 return `<div class="clipVisualHolder"><div class="clipVisualFrame ratio-16-9" id="clipVisualFrame">${video}</div></div>
 ${clipHasLocal()?`<div class="clipTransport v9Transport"><button class="clipPlayCtl" data-clip-play title="Play or pause" aria-label="Play or pause video">${icons('play')}</button><span class="clipNowPlaying">${icons('check','sm')} Video ready to preview</span><button class="clipFullBtn" data-clip-full title="Fullscreen" aria-label="Fullscreen video preview">${icons('full')}</button></div>`:clipHasYouTube()?`<div class="clipTransport v9Transport"><span class="clipNowPlaying">YouTube preview</span><button class="clipFullBtn" data-clip-full title="Fullscreen" aria-label="Fullscreen video preview">${icons('full')}</button></div>`:''}`;
}
function clipBindPreview(root){const c=state.clipper;const v=root.querySelector('.clipSourceVideo'),play=root.querySelector('[data-clip-play]');
 if(v){const update=()=>{c.currentTime=v.currentTime;if(play)play.innerHTML=icons(v.paused?'play':'pause')};
  v.onloadedmetadata=()=>{if(!c.duration&&isFinite(v.duration)){c.duration=v.duration;c.end=Math.min(v.duration,60)}update()};
  v.ontimeupdate=()=>{if(v.currentTime>=c.end&&c.end>c.start){v.pause()}update()};v.onplay=update;v.onpause=update;
  if(play)play.onclick=()=>{if(v.paused){if(v.currentTime>=c.end-.02)v.currentTime=c.start;v.play().catch(()=>toast('This browser cannot play the selected video'))}else v.pause()};
 }
 root.querySelectorAll('[data-clip-full]').forEach(btn=>btn.onclick=async()=>{const box=root.querySelector('.appleVideoWell')||root;try{if(document.fullscreenElement)await document.exitFullscreen();else await box.requestFullscreen({navigationUI:'hide'})}catch{toast('Fullscreen is not available in this browser')}});
}

function clipperHeader(title,subtitle){return `<header class="clipperPageHeader applePageHeader"><div class="appleHeaderTop"><div class="clipBreadcrumb"><span>Creator Studio</span><span class="appleCrumbChevron">${icons('chev-right','sm')}</span><span>AI Clipper</span></div><span class="appleStepCount">Step ${state.step+1} of 5</span></div><h1>${title}</h1><p>${subtitle}</p></header>`}
const captionFonts=[['Impact','Impact'],['Arial Black','Arial Black'],['System Sans','Arial'],['Rounded','Trebuchet MS'],['Editorial Serif','Georgia'],['Monospace','Courier New']];
const clipStyleDefaultColors=['#fff236','#ffffff','#a5ffdd','#bd70ff','#ffffff','#ffffff','#3fe5ee','#42ff83','#ffffff'];
const clipFormatMarkup=()=>[['9:16','Vertical'],['1:1','Square'],['16:9','Landscape']].map(([v,label])=>`<button type="button" data-format="${v}" class="${state.clipper.format===v?'chosen':''}"><span>${v}</span><small>${label}</small></button>`).join('');
function clipMockStage(key){const c=state.clipper;
 return `<div class="mockStage blankPreviewStage v9BlankStage" data-mock-stage="${key}"><button type="button" class="v9Fullscreen" data-mock-full title="Fullscreen blank canvas" aria-label="Fullscreen blank canvas">${icons('full','sm')}</button><div class="mockCanvasHolder"><div class="mockVideoShell ratio-${c.format.replace(':','-')}" aria-label="Blank ${escapeHtml(c.format)} output preview"></div></div></div>`;
}
function bindMockStage(root){const s=root.querySelector('[data-mock-stage]');if(!s)return;
 const btn=s.querySelector('[data-mock-full]');if(btn)btn.onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await s.requestFullscreen({navigationUI:'hide'})}catch{toast('Fullscreen unavailable in this browser')}};
}
function renderClipperSource(){const c=state.clipper,has=clipHasLocal()||clipHasYouTube();
 editor.innerHTML=`<div class="clipperPage appleClipPage appleImport v9Page">${clipperHeader('Import Video','Upload a video or connect a YouTube link to begin.')}
 <div class="appleImportLayout v9ImportGrid">
 <section class="appleSourceSurface v9Source"><div class="v9SectionHead"><strong>Video source</strong><span>MP4 · MOV · WEBM</span></div>
 <div class="appleUpload v9Drop" id="clipDropzone" role="button" tabindex="0" aria-label="Upload video"><div class="v9UploadGlyph">${icons('upload','lg')}</div><h2>Drop your video here</h2><p>Drag a file into this space or choose one below.</p><button type="button" class="appleBrowse v9Browse" id="appleBrowseBtn">Choose video ${icons('chev-right','sm')}</button><small>Imported securely into your browser</small></div>
 <div class="v9Divider"><span></span><b>OR</b><span></span></div>
 <form id="clipYtForm" class="v9YouTube"><div class="v9YouTubeTitle"><svg class="youtubeBrandSVG" viewBox="0 0 32 23" aria-label="YouTube" role="img"><path fill="#FF0033" d="M31.3 3.57A4 4 0 0 0 28.48.73C25.99.06 16 .06 16 .06S6.01.06 3.52.73A4 4 0 0 0 .7 3.57 41.62 41.62 0 0 0 0 11.5c0 2.65.23 5.31.7 7.93a4 4 0 0 0 2.82 2.84C6.01 22.94 16 22.94 16 22.94s9.99 0 12.48-.67a4 4 0 0 0 2.82-2.84 41.62 41.62 0 0 0 .7-7.93 41.62 41.62 0 0 0-.7-7.93Z"/><path fill="#fff" d="m12.8 16.3 8.4-4.8-8.4-4.8v9.6Z"/></svg><strong>Import from YouTube</strong><span>Video or Shorts</span></div><div class="v9YouTubeInput"><input type="url" id="clipYoutubeUrl" value="${escapeHtml(c.url||'')}" placeholder="https://youtube.com/watch?v=..." aria-label="YouTube URL"><button type="submit" title="Load video" aria-label="Load video">${icons('arrow-up-right','sm')}<span>Load</span></button></div></form>
 <div class="v9Privacy">${icons('check','sm')} No account or server required for local imports.</div>
 <input type="file" class="hidden" id="clipFilePicker" accept="video/*,.mov,.mp4,.m4v,.webm" />
 </section>
 <aside class="appleImportViewer v9Viewer"><div class="v9SectionHead"><strong>Preview</strong><span class="v9Pill ${has?'v9PillReady':''}">${has?'Ready':'Awaiting source'}</span></div>
 <div class="appleVideoWell v9VideoWell">${has?clipPreviewMarkup():`<div class="v9PreviewEmpty" aria-label="No source video uploaded"></div>`}</div>
 <div class="v9MediaMeta"><span title="${escapeHtml(c.fileName||'')}">${has?escapeHtml(c.fileName||'YouTube video'):'Your video will appear here'}</span>${clipHasYouTube()?`<a href="https://www.youtube.com/watch?v=${c.youtubeId}" target="_blank" rel="noopener">Open on YouTube ${icons('arrow-up-right','sm')}</a>`:clipHasLocal()?`<span>${displayDuration(c.duration)}</span>`:''}</div>
 </aside></div></div>`;
 const input=editor.querySelector('#clipFilePicker');input.onchange=()=>{if(input.files?.[0])loadClipFile(input.files[0])};
 const drop=editor.querySelector('#clipDropzone');drop.onclick=e=>{if(e.target.closest('button'))return;input.click()};
 editor.querySelector('#appleBrowseBtn').onclick=e=>{e.stopPropagation();input.click()};
 drop.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();input.click()}};
 drop.ondragover=e=>{e.preventDefault();drop.classList.add('dragActive')};drop.ondragleave=()=>drop.classList.remove('dragActive');drop.ondrop=e=>{e.preventDefault();drop.classList.remove('dragActive');if(e.dataTransfer.files?.[0])loadClipFile(e.dataTransfer.files[0])};
 editor.querySelector('#clipYtForm').onsubmit=e=>{e.preventDefault();loadYouTube(editor.querySelector('#clipYoutubeUrl').value.trim())};
 clipBindPreview(editor);
}
async function loadYouTube(url){const c=state.clipper,id=youtubeId(url);if(!id){toast('Enter a valid YouTube or Shorts URL');return false}
 toast('Checking the video…');
 try{const res=await fetch('/api/shorts/source/inspect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url})});const d=await res.json();if(!res.ok||!d.ok)throw Error(d.error||'That link could not be inspected');
  if(destroyed)return false;c.url=url;c.youtubeId=d.source.videoId||id;c.source='youtube';c.ytInfo=d.source;c.fileName=d.source.title||'YouTube video';c.duration=(d.source.durationMs||0)/1000;c.currentTime=0;render(true);toast('YouTube video loaded · '+displayDuration(c.duration));return true}
 catch(e){toast(e.message);return false}}
function uploadFile(file,onProgress){return new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('POST','/api/clipper/upload?filename='+encodeURIComponent(file.name));xhr.setRequestHeader('Content-Type',file.type||'video/mp4');xhr.upload.onprogress=e=>{if(e.lengthComputable)onProgress(e.loaded/e.total)};xhr.onload=()=>{try{const b=JSON.parse(xhr.responseText);if(xhr.status<300&&b.ok&&b.uploadId)resolve(b);else reject(Error(b.error||'Upload failed'))}catch{reject(Error('Upload failed'))}};xhr.onerror=()=>reject(Error('Upload failed. Check the connection.'));xhr.send(file)})}
function setUploadUI(){const c=state.clipper,pill=editor.querySelector('.v9Viewer .v9Pill');if(!pill)return;pill.className='v9Pill '+(c.uploadState==='ready'?'v9PillReady':'');pill.textContent=c.uploadState==='uploading'?'Uploading '+Math.round(c.uploadPct*100)+'%':c.uploadState==='ready'?'Ready':c.uploadState==='error'?'Upload failed':'Awaiting source'}
async function loadClipFile(file){
 if(!/\.(mp4|mov|webm|m4v|mkv)$/i.test(file.name)&&!file.type.startsWith('video/')){toast('Choose an MP4, MOV, M4V, WebM or MKV video');return}
 if(clipObjectURL)URL.revokeObjectURL(clipObjectURL);clipObjectURL=URL.createObjectURL(file);
 const c=state.clipper;Object.assign(c,{fileName:file.name,source:'file',start:0,end:0,duration:0,currentTime:0,uploadId:null,uploadState:'uploading',uploadPct:0,ytInfo:null,youtubeId:null});clipRun.cards=[];clipRun.status='idle';
 render(true);setUploadUI();
 try{const up=await uploadFile(file,f=>{c.uploadPct=f;setUploadUI()});
  c.uploadState='probing';const pr=await fetch('/api/shorts/source/probe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uploadId:up.uploadId,name:up.name})});const pd=await pr.json();if(!pr.ok||!pd.ok)throw Error(pd.error||'The video could not be read');
  if(destroyed)return;c.uploadId=up.uploadId;c.probeMs=pd.probe.durationMs;c.duration=pd.probe.durationMs/1000;c.uploadState='ready';if(state.tool==='clipper'&&state.step===0){render(false)}toast('Video ready · '+displayDuration(c.duration))}
 catch(e){c.uploadState='error';if(!destroyed){setUploadUI();toast(e.message)}}
}
const clipRun={status:'idle',stage:'',message:'',pct:0,cards:[],error:'',jobId:null,abort:null,log:[]};
const CLIP_GOALS=[['auto','Auto','viral'],['viral','Viral moments','viral'],['educational','Educational','educational'],['funny','Funny','funny'],['controversial','Debate','opinions'],['storytelling','Storytelling','emotional'],['highlights','Highlights','highlights'],['custom','Custom','']];
const CLIP_LENGTHS=[['auto','Auto',60],['15-30','15–30s',30],['30-60','30–60s',45],['60-90','60–90s',75],['90-180','90s–3m',120]];
const CLIP_COUNTS=[['auto','Auto',3],['3','3',3],['5','5',5],['10','10',10]];
const CLIP_LAYOUTS=[['auto','Auto','auto'],['single','Single speaker','single_speaker'],['two','Two speakers','multi_speaker'],['presentation','Presentation','keep_all'],['gameplay','Gameplay','keep_all']];
Object.assign(state.clipper,{goal:'auto',customPrompt:'',length:'auto',count:'auto',layout:'auto',captionsOn:true,removeFillers:true,uploadId:null,uploadPct:0,uploadState:'idle',ytInfo:null});
function clipReady(){const c=state.clipper;return c.source==='file'?!!c.uploadId&&c.uploadState==='ready':!!c.ytInfo}
function clipSourceMs(){const c=state.clipper;return c.source==='youtube'?(c.ytInfo?.durationMs||0):(c.probeMs||c.duration*1000||0)}
function chipRow(name,options,current){return `<div class="clipFormats wrapChips" data-chips="${name}">${options.map(([v,l])=>`<button type="button" data-val="${v}" class="${current===v?'chosen':''}" aria-pressed="${current===v}">${l}</button>`).join('')}</div>`}
function bindChips(name,set){editor.querySelectorAll(`[data-chips="${name}"] button`).forEach(b=>b.onclick=()=>{set(b.dataset.val);editor.querySelectorAll(`[data-chips="${name}"] button`).forEach(x=>{x.classList.toggle('chosen',x===b);x.setAttribute('aria-pressed',String(x===b))})})}
function toggleRow(id,label,hint,on){return `<div class="voiceRow"><div><label>${label}</label><div class="hintLine">${hint}</div></div><button class="sideSwitch ${on?'sender':''}" id="${id}" aria-label="${label}"><span class="sideKnob">${icons('check','sm')}</span></button></div>`}
function engineConfig(){const c=state.clipper;
 const goal=c.goal==='custom'?(c.customPrompt.trim()||'viral'):CLIP_GOALS.find(g=>g[0]===c.goal)[2];
 const seconds=CLIP_LENGTHS.find(l=>l[0]===c.length)[2],count=CLIP_COUNTS.find(l=>l[0]===c.count)[2];
 const cfg={moment_type:goal,clip_duration:seconds,clip_count:count,aspect_ratio:c.format,render_quality:'premium',captions_enabled:c.captionsOn,burn_captions:c.captionsOn,remove_fillers:c.removeFillers,clip_name:'clip',auto_reframe:true,
  face_tracking:{enabled:true,mode:'smooth',allowZoom:false,smartReframe:true,reframeMode:CLIP_LAYOUTS.find(l=>l[0]===c.layout)[2],speakerMode:'auto',trackingQuality:'high_quality'}};
 if(c.wordMode==='single')cfg.subtitle_style='word';
 return cfg}
function renderClipperMoments(){const c=state.clipper,ms=clipSourceMs();
 editor.innerHTML=`<div class="clipperPage appleClipPage v9Page">${clipperHeader('Choose Your Moments','Tell the AI what to look for and how the clips should be framed.')}
 <div class="appleWorkLayout v9WorkGrid"><section class="appleSettingsSide v9Settings"><div class="appleSettingsScroller" style="overflow:auto;flex:1;min-height:0;padding-right:4px"><div class="v9SectionHead"><strong>Clip settings</strong><span>02 / 04</span></div>
 <div class="v9SettingGroup"><div class="v9GroupTitle"><strong>What should it find?</strong><small>Clip goal</small></div>${chipRow('goal',CLIP_GOALS.map(g=>[g[0],g[1]]),c.goal)}<input id="clipCustom" class="appleTextField v9Input ${c.goal==='custom'?'':'hidden'}" style="margin-top:10px;width:100%" maxlength="300" placeholder="e.g. moments where they explain why startups fail" value="${escapeHtml(c.customPrompt)}"></div>
 <div class="v9SettingGroup"><div class="v9GroupTitle"><strong>Length</strong><small>Per clip</small></div>${chipRow('length',CLIP_LENGTHS.map(l=>[l[0],l[1]]),c.length)}</div>
 <div class="v9SettingGroup"><div class="v9GroupTitle"><strong>How many clips</strong><small>Up to</small></div>${chipRow('count',CLIP_COUNTS.map(l=>[l[0],l[1]]),c.count)}</div>
 <div class="v9SettingGroup"><div class="v9GroupTitle"><strong>Aspect ratio</strong><small>Output frame</small></div><div class="clipFormats appleAspectPicker v9AspectPicker">${clipFormatMarkup()}</div></div>
 <div class="v9SettingGroup"><div class="v9GroupTitle"><strong>Framing</strong><small>Smart reframe layout</small></div>${chipRow('layout',CLIP_LAYOUTS.map(l=>[l[0],l[1]]),c.layout)}</div></div></section>
 <aside class="appleWorkspacePreview v9Output"><div class="v9SectionHead"><strong>Source</strong><span class="v9Pill v9PillReady">${ms?displayDuration(ms/1000):'Ready'}</span></div><div class="appleVideoWell v9VideoWell">${clipPreviewMarkup()}</div><div class="v9MediaMeta"><span title="${escapeHtml(c.fileName||'')}">${escapeHtml(c.fileName||'Video')}</span><span>${ms>25*60000?'Long video: fast scan first':'Full analysis'}</span></div></aside></div></div>`;
 bindChips('goal',v=>{c.goal=v;$('clipCustom').classList.toggle('hidden',v!=='custom')});bindChips('length',v=>c.length=v);bindChips('count',v=>c.count=v);bindChips('layout',v=>c.layout=v);
 $('clipCustom').oninput=e=>c.customPrompt=e.target.value;
 editor.querySelectorAll('[data-format]').forEach(x=>x.onclick=()=>{c.format=x.dataset.format;editor.querySelectorAll('[data-format]').forEach(y=>y.classList.toggle('chosen',x===y))});
 clipBindPreview(editor);
}
function renderClipperCaptions(){const c=state.clipper;
 editor.innerHTML=`<div class="clipperPage appleClipPage v9Page">${clipperHeader('Captions','Burned-in captions are generated from the real transcript and timed word by word.')}
 <div class="appleWorkLayout v9WorkGrid"><section class="appleCaptionSettings v9Settings"><div class="v9SectionHead"><strong>Caption options</strong><span>03 / 04</span></div>
 ${toggleRow('capToggle','Burn in captions','Word-timed captions rendered into the video.',c.captionsOn)}
 <div class="v9SettingGroup" style="margin-top:6px"><div class="v9GroupTitle"><strong>Display mode</strong><small>Subtitle pacing</small></div><div class="appleModeOptions"><button type="button" class="appleMode ${c.wordMode==='single'?'chosen':''}" data-wordmode="single" aria-pressed="${c.wordMode==='single'}"><span><strong>One word at a time</strong><small>Fast, punchy captions.</small></span>${icons('check','sm')}</button><button type="button" class="appleMode ${c.wordMode==='group'?'chosen':''}" data-wordmode="group" aria-pressed="${c.wordMode==='group'}"><span><strong>Engine default</strong><small>Let the clipper pick the caption layout.</small></span>${icons('check','sm')}</button></div></div>
 ${toggleRow('fillerToggle','Remove filler words','Cuts “um”, “uh” and long pauses.',c.removeFillers)}
 <div class="v9SubtleCallout">${icons('spark','sm')} Fine-tune fonts, colours and animations in the Shorts editor after generating.</div></section>
 <aside class="appleWorkspacePreview v9Output"><div class="v9SectionHead"><strong>Output frame</strong><span class="v9Pill">${escapeHtml(c.format)}</span></div><div class="mockStage blankPreviewStage v9BlankStage"><div class="mockCanvasHolder"><div class="mockVideoShell ratio-${c.format.replace(':','-')}"><div class="sampleCaption">${c.captionsOn?(c.wordMode==='single'?'<b>EVERY</b>':'MAKE <b>EVERY</b> SECOND'):''}</div></div></div></div><div class="v9PreviewNote">${c.captionsOn?'Captions on':'Captions off'} · sample layout</div></aside></div></div>`;
 const refresh=()=>{const sc=editor.querySelector('.sampleCaption');if(sc)sc.innerHTML=c.captionsOn?(c.wordMode==='single'?'<b>EVERY</b>':'MAKE <b>EVERY</b> SECOND'):'';const n=editor.querySelector('.v9PreviewNote');if(n)n.textContent=(c.captionsOn?'Captions on':'Captions off')+' · sample layout'};
 $('capToggle').onclick=()=>{c.captionsOn=!c.captionsOn;$('capToggle').classList.toggle('sender',c.captionsOn);refresh()};
 $('fillerToggle').onclick=()=>{c.removeFillers=!c.removeFillers;$('fillerToggle').classList.toggle('sender',c.removeFillers)};
 editor.querySelectorAll('[data-wordmode]').forEach(btn=>btn.onclick=()=>{c.wordMode=btn.dataset.wordmode;editor.querySelectorAll('[data-wordmode]').forEach(x=>{x.classList.toggle('chosen',x===btn);x.setAttribute('aria-pressed',String(x===btn))});refresh()});
}
const clipBase=p=>String(p||'').split(/[\\/]/).pop();
const clipSecs=v=>{if(typeof v==='number')return v;const m=String(v||'').split(':').map(Number);return m.some(isNaN)?0:m.reduce((a,x)=>a*60+x,0)};
function renderClipperClips(){const c=state.clipper,r=clipRun;
 const head=clipperHeader('Your Clips',r.cards.length?'Preview, download or refine each clip in the editor.':'Generate AI-selected, reframed and captioned clips from your video.');
 let body='';
 if(r.status==='running'){body=`<div class="clipRunCard"><div class="ringWrap"><svg class="exportRing" viewBox="0 0 90 90"><circle class="ringBack" cx="45" cy="45" r="36"></circle><circle class="ringMeter" id="clipRing" cx="45" cy="45" r="36" style="stroke-dashoffset:${226.2*(1-r.pct/100)}"></circle></svg><span id="ringPct">${Math.round(r.pct)}%</span></div><div class="exportTaskLabel" id="clipStage">${escapeHtml((r.message||'Starting')+(r.sub?' — '+r.sub:''))}</div><div class="clipLog" id="clipLog">${r.log.slice(-6).map(escapeHtml).join('<br>')}</div><button class="outlineBtn" id="clipCancel">Cancel</button></div>`}
 else if(r.status==='error'||r.status==='cancelled'){body=`<div class="clipRunCard"><div class="exportTaskLabel" style="color:${r.status==='error'?'#d92c27':'#5b6c86'}">${escapeHtml(r.status==='error'?(r.error||'The clipper failed.'):'Cancelled')}</div><button class="pill primary" id="clipRetry">Try again</button></div>`}
 else if(r.cards.length){body=`<div class="clipResults">${r.cards.map((k,i)=>{const res=k.result,name=clipBase(res.output),score=res.score??res.clip_potential_score??res.virality_score;return `<article class="clipResult" data-i="${i}"><div class="clipThumb"><video src="/api/clipper/media/${encodeURIComponent(name)}" muted loop playsinline preload="metadata"></video></div><div class="clipInfo"><strong>${escapeHtml(res.title||'Clip '+(i+1))}</strong><small>${escapeHtml(res.clip_duration||'')}${score!=null?' · score '+Math.round(score):''}</small><p>${escapeHtml((res.reason||'').slice(0,110))}</p><div class="clipActions"><a class="outlineBtn" href="/api/clipper/download/${encodeURIComponent(name)}" download>Download</a><button class="outlineBtn" data-open="${i}">${k.busy?'Opening…':'Open in editor'}</button><button class="outlineBtn" data-cedit="${i}">Clyra Editor</button></div></div></article>`}).join('')}</div>`}
 else{const ms=clipSourceMs();body=`<div class="clipRunCard idle"><div class="timingBadge">${icons('spark','lg')}</div><h2>Ready to find clips</h2><p>${escapeHtml(c.fileName||'Your video')} · ${ms?displayDuration(ms/1000):'—'} · goal ${escapeHtml(CLIP_GOALS.find(g=>g[0]===c.goal)[1])} · ${escapeHtml(c.format)} · ${c.captionsOn?'with captions':'no captions'}</p><button class="pill primary" id="clipGo">Generate clips</button></div>`}
 editor.innerHTML=`<div class="clipperPage appleClipPage v9Page">${head}<div style="flex:1;min-height:0;overflow:auto">${body}</div></div>`;
 $('clipGo')?.addEventListener('click',startClipRun);$('clipRetry')?.addEventListener('click',startClipRun);$('clipCancel')?.addEventListener('click',cancelClipRun);
 editor.querySelectorAll('.clipResult video').forEach(v=>{const card=v.closest('.clipResult');card.onmouseenter=()=>v.play().catch(()=>{});card.onmouseleave=()=>{v.pause();v.currentTime=0}});
 editor.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>openClipInEditor(Number(b.dataset.open)));
 editor.querySelectorAll('[data-cedit]').forEach(b=>b.onclick=()=>{const k=clipRun.cards[Number(b.dataset.cedit)];if(!k)return;if(!opts.openEditor){toast('The Clyra Editor is not available here');return}opts.openEditor({items:[{kind:'clipper',file:clipBase(k.result.output)}],name:k.result.title||'AI clip'})});
 stepNav();
}
function paintClipRun(){if(state.tool!=='clipper'||state.step!==3)return;const r=clipRun;const ring=$('clipRing');if(ring)ring.style.strokeDashoffset=String(226.2*(1-r.pct/100));const pct=$('ringPct');if(pct)pct.textContent=Math.round(r.pct)+'%';const st=$('clipStage');if(st)st.textContent=(r.message||'')+(r.sub?' — '+r.sub:'');const lg=$('clipLog');if(lg)lg.innerHTML=r.log.slice(-6).map(escapeHtml).join('<br>')}
/* Follows a clip job's event stream for the first connection, any reconnection, and a page that was reloaded
 * mid-job: if the stream drops while the job is still running, the page reattaches and replays only the events it
 * missed, so no clip result is lost. The running job is remembered so reopening the clipper finds it again. */
const ACTIVE_CLIP_JOB='clyra.clipper.activeJob';
async function followClipJob(first,r){
  let seen=0;
  const consume=async(res)=>{
   const reader=res.body.getReader(),dec=new TextDecoder();let buf='';
   for(;;){const {value,done}=await reader.read();if(done||destroyed)break;buf+=dec.decode(value,{stream:true});const frames=buf.split('\n\n');buf=frames.pop()||'';
    for(const f of frames){const line=f.split('\n').find(x=>x.startsWith('data: '));if(!line)continue;seen++;let ev;try{ev=JSON.parse(line.slice(6))}catch{continue}
     if(ev.type==='job'&&ev.jobId)r.jobId=String(ev.jobId);
     else if(ev.type==='clip_result'&&ev.result?.output){if(!r.cards.some(k=>k.result.output===ev.result.output))r.cards.push({result:ev.result});}
     else if(ev.type==='progress'){r.message=String(ev.message||r.message);r.sub='';if(typeof ev.overall==='number')r.pct=Math.max(r.pct,ev.overall);if(ev.message&&r.log[r.log.length-1]!==String(ev.message))r.log.push(String(ev.message))}
     else if(ev.type==='log'&&ev.message){
      /* Long steps print terminal progress bars ("51%|█████ | 102896/201584 [03:39<03:30, ...]"): show them as one tidy
         sub-status on the current step instead of a scrolling wall of bar characters. */
      const text=String(ev.message);const bars=[...text.matchAll(/(\d{1,3})%\|[^|\n]*\|[^\[\n]*\[[\d:]+<([\d:]+)/g)];const bare=[...text.matchAll(/(\d{1,3})%\|/g)];
      if(bars.length||bare.length){const last=bars[bars.length-1];r.sub=last?`${last[1]}% · ${last[2]} left`:`${bare[bare.length-1][1]}%`}
      else if(!/^(INFO|WARNING|[WIE]\d{4}|\s)/.test(text))r.log.push(text.slice(0,160));}
     else if(ev.type==='error'){r.status='error';r.error=String(ev.message||'The clipper failed.').split('\n')[0].slice(0,240)}
     else if(ev.type==='cancelled'){r.status='cancelled'}
     else if(ev.type==='complete'){if(r.status!=='error')r.status='done';r.pct=100}
     paintClipRun()}}
  };
  const remember=()=>{try{if(r.jobId&&r.status==='running')localStorage.setItem(ACTIVE_CLIP_JOB,JSON.stringify({jobId:r.jobId,at:Date.now(),title:state.clipper.fileName||''}));else localStorage.removeItem(ACTIVE_CLIP_JOB)}catch{}};
  const consumeAndRemember=async(res)=>{const pending=consume(res);const timer=setInterval(remember,2000);try{await pending}finally{clearInterval(timer);remember()}};
  let attempts=0;
  for(let res=first;;){
   try{await consumeAndRemember(res)}catch(err){if(r.abort?.signal.aborted)throw err}
   if(r.status!=='running'||destroyed||r.abort?.signal.aborted||!r.jobId||attempts>=8)break;
   attempts++;r.sub='reconnecting…';paintClipRun();
   await new Promise(done=>setTimeout(done,Math.min(8000,800*attempts)));
   const again=await fetch('/api/clipper/jobs/'+encodeURIComponent(r.jobId)+'/events?from='+seen,{signal:r.abort.signal}).catch(()=>null);
   if(!again||again.status===404)break;if(!again.ok||!again.body)continue;res=again;
  }
  try{if(r.status!=='running')localStorage.removeItem(ACTIVE_CLIP_JOB)}catch{}
}
/* Reopening the clipper while a job from earlier is still running picks it back up where it is. */
async function resumeClipJob(){let saved=null;try{saved=JSON.parse(localStorage.getItem(ACTIVE_CLIP_JOB)||'null')}catch{}
 if(!saved?.jobId||Date.now()-saved.at>6*3600_000||clipRun.status==='running')return false;
 const res=await fetch('/api/clipper/jobs/'+encodeURIComponent(saved.jobId)+'/events?from=0').catch(()=>null);
 if(!res||!res.ok||!res.body){try{localStorage.removeItem(ACTIVE_CLIP_JOB)}catch{};return false}
 const r=clipRun;Object.assign(r,{status:'running',message:'Reconnecting to your clip job…',pct:0,cards:[],error:'',jobId:saved.jobId,log:[]});r.abort=new AbortController();
 if(saved.title&&!state.clipper.fileName)state.clipper.fileName=saved.title;
 state.step=3;render(true);
 try{await followClipJob(res,r);if(r.status==='running')r.status=r.cards.length?'done':'error',r.error=r.cards.length?'':'The clipper finished without producing any clips.'}catch(e){if(!r.abort?.signal.aborted){r.status='error';r.error=e.message||'The clipper failed.'}}
 if(!destroyed&&state.tool==='clipper')renderClipperClips();return true}
async function startClipRun(){const c=state.clipper,r=clipRun;
 if(r.status==='running')return;if(!clipReady()){toast('Add a video first');setStep(0);return}
 if(c.goal==='custom'&&!c.customPrompt.trim()){toast('Describe the moments you want, or pick another goal');setStep(1);return}
 if(state.step!==3)state.step=3;
 Object.assign(r,{status:'running',message:'Starting',pct:0,cards:[],error:'',jobId:null,log:[]});r.abort=new AbortController();renderClipperClips();
 const body=c.source==='youtube'?{url:c.ytInfo.url,config:engineConfig()}:{uploadId:c.uploadId,config:engineConfig()};
 try{
  const first=await fetch('/api/clipper/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:r.abort.signal});
  if(!first.ok||!first.body){const d=await first.json().catch(()=>({}));throw Error(d.error||'The clipper could not start ('+first.status+')')}
  await followClipJob(first,r);
  if(r.status==='running')r.status=r.cards.length?'done':'error',r.error=r.cards.length?'':'The clipper finished without producing any clips.';
 }catch(e){if(r.abort?.signal.aborted)r.status='cancelled';else{r.status='error';r.error=e.message||'The clipper failed.'}}
 if(!destroyed&&state.tool==='clipper')renderClipperClips();
}
function cancelClipRun(){const r=clipRun;if(r.jobId)fetch('/api/clipper/jobs/'+encodeURIComponent(r.jobId)+'/cancel',{method:'POST'}).catch(()=>{});r.abort?.abort()}
async function openClipInEditor(i){const k=clipRun.cards[i],c=state.clipper;if(!k||k.busy)return;if(!opts.openProject){toast('Open the Shorts editor from the Projects library to refine clips');return}
 k.busy=true;renderClipperClips();
 try{const res=k.result;const payload={output:clipBase(res.output),title:res.title||'AI clip',reason:res.reason,caption:res.caption,hashtags:res.hashtags,rank:res.rank,score:res.score??res.clip_potential_score??res.virality_score??null,scoreBreakdown:res.score_breakdown,sourceUrl:c.source==='youtube'?c.ytInfo.url:undefined,sourceTitle:res.source_title||c.fileName,sourceStart:res.source_start,sourceEnd:res.source_end,words:res.words,subtitlesBurned:Boolean(res.subtitles_burned),aspect:c.format};
  const r=await fetch('/api/shorts/clips/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||'Import failed');
  opts.openProject(d.project.id)}catch(e){k.busy=false;toast('Could not open the editor: '+e.message);if(state.tool==='clipper')renderClipperClips()}
}
listen(window,'keydown',e=>{if(e.key==='Escape'&&modalRoot.innerHTML)closeDialog()});
render();
if(opts.youtubeUrl&&state.tool==='clipper')loadYouTube(opts.youtubeUrl);
if(state.tool==='clipper'&&!opts.youtubeUrl)void resumeClipJob();

return {
  destroy(){
    if(destroyed)return;destroyed=true;
    try{stopAll()}catch{}
    cancelAnimationFrame(textFrame);cancelAnimationFrame(wyrRaf);clearTimeout(activeTimeout);
    resizeObserver.disconnect();disposers.forEach(fn=>fn());
    if(document.fullscreenElement&&overlay.contains(document.fullscreenElement))document.exitFullscreen().catch(()=>{});
    if(clipObjectURL)URL.revokeObjectURL(clipObjectURL);
    overlay.remove();host.innerHTML='';host.classList.remove('cs-root');
  },
};
}

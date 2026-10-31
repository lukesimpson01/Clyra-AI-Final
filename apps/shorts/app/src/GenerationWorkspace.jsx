import React, {useEffect, useRef, useState} from 'react';
import {
  ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronDown, CloudUpload,
  FileAudio, FileImage, FileVideo, Film, Image as ImageIcon, LoaderCircle,
  MoreHorizontal, Music2, Pause, Play, Plus, RotateCcw, Scissors, Sparkles,
  WandSparkles, X
} from 'lucide-react';
import './generation.css';

const select = (label, choices, initial=choices[0]) => ({label, type:'select', choices, initial});
const toggle = (label, initial=false) => ({label, type:'toggle', initial});
const entry = (label, placeholder='', initial='') => ({label, type:'text', placeholder, initial});
const area = (label, placeholder='', initial='') => ({label, type:'area', placeholder, initial});

const configs = {
  'AutoClip': {
    eyebrow:'AUTOCLIP', heading:'Turn one long video into ready to post clips',
    description:'Upload a podcast, stream or interview. Find the best moments and prepare finished clips you can still edit.',
    kind:'video', image:'autoclip.webp', action:'New autoclip', library:'Your autoclips',
    stages:['Preparing your video','Finding the strongest moments','Framing the speaker','Captions, title, grade'],
    fields:[select('How many clips',['3 clips','5 clips','10 clips','20 clips'],'5 clips'),
      select('Clip length',['15–30 seconds','30–60 seconds','60–90 seconds'],'30–60 seconds'),
      select('What is in it',['Podcast or interview','Stream','Talking head','Other']),
      select('Lead-in',['Automatic','Short','Standard','Long']),
      select('Spoken language',['English','Spanish','French','German','Auto-detect']),
      entry('Focus (optional)','e.g. only the parts about pricing'),
      select('Style',['Viral','Clean','Bold','Classic','Matte']),
      select('Intensity',['Subtle','Balanced','Dynamic','Max'],'Balanced'),
      select('Layout',['Fullscreen','Streamer','Split','Letterbox']),
      toggle('Captions',true),toggle('Title',true),toggle('Speaker framing',true),
      toggle('Zooms',true),toggle('Remove filler words'),toggle('Remove silences'),
      toggle('Transitions'),toggle('Sound effects'),toggle('Music bed'),toggle('Grade')]
  },
  'Find viral moments': {
    eyebrow:'FIND MOMENTS', heading:'Find the best moments in any long video',
    description:'Search a long recording for strong moments, then review before saving.',
    kind:'video', image:'find-moments.webp', action:'New search', library:'Your moment searches',
    stages:['Listening','Finding moments','Scoring moments','Getting your clips ready'],
    fields:[select('Find up to',['3 moments','5 moments','10 moments','20 moments'],'5 moments'),
      select('Moment length',['15–30 seconds','30–60 seconds','60–90 seconds']),
      select('What is in it',['Podcast or interview','Stream','Talking head','Other']),
      select('Spoken language',['English','Spanish','French','German','Auto-detect']),
      entry('Focus (optional)','A topic, question or keyword'),
      select('Saving',['Review before saving','Save automatically'])]
  },
  'Edit with AI': {
    eyebrow:'AI EDIT', heading:'Turn raw clips into finished edits',
    description:'Choose clips, add captions and a title, and decide how much editing energy to add.',
    kind:'video', image:'ai-edit.webp', action:'New AI edit', library:'Your AI edits',
    stages:['Reading your clips','Building the edit','Adding captions and a title','Finishing touches'],
    fields:[select('Style',['Viral','Clean','Bold','Classic','Matte']),
      select('Intensity',['Subtle','Balanced','Dynamic','Max'],'Balanced'),
      select('Spoken language',['English','Spanish','French','German','Auto-detect']),
      select('Layout',['Fullscreen','Streamer','Split','Letterbox']),
      toggle('Captions',true),toggle('Title',true),toggle('Speaker framing',true),
      toggle('Zooms',true),toggle('Remove filler words'),toggle('Remove silences'),
      toggle('Transitions'),toggle('Sound effects'),toggle('Music bed'),toggle('Grade')]
  },
  'Cut & Crop': {
    eyebrow:'CLIP CUTTER', heading:'Cut a long video into clips',
    description:'Mark the parts you want, then edit them with AI after.',
    kind:'video', image:'editor.webp', action:'Create clip', library:'Your cuts',
    stages:['Preparing your clips','Cutting the marked moments','Framing your video','Saving clips'],
    fields:[entry('Clip title','A name for this cut'),select('Layout',['Fullscreen','Streamer','Split','Letterbox']),
      select('Aspect ratio',['9:16','16:9','1:1','4:5']),toggle('Edit them with AI after')]
  },
  'Reddit Story Video': {
    eyebrow:'REDDIT STORY', heading:'Turn a story into a video',
    description:'Build a narrated story with captions, background video and music.',
    kind:'story', image:'autoclip.webp', action:'Generate video', library:'Your story videos',
    stages:['Writing your story','Preparing the narration','Building your scenes','Finishing your video'],
    fields:[select('Source',['Reddit post','Write your own story','AI prompt']),
      entry('Reddit URL','Paste a Reddit post URL'),
      area('Script','Write or paste your story here...'),
      select('Voice',['Adam','Rachel','Bella','Josh']),
      select('Background video',['Minecraft','Subway Surfers','Nature','Upload your own']),
      select('Captions',['Bold','Classic','Clean','Karaoke']),
      toggle('Background music',true)]
  },
  'Fake Texts Video': {
    eyebrow:'FAKE TEXTS', heading:'Create a text conversation video',
    description:'Write a conversation and preview its pace, look and sound.',
    kind:'story', image:'editor.webp', action:'Generate video', library:'Your text videos',
    stages:['Preparing your conversation','Animating the messages','Adding sound and captions','Finishing your video'],
    fields:[entry('Conversation title','The story of this chat'),
      area('Messages','Alex: Did you see this?\nJamie: No, what happened?'),
      select('Phone style',['iPhone','Android','Minimal']),
      select('Message pace',['Slow','Normal','Fast'],'Normal'),
      select('Background',['Dark','Light','Gradient']),
      toggle('Typing indicators',true),toggle('Message sounds',true)]
  },
  'AI Image Generator': {
    eyebrow:'AI IMAGES', heading:'Ready to create something amazing?',
    description:'Enter a prompt below and let AI bring your ideas to life.',
    kind:'image', action:'Generate images', library:'Recent Generations',
    stages:['Reading your prompt','Composing the image','Rendering details','Finishing the image'],
    fields:[area('Prompt','Describe the image you want to create...'),
      select('Model',['General Enhancement','Cartoon Theme','Realism Theme','Anime Theme']),
      select('Ratio',['1:1','9:16','16:9','4:5']),
      select('Enhance Theme',['Off','General Enhancement','Cartoon Theme','Realism Theme','Anime Theme'])]
  },
  'Icon Generator': {
    eyebrow:'ICON GENERATOR', heading:'Create a set that feels like you',
    description:'Shape the icon, color palette and background for your channel.',
    kind:'image', action:'Generate icon', library:'Recent icons',
    stages:['Exploring icon ideas','Choosing shapes','Applying your colors','Finishing the icon'],
    fields:[select('Icon set',['Single icon','Icon set']),
      entry('Icon','e.g. announcements, chat, wins'),
      entry('Background color (optional)','e.g. #335CFF, sunset gradient'),
      entry('Accent color (optional)','Glyph color, white by default'),
      select('Palette',['Blue','Emerald','Orange','Violet','Charcoal','Sunset'])]
  },
  'Face Swap': {
    eyebrow:'FACE SWAP', heading:'Swap faces between two images',
    description:'Choose a character image and a target image, then preview the result.',
    kind:'dual-image', action:'Swap faces', library:'Recent swaps',
    stages:['Reading both images','Mapping facial features','Blending the face','Cleaning up result'],
    fields:[area('Adjustments (optional)','Describe any adjustments or style changes...'),toggle('Clean up result',true)]
  },
  'AI Voiceovers': {
    eyebrow:'VOICEOVERS', heading:'Give your script a voice',
    description:'Write or paste a script and tune the voice before generating.',
    kind:'audio', action:'Generate voiceover', library:'Recent voiceovers',
    stages:['Reading your script','Preparing your voice','Generating speech','Polishing the audio'],
    fields:[entry('Title','Name your voiceover'),area('Script','Type or paste the script you want spoken...'),
      select('Voice',['Adam','Rachel','Bella','Josh']),select('Language',['English','Spanish','French']),
      select('Stability',['Low','Balanced','High'],'Balanced'),
      select('Similarity',['Low','Balanced','High'],'Balanced'),
      select('Exaggeration',['Low','Balanced','High'],'Balanced'),
      select('Volume',['Quiet','Normal','Loud'],'Normal')]
  },
  'Voice Changer': {
    eyebrow:'VOICE CHANGER', heading:'Transform any voice in audio or video files',
    description:'Upload a recording and choose the target voice.',
    kind:'audio', action:'Change voice', library:'Recent changes',
    stages:['Analyzing the voice','Transforming delivery','Cleaning the recording','Finishing audio'],
    fields:[select('Target Voice',['Adam','Rachel','Bella','Josh']),
      toggle('Remove background noise',true)]
  },
  'Speech Enhancer': {
    eyebrow:'SPEECH ENHANCER', heading:'Studio-quality speech in a couple of minutes',
    description:'Reduce noise and tune speech, music and background levels.',
    kind:'audio', image:'speech-enhancer.webp', action:'Enhance speech', library:'Recent recordings',
    stages:['Analyzing your recording','Separating speech and noise','Balancing levels','Finishing audio'],
    fields:[select('Speech',['Less','Balanced','More'],'Balanced'),
      select('Music',['Less','Balanced','More'],'Balanced'),
      select('Background',['Less','Balanced','More'],'Less')]
  },
  'AI Brainstormer': {
    eyebrow:'AI BRAINSTORM', heading:'Find your next video idea',
    description:'Explore ideas for a niche, format and audience.',
    kind:'ideas', action:'Generate ideas', library:'Recent ideas',
    stages:['Exploring your topic','Finding hooks','Building ideas','Curating your list'],
    fields:[entry('Topic','Generate ideas for a niche to start a page on'),
      select('Tone',['Funny','Curious','Educational','Dramatic']),
      select('Video type',['Reddit Story','Fake Texts','Split Screen']),
      entry('Target audience','30-40 year old moms in the US')]
  },
  'Background Audio Remover': {
    eyebrow:'AUDIO REMOVER', heading:'Remove background audio',
    description:'Keep the speech and clean away unwanted audio.',
    kind:'audio', action:'Remove audio', library:'Recent cleanups',
    stages:['Analyzing audio','Separating voices','Removing background audio','Finishing export'],
    fields:[select('Strength',['Subtle','Balanced','Strong'],'Balanced'),toggle('Preserve speech',true)]
  },
  'Subtitle Remover': {
    eyebrow:'SUBTITLE REMOVER', heading:'Remove burned-in subtitles',
    description:'Erase subtitles and rebuild the background.',
    kind:'video', image:'subtitle-remover.webp', action:'Remove subtitles', library:'Recent videos',
    stages:['Analyzing your video','Detecting subtitle regions','Erasing subtitles & rebuilding the background','Finalizing and exporting'],
    fields:[toggle('Fast mode'),select('Output',['Original resolution','1080p','720p'])]
  },
  'YouTube Downloader': {
    eyebrow:'YOUTUBE DOWNLOADER', heading:'Save a video for your workflow',
    description:'Paste a link to preview the download flow.',
    kind:'url', image:'youtube-downloader.webp', action:'Preview download', library:'Recent downloads',
    stages:['Checking the link','Reading video details','Preparing the file','Finishing preview'],
    fields:[entry('Video link','Paste a YouTube URL'),select('Quality',['Best available','1080p','720p','480p'])]
  },
  'TikTok Downloader': {
    eyebrow:'TIKTOK DOWNLOADER', heading:'Save a TikTok video',
    description:'Paste a link to preview the download flow.',
    kind:'url', action:'Preview download', library:'Recent downloads',
    stages:['Checking the link','Reading video details','Preparing the file','Finishing preview'],
    fields:[entry('Video link','Paste a TikTok URL'),select('Quality',['Best available','720p','480p'])]
  }
};

function initialValues(fields) {
  return Object.fromEntries(fields.map(field=>[field.label,field.initial ?? '']));
}

function Preview({config, values, media, media2, toolName, playing, onPlay, playTime, progress, busy, complete}) {
  const videoRef=useRef(null);
  useEffect(()=>{if(!videoRef.current)return;if(playing)videoRef.current.play().catch(()=>{});else videoRef.current.pause()},[playing,media]);
  const ratio=values['Ratio']||values['Aspect ratio']||'9:16';
  const prompt=values.Prompt||values.Script||values.Messages||values.Topic||values.Icon||values['Clip title']||'Your next big moment';
  const caption=prompt.trim().split('\n')[0].slice(0,72);
  const visual=config.kind==='audio';
  const still=['image','dual-image','ideas'].includes(config.kind);
  const enabled=Object.entries(values).filter(([,value])=>value===true).map(([key])=>key);
  const canvasClass=['gw-preview-canvas',visual?'gw-preview-audio':'',playing?'is-playing':'',
    playing&&values.Zooms?'has-zooms':'',
    'gw-style-'+(values.Style||'viral').toLowerCase(),
    'gw-layout-'+(values.Layout||'fullscreen').toLowerCase()].filter(Boolean).join(' ');
  return <aside className="gw-preview">
    <div className="gw-preview-top"><div><span className="gw-live-dot"/>Live preview</div><span>{ratio}</span></div>
    <div className={canvasClass} style={{aspectRatio:ratio==='16:9'?'16 / 9':ratio==='1:1'?'1 / 1':ratio==='4:5'?'4 / 5':'9 / 16'}}>
      {media?.type.startsWith('video/')?<video ref={videoRef} src={media.url} muted loop playsInline/>:
       media?.type.startsWith('image/')?<img src={media.url} alt="Selected preview"/>:
       config.image?<img src={'/images/'+config.image} alt=""/>:null}
      {config.kind==='image'&&!media&&<div className="gw-art"><i/><i/><Sparkles size={43}/><strong>{toolName==='Icon Generator'?'Your next icon':'Your next image'}</strong><small>{caption||'Describe what you imagine'}</small></div>}
      {config.kind==='ideas'&&<div className="gw-idea-art"><Sparkles size={27}/><small>NEW IDEA</small><strong>{values.Topic||'Your idea will appear here'}</strong><span>{values['Video type']||'Video concept'}</span></div>}
      {config.kind==='dual-image'&&!media&&<div className="gw-dual-art"><span><FileImage size={29}/>Character</span><span><FileImage size={29}/>Target</span></div>}
      {config.kind==='dual-image'&&media2?.url&&<img className="gw-face-target" src={media2.url} alt="Target preview"/>}
      {visual&&<div className="gw-wave">{Array.from({length:34},(_,i)=><i key={i} style={{height:`${14+(i*23%52)}%`,animationDelay:`${i*31}ms`}}/>)}</div>}
      {!visual&&!still&&values.Title===true&&<div className="gw-title-overlay">{values['Clip title']||'A moment worth sharing'}</div>}
      {!visual&&!still&&values.Captions!==false&&<div className="gw-caption">{caption||'Your next big moment'}</div>}
      {busy&&<div className="gw-preview-wash"><div className="gw-scan"/><Sparkles size={30}/><span>{config.stages[Math.min(3,Math.floor(progress/25))]}</span></div>}
      {complete&&!busy&&<div className="gw-complete-badge"><Check size={14}/> Preview ready</div>}
      <span className="gw-preview-watermark">Shorts</span>
    </div>
    {!still&&<div className="gw-preview-controls"><button aria-label={playing?'Pause preview':'Play preview'} onClick={onPlay}>{playing?<Pause size={17}/>:<Play size={17}/>}</button><div className="gw-preview-track"><i style={{width:playTime/30*100+'%'}}/></div><span>00:{Math.floor(playTime).toString().padStart(2,'0')} / 00:30</span></div>}
    <div className="gw-preview-summary"><span>Preview settings</span><div>{Object.entries(values).filter(([key,value])=>typeof value==='string'&&value&&!(key==='Prompt'||key==='Script'||key==='Messages'||key==='Topic'||key==='Video link')).slice(0,4).map(([key,value])=><div key={key}><small>{key}</small><b>{value}</b></div>)}</div>{enabled.length>0&&<p className="gw-preview-features">{enabled.map(name=><span key={name}><Check size={10}/>{name}</span>)}</p>}</div>
    <p className="gw-preview-note">Visual demo · this is not a rendered result.</p>
  </aside>;
}

export default function GenerationWorkspace({tool,onDone,go}) {
  const config=configs[tool[0]]||configs.AutoClip;
  const [values,setValues]=useState(()=>initialValues(config.fields));
  const [media,setMedia]=useState(null),[media2,setMedia2]=useState(null);
  const [tab,setTab]=useState('Create'),[busy,setBusy]=useState(false),[progress,setProgress]=useState(0);
  const [complete,setComplete]=useState(false),[playing,setPlaying]=useState(false),[playTime,setPlayTime]=useState(0),[openJobMenu,setOpenJobMenu]=useState(null);
  const [jobs,setJobs]=useState(()=>{try{return JSON.parse(localStorage.getItem('frame-jobs-'+tool[0])||'[]')}catch{return []}});
  const input=useRef(null),input2=useRef(null),raf=useRef(0),runId=useRef(0);
  useEffect(()=>{localStorage.setItem('frame-jobs-'+tool[0],JSON.stringify(jobs))},[jobs,tool]);
  useEffect(()=>{if(!playing)return;const timer=setInterval(()=>setPlayTime(time=>(time+.1)%30),100);return()=>clearInterval(timer)},[playing]);
  useEffect(()=>()=>{runId.current++;cancelAnimationFrame(raf.current)},[]);
  useEffect(()=>()=>{if(media?.url)URL.revokeObjectURL(media.url)},[media]);
  useEffect(()=>()=>{if(media2?.url)URL.revokeObjectURL(media2.url)},[media2]);
  const change=(label,value)=>setValues(prev=>({...prev,[label]:value}));
  const choose=(files,secondary=false)=>{const file=files?.[0];if(!file)return;const next={name:file.name,type:file.type,url:URL.createObjectURL(file)};
    (secondary?setMedia2:setMedia)(next);setComplete(false)};
  const cancel=()=>{runId.current++;cancelAnimationFrame(raf.current);setBusy(false);setProgress(0)};
  const run=()=>{
    if(busy)return;
    const id=++runId.current,duration=6000+Math.random()*6000,start=performance.now();
    setBusy(true);setComplete(false);setProgress(0);setTab('Create');
    const frame=now=>{
      if(id!==runId.current)return;
      const amount=Math.min(100,Math.max(0,(now-start)/duration*100));
      setProgress(amount);
      if(amount<100){raf.current=requestAnimationFrame(frame);return}
      setBusy(false);setComplete(true);
      const job={id:Date.now(),name:values.Title||values.Topic||values.Icon||tool[0]+' preview',date:new Date().toLocaleString()};
      setJobs(items=>[job,...items].slice(0,12));
      onDone(job.name);
    };
    raf.current=requestAnimationFrame(frame);
  };
  const renderField=field=>{
    if(field.type==='toggle')return <label className="gw-toggle" key={field.label}><span>{field.label}</span><button type="button" role="switch" aria-label={field.label} aria-checked={!!values[field.label]} className={values[field.label]?'is-on':''} onClick={()=>change(field.label,!values[field.label])}><i/></button></label>;
    return <label key={field.label} className={'gw-field '+(field.type==='area'?'gw-field-wide':'')}><span>{field.label}</span>
      {field.type==='select'?<span className="gw-select"><select value={values[field.label]} onChange={e=>change(field.label,e.target.value)}>{field.choices.map(choice=><option key={choice}>{choice}</option>)}</select><ChevronDown size={15}/></span>:
       field.type==='area'?<textarea value={values[field.label]} placeholder={field.placeholder} onChange={e=>change(field.label,e.target.value)} rows={4}/>:
       <input value={values[field.label]} placeholder={field.placeholder} onChange={e=>change(field.label,e.target.value)}/>}
    </label>;
  };
  const upload=config.kind!=='url'&&config.kind!=='ideas'&&config.kind!=='story'&&config.kind!=='image';
  const isImage=config.kind==='image'||config.kind==='dual-image';
  return <div className="gw">
    <section className="gw-hero">
      <div><span className="gw-eyebrow"><Sparkles size={13}/>{config.eyebrow}</span><h2>{config.heading}</h2><p>{config.description}</p></div>
      <button className="primary" onClick={()=>{setTab('Create');document.querySelector('.gw-form')?.scrollIntoView({behavior:'smooth',block:'start'})}}><Plus size={16}/>{config.action}</button>
    </section>
    <div className="gw-tabs" role="tablist">{['Create',config.library].map(name=><button role="tab" aria-selected={tab===name} className={tab===name?'active':''} key={name} onClick={()=>setTab(name)}>{name}</button>)}</div>
    {tab==='Create'?<div className="gw-workspace">
      <section className="gw-form" onKeyDown={e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();run()}}}>
        <div className="gw-form-title"><span className="gw-form-icon"><WandSparkles size={18}/></span><div><h3>{config.action}</h3><p>Set up your next creation</p></div><button title="Reset options" aria-label="Reset options" onClick={()=>{setValues(initialValues(config.fields));setMedia(null);setMedia2(null);cancel();setComplete(false)}}><RotateCcw size={16}/></button></div>
        {upload&&<div className="gw-upload-group">
          <input ref={input} type="file" hidden accept={isImage?'image/*':'video/*,audio/*'} onChange={e=>choose(e.target.files)}/>
          <button className="gw-upload" onClick={()=>input.current?.click()} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();choose(e.dataTransfer.files)}}><CloudUpload size={22}/><span><strong>{media?media.name:config.kind==='dual-image'?'Character Image':config.kind==='audio'?'Upload File':tool[0]==='Edit with AI'?'Choose clips':'Choose a video'}</strong><small>{media?'Click to replace':isImage?'PNG, JPG, WEBP':'Click or drag to upload'}</small></span><ArrowRight size={16}/></button>
          {config.kind==='dual-image'&&<><input ref={input2} type="file" hidden accept="image/*" onChange={e=>choose(e.target.files,true)}/><button className="gw-upload" onClick={()=>input2.current?.click()} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();choose(e.dataTransfer.files,true)}}><FileImage size={22}/><span><strong>{media2?media2.name:'Target Image'}</strong><small>{media2?'Click to replace':'PNG, JPG, WEBP'}</small></span><ArrowRight size={16}/></button></>}
        </div>}
        {config.kind==='image'&&<div className="gw-reference"><input ref={input} type="file" hidden accept="image/*" onChange={e=>choose(e.target.files)}/><button className="secondary" onClick={()=>input.current?.click()}><Plus size={15}/>{media?'Change reference image':'Add reference image'}</button>{media&&<small>{media.name}</small>}</div>}
        <div className="gw-fields">{config.fields.map(renderField)}</div>
        {tool[0]==='Cut & Crop'&&<div className="gw-cut-timeline"><div className="gw-timeline-heading"><span><Scissors size={15}/> Mark your clips</span><small>Drag the handles to set the range</small></div><div className="gw-time-labels"><span>00:00</span><span>00:15</span><span>00:30</span><span>00:45</span><span>01:00</span></div><input aria-label="Start clip here" type="range" min="0" max="60" defaultValue="8"/><input aria-label="End clip here" type="range" min="0" max="60" defaultValue="42"/><button className="secondary" onClick={()=>change('Clip title','Clip '+(jobs.length+1))}><Plus size={15}/>Add clip</button></div>}
        {busy&&<div className="gw-processing" role="status" aria-live="polite"><div className="gw-loader"><i/><i/><i/><Sparkles size={21}/></div><div><span>CREATING YOUR PREVIEW</span><h3>{config.stages[Math.min(3,Math.floor(progress/25))]}</h3><p>Every moment gets its final polish.</p></div><strong>{Math.round(progress)}%</strong><div className="gw-progress"><i style={{width:progress+'%'}}/></div><div className="gw-stage-list">{config.stages.map((stage,i)=><span key={stage} className={progress>=i*25?'reached':''}>{progress>=(i+1)*25?<Check size={12}/>:i+1} {stage}</span>)}</div><button className="gw-cancel" onClick={cancel}>Cancel generation</button></div>}
        {complete&&!busy&&<div className="gw-result"><CheckCircle2 size={22}/><div><h3>Preview complete</h3><p>Saved in your local Projects. No media was processed.</p></div><button className="secondary" onClick={()=>go('/editor')}>Open editor <ArrowRight size={15}/></button></div>}
        <button className="primary gw-generate" disabled={busy} onClick={run}>{busy?<LoaderCircle className="gw-spin" size={18}/>:<Sparkles size={18}/>} {busy?'Generating preview…':config.action}<span>{busy?'':'⌘ ↵'}</span></button>
        <p className="gw-demo-disclaimer">Local mock generation · random 6–12 seconds · no credits or backend</p>
      </section>
      <Preview config={config} values={values} media={media} media2={media2} toolName={tool[0]} playing={playing} onPlay={()=>setPlaying(v=>!v)} playTime={playTime} progress={progress} busy={busy} complete={complete}/>
    </div>:<div className="gw-history"><div className="gw-history-heading"><div><h3>{config.library}</h3><p>Your local preview history for this tool</p></div><button className="primary" onClick={()=>setTab('Create')}><Plus size={16}/>{config.action}</button></div>{jobs.length?jobs.map(job=><div className="gw-job" key={job.id}><span className="gw-job-thumb"><Film size={19}/></span><div><strong>{job.name}</strong><small>{job.date}</small></div><span className="gw-job-status"><Check size={13}/> Completed</span><span className="gw-job-menu-wrap"><button aria-label={'More options for '+job.name} onClick={()=>setOpenJobMenu(openJobMenu===job.id?null:job.id)}><MoreHorizontal size={18}/></button>{openJobMenu===job.id&&<span className="gw-job-menu"><button onClick={()=>go('/editor')}>Open in editor</button><button onClick={()=>go('/projects')}>View in Projects</button><button onClick={()=>{setJobs(items=>items.filter(item=>item.id!==job.id));setOpenJobMenu(null)}}>Remove from history</button></span>}</span></div>):<div className="gw-empty"><span><Sparkles size={29}/></span><h3>Nothing here yet</h3><p>Start a creation to see it in this space.</p><button className="secondary" onClick={()=>setTab('Create')}>{config.action}<ArrowRight size={15}/></button></div>}</div>}
  </div>;
}

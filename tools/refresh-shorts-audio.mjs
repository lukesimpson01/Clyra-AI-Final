import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { BROWSE_CATALOG } from '../apps/shorts/openfilm/packages/openfilm/studio/ui/src/frame/lib/musicLibrary.js';
import { SFX_CATALOG } from '../apps/shorts/openfilm/packages/openfilm/studio/ui/src/frame/lib/sfxLibrary.js';
const exec=promisify(execFile),root=resolve('shorts-library'),python=process.env.CLYRA_AUDIO_PYTHON||'python3';
await mkdir(join(root,'recordings'),{recursive:true});
const manifestPath=join(root,'recordings.json');let manifest={};try{manifest=JSON.parse(await readFile(manifestPath,'utf8'));}catch{}
const list=[...BROWSE_CATALOG.filter(e=>e.take),...SFX_CATALOG.filter(e=>e.group==='brainrot'||e.originalRecording)];
const selected=process.argv.slice(2).filter(s=>!s.startsWith('--')); const tasks=selected.length?list.filter(e=>selected.includes(e.id)):list;
const checkedSources={
  'mx-memory-reboot':'https://www.youtube.com/watch?v=wL8DVHuWI7Y',
  'mx-thank-you':'https://www.youtube.com/watch?v=pVInBRkoKgY',
  'mx-resonance':'https://www.youtube.com/watch?v=8GW6sLrK40k',
  'mx-mice-on-venus':'https://www.youtube.com/watch?v=KdOD0fZs_XU',
  'mx-can-you-feel-my-heart':'https://www.youtube.com/watch?v=QJJYpsA5tv8',
};
async function one(e){
  if(!e.music){await exec(process.execPath,['tools/audit-shorts-recordings.mjs','--sfx',`--ids=${e.id}`],{timeout:90000,maxBuffer:2*1024*1024}).then(({stdout})=>console.log(stdout.trim())).catch(error=>console.error(`${e.id}: exact recording refresh refused: ${error.message}`));return;}
  if(manifest[e.id]&&await stat(join(root,manifest[e.id].file)).catch(()=>null))return;
  try{
    let url=checkedSources[e.id]||(e.id==='mx-space-cadet'?'https://www.youtube.com/watch?v=8fK1kA9Q-3Y':e.sourceUrl);
    if(e.music&&!url.includes('youtube.com')){
      const artist=e.id==='mx-resonance'?'HOME':e.artist;
      const query=`ytsearch3:${artist} ${e.title} official audio`;
      const {stdout}=await exec(python,['-m','yt_dlp','--no-warnings','--skip-download','--dump-json','--socket-timeout','15',query],{maxBuffer:8*1024*1024,timeout:90000});
      const candidates=stdout.trim().split('\n').map(s=>JSON.parse(s));
      const norm=s=>String(s).toLowerCase().replace(/[^a-z0-9]+/g,'');
      const found=candidates.find(c=>!/cover|reaction|tutorial|slowed|sped up|remix/i.test(c.title)&&((norm(c.channel).includes(norm(artist).slice(0,6))||/ - Topic$/.test(c.channel))&&/audio|provided|topic/i.test(c.title+' '+c.description+' '+c.channel)));
      if(!found)throw new Error('No unambiguous artist/Topic audio source among the search results.');
      url=found.webpage_url; console.log(`${e.id}: ${found.title} — ${found.channel} — ${url}`);
    }
    if(!e.music){
      const html=await fetch(url).then(r=>{if(!r.ok)throw new Error(`Source ${r.status}`);return r.text();});
      const hit=html.match(/(?:src|href)=["'](\/media\/sounds\/[^"']+\.mp3)["']/i)??html.match(/["'](\/media\/sounds\/[^"']+\.mp3)["']/i);
      if(!hit)throw new Error('No downloadable original MP3 on the named source page.');
      const response=await fetch(new URL(hit[1],url));if(!response.ok)throw new Error(`Audio ${response.status}`);
      await writeFile(join(root,'recordings',`${e.id}.mp3`),Buffer.from(await response.arrayBuffer()));
    }else{
      await exec(python,['-m','yt_dlp','--no-playlist','--no-progress','--socket-timeout','20','--retries','1','--max-filesize','40M','-f','bestaudio/best','-x','--audio-format','mp3','--audio-quality','2','-o',join(root,'recordings',`${e.id}.%(ext)s`),url],{timeout:120000,maxBuffer:2*1024*1024});
    }
    const file=join('recordings',`${e.id}.mp3`);const {stdout:probe}=await exec('ffprobe',['-v','error','-show_entries','format=duration','-of','json',join(root,file)]);
    const duration=Number(JSON.parse(probe).format.duration);if(!(duration>.05))throw new Error('Empty recording.');
    manifest[e.id]={file,title:e.title??e.name,artist:e.artist??'',sourceUrl:url,duration,verifiedAt:new Date().toISOString()};
    await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');console.log(`${e.id}: saved ${duration.toFixed(2)}s`);
  }catch(err){console.error(`${e.id}: ${err.message}`);}
}
// Serial writes keep the manifest coherent and avoid competing decoders/downloads.
for(const e of tasks)await one(e);
console.log(`Ready: ${Object.keys(manifest).length} recordings.`);

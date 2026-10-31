/** Refresh source recordings, retaining exact source metadata and hashes. No synthetic fallback. */
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';import {createHash} from 'node:crypto';import {resolve,join} from 'node:path';
import {SOUND_RECORDINGS} from '../apps/shorts/openfilm/packages/openfilm/src/sound-recordings.mjs';
import {requireSoundIdentity,soundPageIdentity} from './lib/recording-identity.mjs';
import {BROWSE_CATALOG} from '../apps/shorts/openfilm/packages/openfilm/studio/ui/src/frame/lib/musicLibrary.js';
import {SFX_CATALOG} from '../apps/shorts/openfilm/packages/openfilm/studio/ui/src/frame/lib/sfxLibrary.js';
const exec=promisify(execFile),root=resolve('shorts-library'),python=process.env.CLYRA_AUDIO_PYTHON||'python3',manifestPath=join(root,'recordings.json');
let manifest=JSON.parse(await readFile(manifestPath,'utf8').catch(()=>'{}'));await mkdir(join(root,'recordings'),{recursive:true});
const norm=s=>String(s).toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]+/g,'');
const failures=[];
const songSources={'mx-run-amok':'https://www.youtube.com/watch?v=mOXginnvZ4A','mx-thank-you':'https://www.youtube.com/watch?v=pVInBRkoKgY','mx-freedom':'https://www.youtube.com/watch?v=5Pk_oHxy15M','mx-memory-reboot':'https://www.youtube.com/watch?v=wL8DVHuWI7Y','mx-can-you-feel-my-heart':'https://www.youtube.com/watch?v=QJJYpsA5tv8'};
async function fetchText(url){const {stdout}=await exec('curl',['-fLsS','--max-time','30',url],{maxBuffer:8*1024*1024,timeout:35000});return stdout;}
async function soundPage(e){
  const pin=SOUND_RECORDINGS[e.id];if(pin?.status!=='verified')throw new Error(`${e.name}: unresolved exact recording; no substitute will be downloaded.`);
  return pin.pageUrl;
}
async function song(e){
  const query=songSources[e.id]||`ytsearch5:${e.artist} ${e.title} official audio`;
  const {stdout}=await exec(python,['-m','yt_dlp','--ignore-errors','--no-warnings','--skip-download','--dump-json','--socket-timeout','15',query],{timeout:120000,maxBuffer:16*1024*1024});
  const candidates=stdout.trim().split('\n').map(s=>JSON.parse(s));
  const score=c=>{if(/cover|reaction|tutorial|slowed|sped up|remix|\blive\b/i.test(c.title))return -100;const title=norm(c.title),artist=norm(e.artist),channel=norm(c.channel),artists=norm([c.artist,...(c.artists??[])].join(' '));return (title.includes(norm(e.title))?5:0)+(channel.includes(artist)||artists.includes(artist)?6:0)+(/ - Topic$/.test(c.channel)?5:0)+(/provided to youtube/i.test(c.description)?3:0)+(/official audio/i.test(c.title)?2:0)-(/official video|music video/i.test(c.title)?4:0);};
  const best=candidates.sort((a,b)=>score(b)-score(a))[0];if(!best||!songSources[e.id]&&score(best)<10)throw new Error(`No unambiguous artist audio for ${e.title}`);
  console.log(`${e.id}: ${best.title} — ${best.channel}`);return best;
}
const only=process.argv.includes('--music')?BROWSE_CATALOG:process.argv.includes('--sfx')?SFX_CATALOG:[...BROWSE_CATALOG,...SFX_CATALOG];
const ids=process.argv.find(a=>a.startsWith('--ids='))?.slice(6).split(',');
for(const e of only.filter(e=>!ids||ids.includes(e.id))){try{
  let url,info={};const file=`recordings/${e.id}.mp3`,output=join(root,file),temporary=join(root,'recordings',`.${e.id}-source`);
  if(e.music){const found=await song(e);url=found.webpage_url;info={sourceTitle:found.title,sourceAuthor:found.channel,sourceDuration:found.duration};await exec(python,['-m','yt_dlp','--no-playlist','--no-progress','--socket-timeout','20','--retries','1','--max-filesize','80M','-f','bestaudio/best','-x','--audio-format','mp3','--audio-quality','2','--force-overwrites','-o',temporary+'.%(ext)s',url],{timeout:150000,maxBuffer:2*1024*1024});await writeFile(output,await readFile(temporary+'.mp3'));}
  else{url=await soundPage(e);const identity=soundPageIdentity(await fetchText(url),url),pin=SOUND_RECORDINGS[e.id];requireSoundIdentity({...e,sourceUrl:pin.pageUrl,mediaUrl:pin.mediaUrl},identity);await exec('curl',['-fLsS','--max-time','30','-o',temporary+'.mp3',identity.mediaUrl],{timeout:35000});const hash=createHash('sha256').update(await readFile(temporary+'.mp3')).digest('hex');if(hash!==pin.sha256)throw Error('Source audio bytes changed. Explicit re-verification is required.');info={mediaUrl:identity.mediaUrl,sourceTitle:identity.title,identity:{status:'verified',sourceTitle:identity.title,checkedAt:new Date().toISOString()}};}
  const candidate=e.music?output:temporary+'.mp3';await exec('ffmpeg',['-v','error','-i',candidate,'-f','null','-'],{timeout:120000});
  const {stdout}=await exec('ffprobe',['-v','error','-show_entries','format=duration','-of','json',candidate]);const duration=Number(JSON.parse(stdout).format.duration);if(!(duration>.03))throw new Error('Empty audio.');
  const sha256=createHash('sha256').update(await readFile(candidate)).digest('hex');if(!e.music)await rename(candidate,output);
  manifest[e.id]={file,title:e.title??e.name,artist:e.artist??'',sourceUrl:url,...info,duration,sha256,verifiedAt:new Date().toISOString()};await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');console.log(`SAVED ${e.id}: ${duration.toFixed(2)}s`);
}catch(error){failures.push({id:e.id,error:error.message});console.error(`FAILED ${e.id}: ${error.message}`);}}
await writeFile(join(root,'recording-audit.json'),JSON.stringify({at:new Date().toISOString(),ready:Object.keys(manifest).length,failures},null,2));console.log(JSON.stringify({ready:Object.keys(manifest).length,failures}));if(failures.length)process.exitCode=1;

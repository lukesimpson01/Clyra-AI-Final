/** Read-only title audit. Never replaces audio from a search result. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {SFX_CATALOG} from '../apps/shorts/openfilm/packages/openfilm/studio/ui/src/frame/lib/sfxLibrary.js';
import {exactSoundName,soundCandidates,soundPageIdentity} from './lib/recording-identity.mjs';
const exec=promisify(execFile),saved=JSON.parse(await readFile('shorts-library/recordings.json','utf8'));
const ids=process.argv.find(a=>a.startsWith('--ids='))?.slice(6).split(',');
const queue=SFX_CATALOG.filter(e=>!ids||ids.includes(e.id)),results=[];
const fetchText=async(url)=>(await exec('curl',['-fLsS','--max-time','18',url],{timeout:22000,maxBuffer:8*1024*1024})).stdout;
await Promise.all([0,1].map(async()=>{while(queue.length){
  const entry=queue.shift(),current=saved[entry.id];
  try {
    const identity=soundPageIdentity(await fetchText(current.sourceUrl),current.sourceUrl);
    const exact=exactSoundName(identity.title)===exactSoundName(entry.name);
    const candidates=exact?[]:soundCandidates(await fetchText('https://www.myinstants.com/en/search/?name='+encodeURIComponent(entry.name)));
    const matches=candidates.filter(c=>exactSoundName(c.title)===exactSoundName(entry.name));
    const row={id:entry.id,name:entry.name,current:identity,exact,matches,candidates:candidates.slice(0,15)};
    results.push(row);console.log(JSON.stringify({id:entry.id,exact,current:identity.title,matches}));
  }catch(error){results.push({id:entry.id,name:entry.name,error:error.message});console.log(JSON.stringify({id:entry.id,error:error.message}));}
}}));
await mkdir('shorts-library',{recursive:true});
await writeFile('shorts-library/sound-identity-audit.json',JSON.stringify({at:new Date().toISOString(),results},null,2)+'\n');
console.log(JSON.stringify({exact:results.filter(r=>r.exact).length,total:results.length,unresolved:results.filter(r=>!r.exact&&!r.matches?.length).map(r=>r.id)}));

/** User-approved (29 Oct follow-up) type-matched CC0 sources for effects with no exact-title upload.
 *  Each pin keeps its real source title, page, author and licence; the catalog label is unchanged. */
import {readFile,writeFile,mkdir,copyFile,rename} from 'node:fs/promises';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {createHash} from 'node:crypto';
import {soundPageIdentity} from './lib/recording-identity.mjs';
import {exactSoundName} from './lib/recording-identity.mjs';
import {SOUND_RECORDINGS} from '../apps/shorts/openfilm/packages/openfilm/src/sound-recordings.mjs';
const F='https://freesound.org/people/';
const sources=[
  {id:'flash',name:'Flash',title:'Camera Flash_Crackle_Near_Mono.wav',author:'_stubb',page:F+'_stubb/sounds/406614/'},
  {id:'razor-slash',name:'Razor Slash',title:'Slash',author:'qubodup',page:F+'qubodup/sounds/442903/'},
  {id:'swipe',name:'Swipe',title:'Swipe.wav',author:'LilMati',page:F+'LilMati/sounds/702773/'},
  {id:'zoom-in-out',name:'Zoom In / Out',title:'Dramatic Camera Zoom',author:'sanaku',page:F+'sanaku/sounds/371882/'},
  {id:'reverse-whoosh',name:'Reverse Whoosh',title:'Backwards Whoosh',author:'SlavicMagic',page:F+'SlavicMagic/sounds/446010/'},
  {id:'transition-sweep',name:'Transition Sweep',title:'Transition Swoosh',author:'adh.dreaming',page:F+'adh.dreaming/sounds/632763/'},
  {id:'impact-hit',name:'Impact Hit',title:'Hit Impact',author:'MadPanCake',page:F+'MadPanCake/sounds/660770/'},
  {id:'ui-tap',name:'UI Tap',title:'Aggressive Button Tap / UI Tap Hit',author:'subquire',page:F+'subquire/sounds/833601/'},
  {id:'text-reveal',name:'Text Reveal',title:'Data Reveal Sound',author:'Sky_Motion',page:F+'Sky_Motion/sounds/511418/'},
  {id:'heavenly-music',name:'Heavenly Music',title:'Choir of Voices - Single Chord',author:'bone666138',page:F+'bone666138/sounds/274121/'},
];
const exec=promisify(execFile),root='shorts-library',manifest=JSON.parse(await readFile(root+'/recordings.json','utf8'));
const backup=root+'/history/'+new Date().toISOString().replace(/[:.]/g,'-')+'-substitutes';await mkdir(backup,{recursive:true});await copyFile(root+'/recordings.json',backup+'/recordings.json');
const report=[],failed=[];
const only=process.argv[2]?.split(',');
for(const s of sources){
  if(only&&!only.includes(s.id))continue;
  try{
    const {stdout:html}=await exec('curl',['-fLsS','--max-time','25','-A','Mozilla/5.0',s.page],{timeout:30000,maxBuffer:8000000});
    const identity=soundPageIdentity(html,s.page);
    if(exactSoundName(identity.title)!==exactSoundName(s.title))throw Error(`title changed: ${identity.title}`);
    if(!html.includes('creativecommons.org/publicdomain/zero/1.0/'))throw Error('CC0 declaration missing');
    const tmp=root+'/recordings/.'+s.id+'-sub.mp3';
    await exec('curl',['-fLsS','--max-time','90','-o',tmp,identity.mediaUrl],{timeout:100000});
    await exec('ffmpeg',['-v','error','-i',tmp,'-f','null','-']);
    const {stdout:p}=await exec('ffprobe',['-v','error','-show_entries','format=duration','-of','json',tmp]);
    const duration=Number(JSON.parse(p).format.duration),sha256=createHash('sha256').update(await readFile(tmp)).digest('hex');
    if(!(duration>.03&&duration<20))throw Error('unexpected duration '+duration);
    const dest=root+'/'+manifest[s.id].file;
    await copyFile(dest,backup+'/'+s.id+'.mp3').catch(()=>{});await rename(tmp,dest);
    const at=new Date().toISOString();
    manifest[s.id]={file:manifest[s.id].file,title:s.name,artist:'',sourceUrl:s.page,mediaUrl:identity.mediaUrl,sourceTitle:identity.title,sourceAuthor:s.author,duration,sha256,license:'CC0-1.0',verifiedAt:at,identity:{status:'verified',sourceTitle:identity.title,match:'type-matched substitute approved by user',checkedAt:at}};
    SOUND_RECORDINGS[s.id]={name:s.name,status:'verified',substitute:true,title:identity.title,pageUrl:s.page,mediaUrl:identity.mediaUrl,duration,sha256,author:s.author,license:'CC0-1.0'};
    report.push({id:s.id,title:identity.title,duration,sha256});
  }catch(e){failed.push({id:s.id,error:e.message});}
}
await writeFile('apps/shorts/openfilm/packages/openfilm/src/sound-recordings.mjs','// Exact named source identities. Search similarity never authorizes substitution.\nexport const SOUND_RECORDINGS = '+JSON.stringify(SOUND_RECORDINGS,null,2)+';\n');
await writeFile(root+'/recordings.json',JSON.stringify(manifest,null,2)+'\n');
await writeFile(root+'/reviewed-substitutes.json',JSON.stringify({backup,report,failed},null,2)+'\n');
console.log(JSON.stringify({report,failed},null,1));

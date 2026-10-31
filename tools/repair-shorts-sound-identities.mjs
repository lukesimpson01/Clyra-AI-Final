/** Apply the read-only audit: exact titles only, preserving every rejected recording for recovery. */
import {readFile,writeFile,mkdir,copyFile,rename} from 'node:fs/promises';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';import{createHash}from'node:crypto';
import {SFX_CATALOG} from '../apps/shorts/openfilm/packages/openfilm/studio/ui/src/frame/lib/sfxLibrary.js';
import {soundPageIdentity,requireSoundIdentity}from'./lib/recording-identity.mjs';
import {SOUND_CONTENT_REVIEW}from'./lib/sound-content-review.mjs';
const exec=promisify(execFile),root='shorts-library',stamp=new Date().toISOString().replace(/[:.]/g,'-');
const audit=JSON.parse(await readFile(root+'/sound-identity-audit.json','utf8')),manifest=JSON.parse(await readFile(root+'/recordings.json','utf8'));
await mkdir(root+'/history/'+stamp,{recursive:true});await copyFile(root+'/recordings.json',root+'/history/'+stamp+'/recordings.json');
const pins={},report=[];
for(const entry of SFX_CATALOG){
  const row=audit.results.find(r=>r.id===entry.id),choice=row?.exact?row.current:row?.matches?.length===1?row.matches[0]:null;
  let identity;
  try{
    if(SOUND_CONTENT_REVIEW[entry.id])throw Error(SOUND_CONTENT_REVIEW[entry.id]);
    if(!choice)throw Error(row?.matches?.length>1?'Multiple exact-title pages require source selection.':'No exact source title matched.');
    const pageUrl=choice.pageUrl,{stdout:html}=await exec('curl',['-fLsS','--max-time','20',pageUrl],{timeout:25000,maxBuffer:8000000});
    identity=soundPageIdentity(html,pageUrl);requireSoundIdentity({id:entry.id,name:entry.name,sourceUrl:pageUrl},identity);
    const temp=root+'/recordings/.'+entry.id+'-identity-check.mp3';
    await exec('curl',['-fLsS','--max-time','25','-o',temp,identity.mediaUrl],{timeout:30000});
    await exec('ffmpeg',['-v','error','-i',temp,'-f','null','-'],{timeout:30000});
    const {stdout:probe}=await exec('ffprobe',['-v','error','-show_entries','format=duration','-of','json',temp]);
    const duration=Number(JSON.parse(probe).format.duration);if(!(duration>.03))throw Error('Empty recording.');
    const sha256=createHash('sha256').update(await readFile(temp)).digest('hex'),old=manifest[entry.id];
    const changed=sha256!==old.sha256;
    if(changed)await copyFile(root+'/'+old.file,root+'/history/'+stamp+'/'+entry.id+'.mp3');
    await rename(temp,root+'/'+old.file);
    const checkedAt=new Date().toISOString();
    manifest[entry.id]={...old,title:entry.name,sourceUrl:pageUrl,mediaUrl:identity.mediaUrl,sourceTitle:identity.title,duration,sha256,verifiedAt:checkedAt,identity:{status:'verified',sourceTitle:identity.title,checkedAt}};
    pins[entry.id]={name:entry.name,status:'verified',...identity,sha256,duration};
    report.push({id:entry.id,name:entry.name,status:'verified',changed,...identity,sha256,duration});
  }catch(error){
    const reason=error.message;manifest[entry.id]={...manifest[entry.id],identity:{status:'unresolved',reason,checkedAt:new Date().toISOString()}};
    pins[entry.id]={name:entry.name,status:'unresolved',reason};report.push({id:entry.id,name:entry.name,status:'unresolved',reason,rejectedSourceTitle:row?.current?.title});
  }
  console.log(JSON.stringify(report.at(-1)));
}
const modulePath='apps/shorts/openfilm/packages/openfilm/src/sound-recordings.mjs';
await writeFile(modulePath,'// Exact named source identities. Search similarity never authorizes substitution.\nexport const SOUND_RECORDINGS = '+JSON.stringify(pins,null,2)+';\n');
await writeFile(root+'/recordings.json.new',JSON.stringify(manifest,null,2)+'\n');await rename(root+'/recordings.json.new',root+'/recordings.json');
await writeFile(root+'/sound-identity-repair.json',JSON.stringify({at:new Date().toISOString(),backup:root+'/history/'+stamp,report},null,2)+'\n');
console.log(JSON.stringify({verified:report.filter(x=>x.status==='verified').length,unresolved:report.filter(x=>x.status!=='verified').length,replaced:report.filter(x=>x.changed).length}));

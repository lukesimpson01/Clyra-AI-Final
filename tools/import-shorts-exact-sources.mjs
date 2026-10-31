/** Reviewed exact-name public recordings from a second provider. No search or fuzzy replacement. */
import {readFile,writeFile,mkdir,copyFile,rename} from 'node:fs/promises';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {createHash} from 'node:crypto';
import {soundPageIdentity,requireSoundIdentity} from './lib/recording-identity.mjs';
import {SOUND_RECORDINGS} from '../apps/shorts/openfilm/packages/openfilm/src/sound-recordings.mjs';
const sources=[
  {id:'digital-beep',name:'Digital Beep',pageUrl:'https://freesound.org/people/BismarckBall/sounds/822292/',author:'BismarckBall'},
  {id:'notification-ding',name:'Notification Ding',pageUrl:'https://freesound.org/people/NoTomorrow12/sounds/700332/',author:'NoTomorrow12'},
  {id:'click',name:'Click',pageUrl:'https://freesound.org/people/NightDrawr/sounds/815037/',author:'NightDrawr'},
];
const exec=promisify(execFile),root='shorts-library',manifest=JSON.parse(await readFile(root+'/recordings.json','utf8'));
const backup=root+'/history/'+new Date().toISOString().replace(/[:.]/g,'-');await mkdir(backup,{recursive:true});await copyFile(root+'/recordings.json',backup+'/recordings.json');
const report=[];
for(const entry of sources){
  const {stdout:html}=await exec('curl',['-fLsS','--max-time','25',entry.pageUrl],{timeout:30000,maxBuffer:8000000});
  const identity=soundPageIdentity(html,entry.pageUrl);requireSoundIdentity({id:entry.id,name:entry.name,sourceUrl:entry.pageUrl},identity);
  if(!html.includes('creativecommons.org/publicdomain/zero/1.0/'))throw Error('CC0 source declaration missing.');
  const temporary=root+'/recordings/.'+entry.id+'-reviewed.mp3';
  await exec('curl',['-fLsS','--max-time','25','-o',temporary,identity.mediaUrl],{timeout:30000});
  await exec('ffmpeg',['-v','error','-i',temporary,'-f','null','-']);
  const {stdout:probe}=await exec('ffprobe',['-v','error','-show_entries','format=duration','-of','json',temporary]);
  const duration=Number(JSON.parse(probe).format.duration),sha256=createHash('sha256').update(await readFile(temporary)).digest('hex');
  if(!(duration>.03&&duration<3))throw Error('Unexpected recording duration.');
  await copyFile(root+'/'+manifest[entry.id].file,backup+'/'+entry.id+'.mp3');await rename(temporary,root+'/'+manifest[entry.id].file);
  const checkedAt=new Date().toISOString();manifest[entry.id]={...manifest[entry.id],title:entry.name,sourceTitle:identity.title,sourceUrl:entry.pageUrl,sourceAuthor:entry.author,mediaUrl:identity.mediaUrl,duration,sha256,license:'CC0-1.0',verifiedAt:checkedAt,identity:{status:'verified',sourceTitle:identity.title,checkedAt}};
  SOUND_RECORDINGS[entry.id]={name:entry.name,status:'verified',...identity,duration,sha256,author:entry.author,license:'CC0-1.0'};
  report.push({id:entry.id,...identity,duration,sha256,author:entry.author,license:'CC0-1.0'});
}
await writeFile('apps/shorts/openfilm/packages/openfilm/src/sound-recordings.mjs','// Exact named source identities. Search similarity never authorizes substitution.\nexport const SOUND_RECORDINGS = '+JSON.stringify(SOUND_RECORDINGS,null,2)+';\n');
await writeFile(root+'/recordings.json',JSON.stringify(manifest,null,2)+'\n');
await writeFile(root+'/exact-source-expansion.json',JSON.stringify({backup,report},null,2)+'\n');console.log(JSON.stringify(report));

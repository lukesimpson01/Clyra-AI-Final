import assert from'node:assert/strict';import{readFile,mkdtemp,writeFile,mkdir,copyFile}from'node:fs/promises';import{tmpdir}from'node:os';import{join,resolve}from'node:path';import{createServer}from'node:http';import{createHash}from'node:crypto';
import{SOUND_RECORDINGS}from'../apps/shorts/openfilm/packages/openfilm/src/sound-recordings.mjs';
import{startStudio}from'../apps/shorts/openfilm/packages/openfilm/studio/server/server.mjs';
const scratch=await mkdtemp(join(tmpdir(),'clyra-audio-identity-')),manifest=JSON.parse(await readFile('shorts-library/recordings.json','utf8'));
process.env.OPENFILM_HOME=join(scratch,'home');process.env.OPENFILM_LIBRARY=join(scratch,'projects');process.env.CLYRA_RECORDINGS_DIR=join(scratch,'recordings');
await mkdir(process.env.CLYRA_RECORDINGS_DIR,{recursive:true});await mkdir(join(process.env.CLYRA_RECORDINGS_DIR,'recordings'));
await copyFile(resolve('shorts-library/'+manifest.fah.file),join(process.env.CLYRA_RECORDINGS_DIR,manifest.fah.file));
const save=()=>writeFile(join(process.env.CLYRA_RECORDINGS_DIR,'recordings.json'),JSON.stringify(manifest));await save();
const studio=await startStudio({port:0,openBrowser:()=>{}}),auth={'x-studio-key':studio.key};
let local;
try{
  assert.equal((await fetch(studio.origin+'/api/editor-audio/fah')).status,401);
  const byte=await fetch(studio.origin+'/api/editor-audio/fah',{headers:{...auth,range:'bytes=0-255'}});
  assert.equal(byte.status,206);assert.equal((await byte.arrayBuffer()).byteLength,256);
  let blocked=0;for(const[id,pin]of Object.entries(SOUND_RECORDINGS))if(pin.status==='unresolved'){
    const response=await fetch(studio.origin+'/api/editor-audio/'+id,{headers:auth});assert.equal(response.status,409,id);assert.match((await response.json()).error,/exact|verified/);blocked++;
  }
  const original=manifest.fah;manifest.fah={...original,sourceUrl:SOUND_RECORDINGS['fah-2'].pageUrl};await save();
  assert.equal((await fetch(studio.origin+'/api/editor-audio/fah',{headers:auth})).status,409,'changed source must fail closed');manifest.fah=original;await save();
  process.env.NODE_ENV='test';const{localApi}=await import('../apps/shorts/app/server/localApi.js');
  local=createServer((req,res)=>{req.originalUrl=req.url;void localApi(req,res,()=>{res.writeHead(404);res.end();}).catch(e=>{res.writeHead(500);res.end(e.message);});});
  await new Promise(done=>local.listen(0,'127.0.0.1',done));const origin='http://127.0.0.1:'+local.address().port;
  for(const[id,pin]of Object.entries(SOUND_RECORDINGS))if(pin.status==='unresolved')assert.equal((await fetch(origin+'/api/editor-audio/'+id)).status,409,id);
  const full=await fetch(origin+'/api/editor-audio/fah'),bytes=Buffer.from(await full.arrayBuffer());assert.equal(full.status,200);assert.equal(createHash('sha256').update(bytes).digest('hex'),SOUND_RECORDINGS.fah.sha256);
  console.log(JSON.stringify({passed:true,studioBlocked:blocked,shortsBlocked:blocked,verifiedRangeBytes:256,changedSourceRejected:true,originalBytesMatch:true}));
}finally{await studio.close();if(local)await new Promise(done=>local.close(done));}

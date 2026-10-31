/** Real editor UI verification: disabled mismatches, native playback, exact-source imports and responsive layouts. */
import assert from'node:assert/strict';import{readFile,writeFile,mkdir,stat}from'node:fs/promises';import{join,resolve}from'node:path';import{homedir}from'node:os';import{createHash}from'node:crypto';
import{chromium}from'playwright';
import{SOUND_RECORDINGS}from'../apps/shorts/openfilm/packages/openfilm/src/sound-recordings.mjs';
import{SFX_CATALOG}from'../apps/shorts/openfilm/packages/openfilm/studio/ui/src/frame/lib/sfxLibrary.js';
import{BROWSE_CATALOG}from'../apps/shorts/openfilm/packages/openfilm/studio/ui/src/frame/lib/musicLibrary.js';
const out=resolve(process.env.CLYRA_QA_OUTPUT||'docs/qa/2026-10-29-exact-sounds');await mkdir(out,{recursive:true});
const run=JSON.parse(await readFile(join(process.env.OPENFILM_HOME||join(homedir(),'.openfilm'),'run.json'),'utf8'));
const auth={'x-studio-key':run.key,'content-type':'application/json'};
const response=await fetch(run.origin+'/api/projects',{method:'POST',headers:auth,body:JSON.stringify({path:resolve('apps/shorts/app/frame-projects/Exact sounds verified QA 29 Oct')})});
assert.equal(response.status,200);const{project}=await response.json();
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
page.setDefaultTimeout(8000);const errors=[],playback=[],imports=[],layouts=[],blocked=[];
page.on('pageerror',e=>errors.push(String(e)));
await page.addInitScript(()=>{
 const NativeAudio=window.Audio;window.__audioRecords=[];window.__audioObjects=[];
 window.Audio=function(src){const a=new NativeAudio(src),row={src,playing:false,error:null};window.__audioRecords.push(row);window.__audioObjects.push(a);a.addEventListener('playing',()=>row.playing=true);a.addEventListener('error',()=>row.error=a.error?.message);return a;};
});
try{
 const url=new URL('/projects/'+project.id,run.origin);url.searchParams.set('key',run.key);await page.goto(url.toString());
 async function panel(name){const button=page.getByRole('button',{name,exact:true});await button.waitFor();if(await button.getAttribute('aria-pressed')!=='true')await button.click();}
 async function play(entry){
   const row=page.locator(`[data-sound-id="${entry.id}"]`);await row.waitFor();
   const button=row.getByRole('button',{name:'Play '+entry.name,exact:true});await button.waitFor();await page.waitForFunction(id=>!document.querySelector(`[data-sound-id="${id}"] button`)?.disabled,entry.id);
   const index=await page.evaluate(()=>window.__audioObjects.length);await button.click();
   await page.waitForFunction(i=>{const a=window.__audioObjects[i],r=window.__audioRecords[i];return !!a&&r.playing&&a.duration>0&&(a.currentTime>.025||a.ended);},index,{timeout:6000});
   const proof=await page.evaluate(i=>({playing:window.__audioRecords[i].playing,error:window.__audioRecords[i].error,duration:window.__audioObjects[i].duration,time:window.__audioObjects[i].currentTime}),index);
   assert.equal(proof.error,null,entry.id);playback.push({id:entry.id,...proof});
   const stop=row.getByRole('button',{name:'Stop '+entry.name,exact:true});if(await stop.count())await stop.click();
 }
 await panel('Sound FX');
 for(const group of ['normal','brainrot']){
   await page.getByRole('button',{name:group==='normal'?'Normal':'Brainrot',exact:true}).click();
   for(const entry of SFX_CATALOG.filter(s=>s.group===group)){
     const row=page.locator(`[data-sound-id="${entry.id}"]`);await row.waitFor();
     if(SOUND_RECORDINGS[entry.id].status==='unresolved'){
       assert.equal(await row.getByRole('button',{name:'Play '+entry.name,exact:true}).isDisabled(),true);
       assert.equal(await row.getByRole('button',{name:'Add '+entry.name+' to timeline',exact:true}).isDisabled(),true);
       assert.match(await row.innerText(),/Unresolved recording/);blocked.push(entry.id);
       const direct=await context.request.get(run.origin+'/api/editor-audio/'+entry.id,{headers:auth});assert.equal(direct.status(),409);
     }else{
       await play(entry);assert.equal(await row.getByRole('link',{name:'Source for '+entry.name,exact:true}).getAttribute('href'),SOUND_RECORDINGS[entry.id].pageUrl);
     }
   }
 }
 await panel('Music');for(const entry of BROWSE_CATALOG)await play(entry);
 for(const id of ['whoosh','fah']){
   await panel('Sound FX');const entry=SFX_CATALOG.find(s=>s.id===id);await page.getByRole('button',{name:entry.group==='brainrot'?'Brainrot':'Normal',exact:true}).click();
   await page.locator(`[data-sound-id="${id}"]`).getByRole('button',{name:'Add '+entry.name+' to timeline',exact:true}).click();
   const path=join(project.path,'audio',id+'.mp3');let ready=false;for(let i=0;i<30;i++){if(await stat(path).catch(()=>null)){ready=true;break;}await new Promise(r=>setTimeout(r,100));}assert.ok(ready,id+' file imported');
   const sha256=createHash('sha256').update(await readFile(path)).digest('hex');assert.equal(sha256,SOUND_RECORDINGS[id].sha256);imports.push({id,path,sha256});
   await page.waitForTimeout(250);
 }
 await page.getByRole('button',{name:'Normal',exact:true}).click();
 for(const width of [320,375,768,1024,1440]){
   await page.setViewportSize({width,height:1000});await page.waitForTimeout(450);
   const inspector=page.locator('[data-inspector-panel]');if(await inspector.count())await inspector.getByRole('button',{name:'Hide inspector',exact:true}).click();
   const metrics=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,rows:[...document.querySelectorAll('[data-sound-id]')].map(e=>({id:e.dataset.soundId,width:e.clientWidth,scroll:e.scrollWidth}))}));
   assert.equal(metrics.width,metrics.scroll);for(const row of metrics.rows)assert.ok(row.scroll<=row.width,row.id+' row overflow');layouts.push(metrics);
   await page.screenshot({path:join(out,'sounds-'+width+'.png')});
 }
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('radio',{name:'Dark',exact:true}).click();await page.keyboard.press('Escape');await page.waitForTimeout(400);await page.screenshot({path:join(out,'sounds-dark-1440.png')});
 await page.emulateMedia({reducedMotion:'reduce'});await page.screenshot({path:join(out,'sounds-reduced-motion.png')});
 assert.equal(errors.length,0);
 const report={project:{id:project.id,path:project.path},verifiedPlayback:playback.length,playback,blocked,imports,layouts,errors};await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({projectId:project.id,verifiedPlayback:playback.length,blocked:blocked.length,imports:imports.length,widths:layouts.map(l=>l.width),errors}));
}finally{await browser.close();}

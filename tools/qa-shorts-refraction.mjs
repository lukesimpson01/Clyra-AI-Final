/** Real-browser optical/performance fixture. Outputs recording, screenshots and measured frame intervals. */
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
const output='/tmp/clyra-refraction-qa';await mkdir(output,{recursive:true});
const bundle=await build({entryPoints:['apps/shorts/openfilm/packages/openfilm/studio/ui/src/frame/nameDropRipple.ts'],bundle:true,write:false,format:'iife',globalName:'ClyraRippleQA'});
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1024,height:768},recordVideo:{dir:output,size:{width:1024,height:768}}});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
await page.setContent(`<style>*{box-sizing:border-box}body{margin:0;background:#e9eaec;font:16px system-ui;color:#252527}#surface{padding:36px;height:768px}h1{font-size:34px;letter-spacing:-1px}p{line-height:1.6}section{display:grid;grid-template-columns:1fr 1fr;gap:20px}article{background:white;border:1px solid #aeb1b7;border-radius:18px;padding:22px}button,input{font:inherit;padding:12px 18px;border:1px solid #80838a;border-radius:12px}button{background:#325cff;color:white;cursor:pointer}hr{border:0;border-top:1px solid #7f8591}img{width:100%;height:150px;border-radius:12px}#scroll{height:170px;overflow:auto;border-left:1px solid #80838a;padding-left:16px}</style><main id="surface"><h1>Continuous glass refraction</h1><p>A <strong>precise pressure wave</strong> bends this real interface. Thin borders, <em>different weights</em> and the image return to their original positions.</p><hr><section><article><h2>Live interaction</h2><p>Buttons, typing and selection stay available.</p><button id="action">Try the button</button> <output id="count">0</output><p><input aria-label="Editable text" placeholder="Type here"></p></article><article><img alt="Optical colour and shape reference" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='500' height='180'%3E%3Cdefs%3E%3ClinearGradient id='g'%3E%3Cstop stop-color='%230e2345'/%3E%3Cstop offset='1' stop-color='%2398b7c6'/%3E%3C/linearGradient%3E%3C/defs%3E%3Cpath fill='url(%23g)' d='M0 0h500v180H0z'/%3E%3Cpath stroke='white' fill='none' d='M0 90h500M250 0v180M0 30h500M0 150h500M125 0v180M375 0v180'/%3E%3C/svg%3E"><p>Detailed content and straight dividing lines.</p></article><article><h2>Scrollable content</h2><div id="scroll">${Array.from({length:12},(_,i)=>`<p>Row ${i+1} · Natural scrolling and selectable text.</p>`).join('')}</div></article><article><h2>Quiet optical depth</h2><p>One curved wave, compression, ridge and relaxation.</p><hr><p>No permanent layout changes.</p></article></section></main>`);
await page.addScriptTag({content:bundle.outputFiles[0].text});
await page.evaluate(()=>{
  const s=document.getElementById('surface');window.__destroy=ClyraRippleQA.createNameDropRipple(s,{adaptive:false});
  const a=[];let last=performance.now();window.__timings=a;
  const record=t=>{a.push(t-last);last=t;window.__raf=requestAnimationFrame(record)};requestAnimationFrame(record);
  document.getElementById('action').onclick=()=>document.getElementById('count').value=String(Number(document.getElementById('count').value)+1);
});
await page.getByRole('button',{name:'Try the button'}).click();await page.getByLabel('Editable text').fill('Interaction stays intact');
await page.locator('#scroll').evaluate(el=>{el.scrollTop=80;});
await page.screenshot({path:`${output}/down.png`});
// Keep a multi-minute profile without tying up one tool call: this script runs as a normal background process.
await page.waitForTimeout(Number(process.env.CLYRA_RIPPLE_QA_MS||125000));
await page.screenshot({path:`${output}/repeat.png`});
const measured=await page.evaluate(()=>{
  const a=window.__timings.filter(x=>x>0).sort((a,b)=>a-b),surface=document.getElementById('surface');
  const result={frames:a.length,p50:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],slowOver100:a.filter(x=>x>100).length,filterActive:surface.style.filter,typed:document.querySelector('input').value,clicked:document.getElementById('count').value,scroll:document.getElementById('scroll').scrollTop};
  window.__destroy();cancelAnimationFrame(window.__raf);return {...result,cleaned:surface.style.filter===''&&!document.querySelector('filter')};
});
await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>{window.__destroy=ClyraRippleQA.createNameDropRipple(document.getElementById('surface'));});
const reduced=await page.evaluate(()=>document.getElementById('surface').style.filter==='');
await page.evaluate(()=>window.__destroy());const video=page.video();await context.close();const recording=await video.path();await browser.close();
const report={...measured,reducedMotion:reduced,errors,recording};await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));

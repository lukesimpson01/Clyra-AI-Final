/** Cross-engine smoke tests against an already running Studio. CLYRA_STUDIO_QA_URL must include its local session URL. */
import { firefox, webkit } from 'playwright';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
const url=process.env.CLYRA_STUDIO_QA_URL;if(!url)throw new Error('Set CLYRA_STUDIO_QA_URL to the running Studio project.');
const out='/tmp/clyra-browser-qa';await mkdir(out,{recursive:true});
const bundle=await build({entryPoints:['apps/shorts/openfilm/packages/openfilm/studio/ui/src/frame/nameDropRipple.ts'],bundle:true,write:false,format:'iife',globalName:'Ripple'});
const reports=[];
for(const [engine,type] of Object.entries({firefox,webkit})){
  let browser;const errors=[];
  try{
    browser=await type.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(String(e)));
    await page.goto(url);await page.locator('[data-block-title="IMG_1899.MOV"]').waitFor({state:'attached'});
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('frame-seek',{detail:.4})));
    await page.waitForTimeout(2500);await page.screenshot({path:`${out}/${engine}-editor.png`});
    const editor={title:await page.title(),viewer:await page.locator('[data-viewer-pane]').count()};
    await page.setContent('<style>body{margin:0;font:22px system-ui;background:#eee}main{height:700px;padding:30px}article{border:1px solid #555;padding:24px;border-radius:16px}input,button{font:inherit;padding:10px}</style><main id="surface"><h1>Live optical refraction</h1><article><p>Text, borders and inputs remain real DOM content.</p><input aria-label="Test input"><button>Count</button><output>0</output></article></main>');
    await page.addScriptTag({content:bundle.outputFiles[0].text});await page.evaluate(()=>{window.__destroy=Ripple.createNameDropRipple(document.getElementById('surface'),{adaptive:false});document.querySelector('button').onclick=()=>document.querySelector('output').value='1';});
    await page.getByLabel('Test input').fill('Typed during refraction');await page.getByRole('button',{name:'Count',exact:true}).click();await page.waitForTimeout(2000);await page.screenshot({path:`${out}/${engine}-refraction.png`});
    const interaction=await page.evaluate(()=>({typed:document.querySelector('input').value,clicked:document.querySelector('output').value,filter:document.getElementById('surface').style.filter,svg:!!document.querySelector('feDisplacementMap')}));
    await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>document.getElementById('surface').style.filter==='');const reduced=await page.evaluate(()=>document.getElementById('surface').style.filter==='');await page.evaluate(()=>window.__destroy());reports.push({engine,editor,interaction,reducedMotion:reduced,errors});
  }catch(e){reports.push({engine,error:String(e),errors});}finally{await browser?.close();}
}
await writeFile(`${out}/report.json`,JSON.stringify(reports,null,2));console.log(JSON.stringify(reports,null,2));

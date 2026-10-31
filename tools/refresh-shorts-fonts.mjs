import { FONT_CHOICES } from '../apps/shorts/openfilm/packages/openfilm/studio/ui/src/frame/font-library.js';
import { mkdir,writeFile,stat } from 'node:fs/promises';
const root='apps/shorts/openfilm/packages/openfilm/studio/ui/public/assets/fonts';await mkdir(root,{recursive:true});await mkdir(`${root}/licenses`,{recursive:true});
let cursor=0;const failures=[];
async function download(){for(;;){const font=FONT_CHOICES[cursor++];if(!font)return;if(await stat(`${root}/${font.id}.ttf`).catch(()=>null))continue;try{
  const response=await fetch(`https://api.github.com/repos/google/fonts/contents/ofl/${font.id}`);if(!response.ok)throw new Error(`Font metadata ${response.status}`);const files=await response.json();
  const file=files.filter(f=>f.name.endsWith('.ttf')&&!/italic|ital\[/i.test(f.name)).sort((a,b)=>Number(!/wght/.test(a.name))-Number(!/wght/.test(b.name))||Number(!/regular/i.test(a.name))-Number(!/regular/i.test(b.name)))[0];if(!file)throw new Error('No upright TTF');
  const body=await fetch(file.download_url);if(!body.ok)throw new Error(`Font ${body.status}`);await writeFile(`${root}/${font.id}.ttf`,Buffer.from(await body.arrayBuffer()));
  const license=files.find(f=>/^(OFL|LICENSE).*\.txt$/i.test(f.name));if(license){const text=await fetch(license.download_url).then(r=>r.text());await writeFile(`${root}/licenses/${font.id}.txt`,text);}console.log(`Ready: ${font.name}`);
}catch(e){failures.push(`${font.name}: ${e.message}`);}}}
await Promise.all(Array.from({length:4},download));if(failures.length){console.error(failures.join('\n'));process.exitCode=1;}

/** Vendor the installed Three.js FBX reader and its MIT dependencies beside the existing matching Three runtime. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const dest='apps/shorts/openfilm/packages/openfilm/studio/ui/public/assets/vendor/three/addons';await mkdir(dest,{recursive:true});
for(const [from,to] of [['loaders/FBXLoader.js','FBXLoader.js'],['libs/fflate.module.js','fflate.module.js'],['curves/NURBSCurve.js','NURBSCurve.js'],['curves/NURBSUtils.js','NURBSUtils.js']])await writeFile(`${dest}/${to}`,await readFile(`node_modules/three/examples/jsm/${from}`));
console.log('FBX reader and dependencies prepared.');

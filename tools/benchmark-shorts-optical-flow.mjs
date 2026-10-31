/** A controlled hot-loop benchmark, not a claim about full editor FPS. */
import assert from 'node:assert/strict';import{pathToFileURL}from'node:url';
import * as current from '../apps/shorts/openfilm/packages/openfilm/studio/ui/src/frame/track-core.js';
const baselinePath=process.argv.find(a=>a.startsWith('--baseline='))?.slice(11);
const baseline=baselinePath?await import(pathToFileURL(baselinePath).href):null;
const w=320,h=180;
const frame=(dx,dy)=>Uint8Array.from({length:w*h},(_,i)=>{
 const x=i%w-dx,y=Math.floor(i/w)-dy;
 return Math.max(0,Math.min(255,120+38*Math.sin(x*.17)*Math.cos(y*.13)+28*Math.sin(x*.41+y*.29)+24*Math.cos(x*.27-y*.37)));
});
const images=Array.from({length:11},(_,i)=>frame(i*.6,i*.35)),pyrs=images.map(gray=>current.pyramid(gray,w,h)),points=current.corners(pyrs[0],80,12).filter(([x,y])=>x>20&&x<w-30&&y>20&&y<h-30);
function bench(impl){
 impl.track(pyrs[0],pyrs[1],points,1,3,6);
 const timings=[],output=[];
 for(let repeat=0;repeat<3;repeat++)for(let i=1;i<images.length;i++){
   const at=performance.now(),result=impl.track(pyrs[0],pyrs[i],points,1,3,6);timings.push(performance.now()-at);if(repeat===0)output.push(result);
 }
 timings.sort((a,b)=>a-b);let error=0,observed=0;
 output.forEach((list,i)=>list.forEach((p,j)=>{if(p){observed++;error=Math.max(error,Math.hypot(p[0]-points[j][0]-(i+1)*.6,p[1]-points[j][1]-(i+1)*.35));}}));
 return{frames:timings.length,points:points.length,medianMs:timings[timings.length>>1],p95Ms:timings[Math.floor(timings.length*.95)],maxErrorPx:error,observed,output};
}
const before=baseline&&bench(baseline),after=bench(current);
if(before)assert.deepEqual(after.output,before.output,'optimization must preserve every flow result exactly');
assert.ok(after.maxErrorPx<.3);assert.ok(after.observed>=points.length*9);
delete after.output;if(before)delete before.output;
console.log(JSON.stringify({before,after,identicalResults:!!before,workspaceBytes:(2*3+1)**2*3*8,peakRssMiB:process.resourceUsage().maxRSS/1024,heapLimitMiB:process.execArgv},null,2));

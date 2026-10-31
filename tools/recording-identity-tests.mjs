import assert from 'node:assert/strict';import{readFile}from'node:fs/promises';
import{exactSoundName,requireSoundIdentity,soundPageIdentity,soundCandidates}from'./lib/recording-identity.mjs';
import{SOUND_RECORDINGS}from'../apps/shorts/openfilm/packages/openfilm/src/sound-recordings.mjs';
import{recordingIssue}from'../apps/shorts/openfilm/packages/openfilm/src/recording-identity.mjs';
assert.equal(exactSoundName('Fah'),exactSoundName('fah'));
for(const wrong of ['Fah!','Fah!!','Fahh','Fah 2','Original Fah','Fah slowed'])assert.notEqual(exactSoundName('Fah'),exactSoundName(wrong));
assert.notEqual(exactSoundName('Romance'),exactSoundName('romanceeeeeeeeeeeeee'));
const html='<h1>Fah &amp; Boom!</h1><audio src="/media/sounds/exact.mp3"></audio>';
const identity=soundPageIdentity(html,'https://www.myinstants.com/en/instant/example-2/');
assert.equal(identity.title,'Fah & Boom!');
assert.throws(()=>requireSoundIdentity({id:'x',name:'Fah & Boom'},identity),/title mismatch/);
assert.throws(()=>requireSoundIdentity({id:'x',name:identity.title,sourceUrl:'https://www.myinstants.com/en/instant/example-3/'},identity),/page changed/);
assert.throws(()=>requireSoundIdentity({id:'x',name:identity.title,mediaUrl:'https://www.myinstants.com/media/sounds/other.mp3'},identity),/audio URL changed/);
assert.deepEqual(soundCandidates('<a href="/en/instant/fah-2/">Fah!!</a>'),[{title:'Fah!!',pageUrl:'https://www.myinstants.com/en/instant/fah-2/'}]);
const manifest=JSON.parse(await readFile('shorts-library/recordings.json','utf8'));
let ready=0,unresolved=0;
for(const[id,pin]of Object.entries(SOUND_RECORDINGS)){
  const saved=manifest[id];if(pin.status==='unresolved'){assert.ok(recordingIssue(id,saved));unresolved++;continue;}
  assert.equal(recordingIssue(id,saved,pin.name),null,id);ready++;
  for(const patch of [{sha256:'wrong'},{sourceUrl:pin.pageUrl+'other/'},{mediaUrl:pin.mediaUrl+'?variant=2'},{title:pin.name+'!'},{sourceTitle:pin.title+'!'}, {identity:{status:'unresolved'}}])assert.ok(recordingIssue(id,{...saved,...patch},pin.name),id+' must reject changed identity');
}
console.log(JSON.stringify({passed:true,ready,unresolved,rejectsSimilarNames:true,rejectsChangedPageMediaAndHash:true}));

import test from "node:test";
import assert from "node:assert/strict";
import {readFile,readdir,stat} from "node:fs/promises";
import path from "node:path";
import {bundle,project} from "./bundle.mjs";
import {newRecipe,addPiece,parseRecipe,parseSettings,STAGES} from "../../src/app/akira-kitchen/cooking-model.ts";
const {mission,creamCoverage,rotatePiece,countVoice,stageGroups,SCREEN_VOICE}=await bundle("guidance","src/app/akira-kitchen/cooking-guidance.ts");
test("missions are nonblocking and exactly three strawberries is distinct from four",()=>{
 let recipe=newRecipe("cake");for(let i=0;i<3;i++)recipe=addPiece(recipe,"strawberry");
 assert.equal(mission(recipe).done,true);assert.equal(mission(addPiece(recipe,"strawberry")).done,false);
 recipe=newRecipe("bento");recipe.ready=["onigiri"];recipe=addPiece(addPiece(recipe,"onigiri"),"onigiri");assert.equal(mission(recipe).done,true);
});
test("cream coverage depends on spatial coverage, not repeated taps",()=>{
 assert.equal(creamCoverage([]),0);
 const taps=Array.from({length:40},()=>[{x:50,y:33}]);assert.ok(creamCoverage(taps)<.3);
 const strokes=[20,28,36,44].map(y=>[{x:24,y},{x:76,y}]);assert.ok(creamCoverage(strokes)>.8);
});
test("four rotations return to start and rotations survive old session parser",()=>{
 let recipe=addPiece(newRecipe("bento"),"onigiri");const original=recipe.items[0].rotation;
 for(let i=0;i<4;i++)recipe=rotatePiece(recipe,recipe.items[0].id);
 assert.equal(recipe.items[0].rotation,original);recipe.items[0].rotation=270;assert.equal(parseRecipe(recipe).items[0].rotation,270);
});
test("legacy settings get narration without losing existing preferences",()=>{
 assert.deepEqual(parseSettings({sound:false,bgm:true,volume:.2,language:"ja"}),{sound:false,bgm:true,narration:true,volume:.2,language:"ja"});
 assert.equal(parseSettings({narration:false}).narration,false);
});
test("no instruction exposes more than three step pictures",()=>{
 for(const process of Object.keys(STAGES))for(let i=0;i<=STAGES[process].length;i++)assert.ok(stageGroups(process,i).icons.length<=3);
 assert.equal(Object.keys(SCREEN_VOICE).length,17);
});
test("counting never announces six for a seventh item",()=>{assert.equal(countVoice(6),"count-6");assert.equal(countVoice(7),"praise-4");});
test("all prerecorded narration exists and is shorter than two seconds",async()=>{
 const build=JSON.parse(await readFile(path.join(project,"audio-build.json"),"utf8"));
 const clips=JSON.parse(await readFile(path.join(project,"content/narration.json"),"utf8"));
 for(const key of Object.keys(clips))assert.ok((await stat(path.join(project,"public/akira-kitchen/audio",key+".mp3"))).size>1000);
 const entries=build.files??build.clips;
 assert.ok(Array.isArray(entries));assert.equal(entries.length,Object.keys(clips).length);
 for(const item of entries)assert.ok((item.seconds??item.durationSeconds)<=2);
});
test("runtime media/font/precache budgets and export exclusions hold",async()=>{
 const report=JSON.parse(await readFile(path.join(project,"media-build.json"),"utf8")),pwa=JSON.parse(await readFile(path.join(project,"pwa-build.json"),"utf8"));
 assert.ok(report.imageBytes<=5000000);assert.ok(report.fontBytes<=300000);for(const file of report.files)assert.ok(file.bytes<=150000);
 assert.ok(pwa.precacheBytes<=8000000);assert.ok(pwa.precacheAssets<pwa.assets);
 const files=await readdir(path.join(project,"out/akira-kitchen"));
 assert.ok(!files.some(file=>file.startsWith("illustration-")&&file.endsWith(".png")));
 assert.ok(!(await readdir(path.join(project,"out/akira-kitchen/fonts"))).some(file=>file.endsWith(".ttf")));
});

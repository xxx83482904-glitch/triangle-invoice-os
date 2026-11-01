import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {generated,project} from './bundle.mjs';
import {startServer} from './test-server.mjs';

// Freeze fixtures to the actual 3.0.0 source, not the renderer under test.
const oldCommit='eaceae70a58e0597b1b6d4a64b2f35a004b59a0f';
const oldDir=path.join(generated,'legacy-v3');
await mkdir(oldDir,{recursive:true});
for(const file of ['cooking-art.tsx','illustration-assets.ts','prototype-shapes.ts','media-manifest.json','cooking-model.ts']) {
  const bytes=execFileSync('git',['show',`${oldCommit}:akira-kitchen/src/app/akira-kitchen/${file}`],{cwd:project,maxBuffer:4*1024*1024});
  await writeFile(path.join(oldDir,file),bytes);
}
async function oldBundle(name,entry) {
  const outfile=path.join(generated,name+'.mjs');
  await build({entryPoints:[path.join(oldDir,entry)],outfile,bundle:true,platform:'node',format:'esm',jsx:'automatic',external:['react','react/jsx-runtime']});
  return import(pathToFileURL(outfile));
}
const oldArt=await oldBundle('legacy-v3-art','cooking-art.tsx');
const oldAssets=await oldBundle('legacy-v3-assets','illustration-assets.ts');
const oldModel=await oldBundle('legacy-v3-model','cooking-model.ts');
const sharp=createRequire(new URL('../../package.json',import.meta.url))('sharp');
const loadImage=async url=>'data:image/png;base64,'+(await sharp(await readFile(project+'public'+url)).png().toBuffer()).toString('base64');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fixtures=[];
for(const mode of ['bento','cake']) {
  const seed=oldArt.sampleRecipe(mode,oldModel.newRecipe(mode));
  seed.id='legacy-'+mode;
  for(const key of Object.keys(seed.progress)) seed.progress[key]=oldModel.STAGES[key].length;
  seed.ready=mode==='bento'?['onigiri','tamago','karaage','broccoli','tomato','carrot']:[];
  seed.items[0].rotation=90;
  const recipe=oldModel.parseRecipe(seed);
  const svg=await oldAssets.embedIllustrations(oldArt.dishSVG(recipe),loadImage);
  fixtures.push({id:seed.id,recipe,svg,createdAt:'2026-10-31T03:00:00.000Z',storage:mode==='bento'?'Blob':'ArrayBuffer'});
}
const output=path.resolve(process.env.AKIRA_QA_OUTPUT || path.join(project,'../outputs/akira-v3.1-impl-2026-11-01/screenshots'));
await mkdir(output,{recursive:true});
const server=await startServer(),browser=await chromium.launch({executablePath:process.env.AKIRA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const checks=[],errors=[],details=[];
const check=name=>{checks.push(name);console.log('PASS '+name);};
try {
  for(const mode of ['bento','cake']) {
    const context=await browser.newContext({viewport:{width:1024,height:768},deviceScaleFactor:2,hasTouch:true,isMobile:true,locale:'ja-JP',reducedMotion:'reduce'});
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    // A one-use setup document lets us seed the old origin before app save
    // listeners run, and avoids the browser's unrelated root favicon request.
    await page.route(server.base,r=>r.fulfill({contentType:'text/html',body:'<!doctype html><link rel="icon" href="data:,"><title>Legacy data setup</title>'}),{times:1});
    await page.goto(server.base);
    const draft=structuredClone(fixtures.find(f=>f.recipe.mode===mode).recipe);draft.id='old-session-'+mode;
    const session={version:2,screen:mode==='bento'?7:14,recipe:draft,settings:oldModel.DEFAULT_SETTINGS};
    // The old parser also bounds ellipse-edge points on every read; compare its
    // exact result (including IEEE-754 rounding), rather than weakening equality.
    const expectedRecipe=oldModel.parseRecipe(draft);
    await page.evaluate(async ({fixtures,session})=>{
      const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('akira-kitchen-album',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onupgradeneeded=()=>r.result.createObjectStore('works',{keyPath:'id'});});
      await new Promise((resolve,reject)=>{const tx=db.transaction('works','readwrite');
        for(const f of fixtures) {const blob=new Blob([f.svg],{type:'image/svg+xml'}),bytes=new TextEncoder().encode(f.svg).buffer;tx.objectStore('works').put({id:f.id,recipe:f.recipe,createdAt:f.createdAt,image:f.storage==='Blob'?blob:bytes,imageType:'image/svg+xml'});}
        tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
      });db.close();localStorage.setItem('akira-kitchen:session:v2',JSON.stringify(session));
    },{fixtures,session});
    await page.goto(server.base);const resume=page.getByRole('button',{name:'つづきから',exact:true});await resume.waitFor();assert.equal(await resume.count(),1);await resume.tap();
    await page.locator(`[data-screen="${session.screen}"][aria-busy="false"]`).waitFor();await page.waitForTimeout(250);
    const restored=await page.evaluate(()=>JSON.parse(localStorage.getItem('akira-kitchen:session:v2')));
    assert.deepEqual(restored.recipe,expectedRecipe);check(mode+': old session v2 resumes once with exactly the legacy parser result');
    const positions=await page.locator('[data-board]').evaluate(board=>{
      const svg=board.querySelector('[data-dish]'),v=svg.viewBox.baseVal,r=svg.getBoundingClientRect();
      return [...board.querySelectorAll('[data-piece]')].map(el=>{const p=el.getBoundingClientRect();return{id:el.dataset.piece,x:v.x+(p.x+p.width/2-r.x)/r.width*v.width,y:v.y+(p.y+p.height/2-r.y)/r.height*v.height};});
    });
    for(const p of draft.items) {
      const actual=positions.find(a=>a.id===p.id),expected=mode==='bento'?{x:(p.x*8-20)*800/760,y:(p.y*5-15)*400/470}:{x:p.x*8,y:p.y*5};
      assert.ok(Math.abs(actual.x-expected.x)<.06 && Math.abs(actual.y-expected.y)<.06,JSON.stringify({actual,expected}));
    }
    await page.screenshot({path:path.join(output,`legacy-${mode}-resume.png`)});
    check(mode+': original piece centers and rotations match the new board transform');
    const tap=async name=>{await page.getByRole('button',{name,exact:true}).tap();await page.waitForTimeout(220);};
    await tap('できた！');
    const visibleSvg=await page.locator('[data-dish]').evaluate(svg=>({box:svg.getAttribute('viewBox'),transforms:[...svg.querySelectorAll('g[transform]')].map(g=>g.getAttribute('transform'))}));
    await tap('たべてみる');await tap('アルバムへ');await tap('ほぞんする');await page.getByRole('button',{name:'アルバムへ',exact:true}).waitFor({timeout:15000});await tap('アルバムへ');
    await page.locator('[data-screen="16"]').waitFor();
    const images=page.locator('img[alt^="つくった"]');assert.equal(await images.count(),3);
    await images.evaluateAll(async els=>{for(const img of els){await img.decode();if(img.naturalWidth<800)throw Error('Missing old or new artwork image');}});
    await page.screenshot({path:path.join(output,`legacy-${mode}-album.png`)});
    check(mode+': legacy Blob and ArrayBuffer images and the new save all render in the album');
    const records=await page.evaluate(async()=>{
      const db=await new Promise(resolve=>{const r=indexedDB.open('akira-kitchen-album',1);r.onsuccess=()=>resolve(r.result);});
      const all=await new Promise(resolve=>{const r=db.transaction('works').objectStore('works').getAll();r.onsuccess=()=>resolve(r.result);});db.close();
      return Promise.all(all.map(async r=>({...r,storage:r.image instanceof Blob?'Blob':'ArrayBuffer',image:await (r.image instanceof Blob?r.image:new Blob([r.image])).text()})));
    });
    for(const fixture of fixtures) {
      const stored=records.find(r=>r.id===fixture.id);assert.equal(stored.storage,fixture.storage);assert.equal(hash(stored.image),hash(fixture.svg));assert.deepEqual(stored.recipe,fixture.recipe);
    }
    const saved=records.find(r=>r.id===draft.id);assert.deepEqual(saved.recipe,expectedRecipe);
    const geometry=await page.evaluate(svg=>{const doc=new DOMParser().parseFromString(svg,'image/svg+xml');return{box:doc.documentElement.getAttribute('viewBox'),transforms:[...doc.querySelectorAll('g[transform]')].map(g=>g.getAttribute('transform')),externalImages:[...doc.querySelectorAll('image')].filter(i=>!(i.getAttribute('href')||i.getAttributeNS('http://www.w3.org/1999/xlink','href')||'').startsWith('data:')).length};},saved.image);
    assert.equal(geometry.box,visibleSvg.box);assert.deepEqual(geometry.transforms,visibleSvg.transforms);assert.equal(geometry.externalImages,0);
    await page.reload();await page.locator('[data-screen="16"][aria-busy="false"]').waitFor();assert.equal(await images.count(),3);
    check(mode+': old records remain byte-identical; new SVG uses screen geometry and survives reload');
    details.push({mode,oldImages:fixtures.map(f=>({id:f.id,storage:f.storage,sha256:hash(f.svg)})),newImage:{viewBox:geometry.box,pieces:saved.recipe.items.length,sha256:hash(saved.image)}});
    await context.close();
  }
  assert.deepEqual(errors,[]);check('both isolated legacy contexts have no runtime or console errors');
} finally {
  await writeFile(path.join(output,'legacy-data.json'),JSON.stringify({fixtureSourceCommit:oldCommit,checks,errors,details},null,2));
  await browser.close();await server.close();
}

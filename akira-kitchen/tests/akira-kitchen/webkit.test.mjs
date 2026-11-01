import assert from "node:assert/strict";
import {mkdir,writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {webkit} from "playwright";
import {startServer} from "./test-server.mjs";
const server=await startServer(),browser=await webkit.launch({headless:true});
const context=await browser.newContext({viewport:{width:1024,height:768},hasTouch:true,isMobile:true,locale:"ja-JP",reducedMotion:"reduce"});
const page=await context.newPage(),checks=[],errors=[];
page.on("pageerror",e=>errors.push(e.message));page.on("console",m=>{if(m.type()==="error")errors.push(m.text());});
page.setDefaultTimeout(8000);
const output=path.resolve(process.env.AKIRA_QA_OUTPUT || fileURLToPath(new URL("../../docs/akira-kitchen/qa/browser-v3/",import.meta.url)));await mkdir(output,{recursive:true});
const tap=async name=>{await page.getByRole("button",{name,exact:true}).tap();await page.waitForTimeout(300);};
const screen=async n=>page.locator('[data-screen="'+n+'"][aria-busy="false"]').waitFor();
const cook=async p=>{const el=page.locator('[data-process="'+p+'"]');for(let i=0;i<16&&await el.getAttribute("aria-label")!=="できた！";i++){await el.tap();await page.waitForTimeout(90);}assert.equal(await el.getAttribute("aria-label"),"できた！");};
const check=name=>{checks.push(name);console.log("PASS WebKit "+name);};
try{
 await page.goto(server.base);await tap("おべんとう");await tap("おにぎり");await tap("うめ");await cook("rice");await tap("メニューへ");await tap("つめよう");
 await tap("おにぎりを のせる");await tap("おにぎりを のせる");await tap("できた！");await tap("たべてみる");
 await page.locator("[data-eat]").last().tap();await page.waitForTimeout(80);await page.locator("[data-eat]").last().tap();
 await tap("アルバムへ");await tap("ほぞんする");await page.getByRole("button",{name:"アルバムへ",exact:true}).waitFor();await tap("アルバムへ");await screen(16);
 await page.reload();await screen(16);await page.locator('img[alt="つくった おべんとう"]').waitFor();assert.equal(await page.locator('img[alt="つくった おべんとう"]').count(),1);check("touch cooking, packing, tasting and persistent bento album");
 await tap("ホーム");await tap("ケーキ");await tap("いちご");await tap("つくろう");await cook("batter");await tap("つぎへ");await cook("bake");await tap("つぎへ");
 const box=await page.locator("[data-board]").boundingBox();
 for(let n=0;n<5&&await page.getByRole("progressbar").count();n++){
   await page.mouse.move(box.x+box.width*.24,box.y+box.height*(.25+n*.03));await page.mouse.down();
   await page.mouse.move(box.x+box.width*.76,box.y+box.height*.27,{steps:20});await page.mouse.move(box.x+box.width*.74,box.y+box.height*.43,{steps:10});await page.mouse.move(box.x+box.width*.25,box.y+box.height*.43,{steps:20});await page.mouse.up();await page.waitForTimeout(130);
 }
 assert.equal(await page.getByRole("progressbar").count(),0);
 await tap("いちごを のせる");await tap("いちごを のせる");await tap("いちごを のせる");await tap("できた！");await tap("たべてみる");await tap("アルバムへ");await tap("ほぞんする");await page.getByRole("button",{name:"アルバムへ",exact:true}).waitFor();await tap("アルバムへ");
 assert.equal(await page.locator('img[alt^="つくった"]').count(),2);
 await page.screenshot({path:path.join(output,"webkit-album.png")});check("cake ingredients, oven, pointer icing and topping save");
 await page.locator('img[alt="つくった ケーキ"]').tap();await page.screenshot({path:path.join(output,"webkit-saved-cake.png")});check("saved embedded-image SVG renders in WebKit");
 assert.deepEqual(errors,[]);check("no WebKit runtime or console errors");
}catch(error){await page.screenshot({path:path.join(output,"webkit-failure.png")});console.log(await page.locator("button").allTextContents());console.log(await page.evaluate(()=>localStorage.getItem("akira-kitchen:session:v2")));throw error;}finally{await writeFile(path.join(output,"webkit.json"),JSON.stringify({engine:"Playwright WebKit (Windows), not a physical iPad",checks,errors},null,2));await browser.close();await server.close();}

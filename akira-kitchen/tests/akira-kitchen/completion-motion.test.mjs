import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {startServer} from './test-server.mjs';
import {measureLayout} from './layout-measurements.mjs';
const server=await startServer(),browser=await chromium.launch({executablePath:process.env.AKIRA_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const context=await browser.newContext({viewport:{width:1024,height:768},deviceScaleFactor:2,hasTouch:true,isMobile:true,reducedMotion:'no-preference'}),page=await context.newPage();
const output=path.resolve(process.env.AKIRA_QA_OUTPUT||'outputs/akira-v3.1-impl-2026-11-01/screenshots');await mkdir(output,{recursive:true});
const checks=[],errors=[],measurements=[];page.on('pageerror',e=>errors.push(e.message));
const check=name=>{checks.push(name);console.log('PASS '+name);};
try {
  await page.goto(server.base);await page.getByRole('button',{name:'おべんとう',exact:true}).tap();await page.getByRole('button',{name:'おにぎり',exact:true}).tap();
  const target=page.locator('[data-process="rice"]');
  for(let i=0;i<30 && await target.getAttribute('aria-label')!=='できた！';i++){await target.tap();await page.waitForTimeout(90);}
  assert.equal(await target.getAttribute('aria-label'),'できた！');
  assert.ok(await page.locator('[class*="confetti"]').count()>0);check('completion starts confetti with normal motion enabled');
  for(const delay of [650,1200]) {
    await page.waitForTimeout(delay);const layout=await measureLayout(page);measurements.push(layout);
    assert.ok(layout.foods[0].paint.width>490 && layout.foods[0].paint.height>430);
    const state=await target.locator('svg').first().evaluate(e=>({opacity:getComputedStyle(e).opacity,transform:getComputedStyle(e).transform}));
    assert.equal(state.opacity,'1');assert.ok(['none','matrix(1, 0, 0, 1, 0, 0)'].includes(state.transform));
  }
  await page.screenshot({path:path.join(output,'complete-rice-normal-motion.png')});check('completed food remains large after the joy animation ends');
  await page.getByRole('button',{name:'つぎへ',exact:true}).tap();await page.locator('[data-screen="4"]').waitFor();assert.deepEqual(errors,[]);check('next action remains usable after completion');
} finally {await writeFile(path.join(output,'completion-motion.json'),JSON.stringify({checks,errors,measurements},null,2));await browser.close();await server.close();}

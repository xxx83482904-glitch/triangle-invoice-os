import { test,expect } from '@playwright/test';
const TOKEN='e2e-mock-only-'+'x'.repeat(40);

test('history controls show partial coverage, pause/resume, backup distinction and mobile layout',async({page})=>{
  let state='idle';const actions:string[]=[];
  await page.route('**/api/history',async route=>{
    const req=route.request();
    if(req.method()==='POST') {const action=req.postDataJSON().action;actions.push(action);state=action==='pause'?'paused':'running';}
    const sync={state,phase:state==='idle'?'discovery':'messages',discovered:120,processed:15,saved:700,pages:85,complete:false,failed:2,ambiguous:1};
    await route.fulfill({json:req.method()==='POST'?sync:{supported:true,sync,backup:{files:20000,logical_bytes:100000000000,session_candidates:1700,imported_messages:0,header_counts:{rmfh:18000},inventory_complete:true,inspected_at:new Date().toISOString()}}});
  });
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await page.getByLabel('このアプリの接続キー',{exact:true}).fill(TOKEN);
  await page.getByRole('button',{name:'このPCに接続',exact:true}).click();
  await page.getByRole('button',{name:'通知設定を開く',exact:true}).click();
  const card=page.getByRole('article',{name:'過去履歴の取り込み',exact:true});
  await expect(card).toBeVisible();
  await card.getByRole('button',{name:'PC内の会話・履歴を取り込む'}).click();
  await expect(card.getByRole('status')).toContainText('取り込み中');
  await card.getByRole('button',{name:'一時停止',exact:true}).click();
  await expect(card.getByRole('status')).toHaveText('一時停止');
  await card.getByRole('button',{name:'続きから再開'}).click();
  expect(actions).toEqual(['start','pause','resume']);
  await card.getByText('バックアップの確認結果',{exact:true}).click();
  await expect(card.getByText('本文の直接取り込みには未対応です。',{exact:false})).toBeVisible();
  await page.setViewportSize({width:320,height:700});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
});

import { test, expect, Page } from "@playwright/test";
const TOKEN = "e2e-mock-only-" + "x".repeat(40);
const ORIGIN = "http://127.0.0.1:8877";

async function login(page: Page, url = "/") {
  await page.goto(url);
  await page.getByLabel("このアプリの接続キー",{exact:true}).fill(TOKEN);
  await page.getByRole("button",{name:"このPCに接続",exact:true}).click();
  await expect(page.getByText("リアルタイム接続",{exact:true})).toBeAttached();
}

test("normal chat flow: new incoming rings once, notification opens the right chat, user replies", async ({page}) => {
  await page.addInitScript(() => {
    (window as unknown as {tones:number}).tones = 0;
    const original = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function(...args) {
      (window as unknown as {tones:number}).tones++;
      return original.apply(this, args);
    };
  });
  const errors:string[]=[]; page.on("pageerror", e => errors.push(e.message));
  await page.setViewportSize({width:390,height:844});
  await login(page);
  await expect(page.getByLabel("チャットの並び順")).toHaveValue("recent");
  await page.getByRole("button",{name:"通知設定を開く",exact:true}).click();
  const card = page.getByRole("article",{name:"新着通知",exact:true});
  await card.getByRole("button",{name:"通知音をオン",exact:true}).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as {tones:number}).tones)).toBe(2);
  await page.getByRole("button",{name:"チャット一覧",exact:true}).click();
  await page.getByTestId("chat-mock:lin").click();
  const chats=await (await page.request.get("/api/chats")).json();
  const group=chats.find((c:{external_id:string})=>c.external_id==="mock:studio");
  // Wait for the notification feed's initial baseline before generating arrival.
  await page.waitForTimeout(300);
  await page.request.post("/api/mock",{headers:{Origin:ORIGIN},data:{action:"receive",chat_id:group.id}});
  const toast=page.getByRole("status",{name:"新着メッセージ",exact:true});
  await expect(toast).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as {tones:number}).tones)).toBe(4);
  await toast.getByRole("button",{name:/日中デザイン室/}).click();
  await expect(page.locator(".conversation-title h2")).toHaveText(group.name);
  await expect(page.getByLabel("メッセージを入力",{exact:true})).toBeVisible();
  let sends=0;page.on("request",r=>{if(r.method()==="POST"&&/\/send$/.test(r.url()))sends++;});
  await page.getByLabel("メッセージを入力",{exact:true}).fill("通知から確認して返信しました");
  await page.getByLabel("メッセージを送信",{exact:true}).click();
  await expect(page.locator(".message-row").filter({hasText:"通知から確認して返信しました"}).getByText("送信確認済み",{exact:true})).toBeVisible();
  expect(sends).toBe(1);
  // Neither a sent echo, a history refresh nor a page reload is a new arrival.
  await page.request.post("/api/sync",{headers:{Origin:ORIGIN},data:{}});
  expect(await page.evaluate(() => (window as unknown as {tones:number}).tones)).toBe(4);
  await page.reload();
  await expect(page.getByLabel("チャットの並び順")).toHaveValue("recent");
  await expect(page.getByRole("status",{name:"新着メッセージ",exact:true})).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as {tones:number}).tones)).toBe(0);
  await page.setViewportSize({width:320,height:720});
  await page.getByRole("button",{name:"通知設定を開く",exact:true}).click();
  await card.scrollIntoViewIfNeeded();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("notification deep link survives login and never sends a message", async ({page}) => {
  await page.request.post("/api/auth/login",{headers:{Origin:ORIGIN},data:{token:TOKEN}});
  const chats=await (await page.request.get("/api/chats")).json();
  await page.request.post("/api/auth/logout",{headers:{Origin:ORIGIN},data:{}});
  const chosen=chats.find((c:{external_id:string})=>c.external_id==="mock:lin");
  let sends=0;page.on("request",r=>{if(r.method()==="POST"&&/\/send$/.test(r.url()))sends++;});
  await page.setViewportSize({width:390,height:844});
  await login(page,"/?chat="+chosen.id);
  await expect(page.locator(".conversation-title h2")).toHaveText(chosen.name);
  expect(sends).toBe(0);
});

test("background push invokes the real worker notification API with a generic notice only", async ({page,context}) => {
  await context.grantPermissions(["notifications"],{origin:ORIGIN});
  const cdp=await context.newCDPSession(page);
  let registrationId="";
  const workerErrors:unknown[]=[];
  cdp.on("ServiceWorker.workerErrorReported",event=>workerErrors.push(event));
  cdp.on("ServiceWorker.workerRegistrationUpdated", event=>{
    const reg=event.registrations.find((r:{scopeURL:string,isDeleted:boolean})=>r.scopeURL===ORIGIN+"/"&&!r.isDeleted);
    if(reg)registrationId=reg.registrationId;
  });
  await cdp.send("ServiceWorker.enable");
  await login(page);
  await page.evaluate(async()=>{await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;});
  await expect.poll(()=>registrationId).not.toBe("");
  const worker=context.serviceWorkers().find(w=>w.url()===ORIGIN+'/sw.js')!;
  // Headless Chrome accepts showNotification but has no OS notification UI.
  // Observe the real call and delegate to the original API; do not claim device delivery.
  await worker.evaluate(()=>{
    const w=globalThis as unknown as {registration:ServiceWorkerRegistration;notices:unknown[]};
    w.notices=[];
    const original=w.registration.showNotification.bind(w.registration);
    w.registration.showNotification=(title,options)=>{w.notices.push({title,...options});return original(title,options);};
  });
  const chats=await (await page.request.get("/api/chats")).json();
  const chosen=chats.find((c:{external_id:string})=>c.external_id==="mock:studio");
  await cdp.send("ServiceWorker.deliverPushMessage", {origin:ORIGIN,registrationId,data:JSON.stringify({v:1,event_id:123,chat_id:chosen.id,body:"MUST NEVER APPEAR"})});
  await expect.poll(()=>worker.evaluate(()=>(globalThis as unknown as {notices:unknown[]}).notices)).toEqual([
    expect.objectContaining({title:"こもれび",body:"新しいメッセージが届きました。タップして返信できます。",data:{chat_id:chosen.id}})
  ]);
  expect(workerErrors).toEqual([]);
});

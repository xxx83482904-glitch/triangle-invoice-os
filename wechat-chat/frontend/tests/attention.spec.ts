import { test, expect, Page } from "@playwright/test";

const TOKEN = "e2e-mock-only-" + "x".repeat(40);
const ORIGIN = "http://127.0.0.1:8877";
async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("このアプリの接続キー").fill(TOKEN);
  await page.getByRole("button", {name:"このPCに接続",exact:true}).click();
  await page.getByRole("button",{name:"対応すること",exact:true}).click();
  await expect(page.getByRole("heading", {name:"会話を、次の一歩へ。"})).toBeVisible();
  await expect(page.locator(".attention-card").first()).toBeVisible();
}

test("priority reasons, manual override, ordering and no automatic sends", async ({page}) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({width:1440,height:960});
  await login(page);
  await expect(page.locator(".assist-mode")).toContainText("優先度は簡易ルール");
  await expect(page.locator(".attention-card").first()).toContainText("日中デザイン室");
  await expect(page.locator(".attention-card").first()).toContainText("あなたへの依頼か確認");
  await page.screenshot({path:"../test-results/attention-desktop.png"});
  await page.getByLabel("林 佳怡の優先度").selectOption("high");
  await expect(page.locator(".attention-card").first()).toContainText("林 佳怡");
  await page.reload();
  await page.getByRole("button",{name:"対応すること",exact:true}).click();
  await expect(page.getByLabel("林 佳怡の優先度")).toHaveValue("high");
  await page.getByLabel("林 佳怡の優先度").selectOption("auto");
  const queue = await (await page.request.get("/api/queue")).json();
  expect(queue).toHaveLength(0);
  expect(errors).toEqual([]);
});

test("reply suggestions append to the draft and require a separate send", async ({page}) => {
  await login(page);
  await page.getByRole("button", {name:"チャット一覧",exact:true}).click();
  await page.getByTestId("chat-mock:lin").click();
  await page.getByLabel("メッセージを入力",{exact:true}).fill("自分で書いた下書き");
  await page.getByRole("button", {name:"対応すること",exact:true}).click();
  const card = page.locator(".attention-card").filter({has:page.getByRole("heading",{name:"林 佳怡",exact:true})});
  await card.getByRole("button",{name:"返信案を見る",exact:true}).click();
  await card.getByRole("button",{name:"下書きに入れる",exact:true}).first().click();
  await expect(page.getByLabel("メッセージを入力",{exact:true})).toHaveValue("自分で書いた下書き\n\nご連絡ありがとうございます。内容を確認して、改めてお返事します。");
  expect(await (await page.request.get("/api/queue")).json()).toHaveLength(0);
  await page.getByLabel("メッセージを送信",{exact:true}).click();
  await expect(page.locator(".message-row").filter({hasText:"自分で書いた下書き"}).getByText("送信確認済み",{exact:true})).toBeVisible();
});

test("mobile: review a task, save it once, complete it and reopen the source", async ({page}) => {
  await page.setViewportSize({width:390,height:844}); await login(page);
  const existingTasks = await (await page.request.get("/api/tasks")).json();
  const card = page.locator(".attention-card").filter({has:page.getByRole("heading",{name:"日中デザイン室",exact:true})});
  await card.getByRole("button",{name:"タスク候補を確認",exact:true}).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("タスクの期限")).toHaveValue("");
  expect(await (await page.request.get("/api/tasks")).json()).toEqual(existingTasks);
  await page.getByLabel("タスク名",{exact:true}).fill("打ち合わせ前に素材を確認");
  await page.getByLabel("タスクの期限").fill("2026-11-20");
  await page.getByRole("button",{name:"タスクに追加",exact:true}).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(card.getByRole("button",{name:"タスクに追加済み",exact:true})).toBeDisabled();
  await page.getByRole("button",{name:"タスク一覧",exact:true}).click();
  await expect(page.getByRole("heading",{name:"打ち合わせ前に素材を確認",exact:true})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({path:"../test-results/tasks-mobile.png"});
  await page.reload();
  await page.getByRole("button",{name:"対応すること",exact:true}).click(); await page.getByRole("button",{name:"タスク一覧",exact:true}).click();
  await page.getByRole("button",{name:"完了にする：打ち合わせ前に素材を確認",exact:true}).click();
  await page.getByRole("button",{name:"完了 1",exact:true}).click();
  await page.getByRole("button",{name:"元のメッセージへ",exact:true}).click();
  await expect(page.locator(".conversation-title h2")).toHaveText("日中デザイン室");
  await expect(page.locator(".bubble").filter({hasText:"明日の打ち合わせ"})).toBeVisible();
  await page.getByLabel("一覧に戻る",{exact:true}).click();
  await page.getByRole("button",{name:"対応すること",exact:true}).click();
  await page.screenshot({path:"../test-results/attention-mobile.png"});
  await page.setViewportSize({width:320,height:640});
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.getByRole("button",{name:"接続状態・設定",exact:true}).click();
  await page.getByRole("button",{name:"ダーク",exact:true}).click();
  await page.getByRole("button",{name:"対応すること",exact:true}).click();
  await expect(page.locator(".attention-card").first()).toHaveCSS("background-color", "rgb(29, 39, 33)");
  await page.screenshot({path:"../test-results/attention-dark-mobile.png"});
  const tasks = await (await page.request.get("/api/tasks")).json();
  expect(tasks).toHaveLength(existingTasks.length+1); expect(tasks.find((task:{title:string})=>task.title==="打ち合わせ前に素材を確認").status).toBe("done");
});

test("task updates arrive on another authenticated device through WebSocket", async ({page,browser}) => {
  await login(page);
  const second = await browser.newContext();
  const other = await second.newPage();
  await login(other);
  await other.getByRole("button",{name:"タスク一覧",exact:true}).click();
  const chats = await (await page.request.get("/api/chats")).json();
  const target = chats.find((c:{external_id:string}) => c.external_id === "mock:weekend");
  const messages = await (await page.request.get(`/api/chats/${target.id}/messages`)).json();
  const source = messages.messages.find((m:{direction:string}) => m.direction === "incoming");
  await page.request.post("/api/tasks", {headers:{Origin:ORIGIN},data:{chat_id:target.id,source_message_id:source.id,title:"週末の候補を調べる",client_request_id:crypto.randomUUID()}});
  await expect(other.getByRole("heading",{name:"週末の候補を調べる",exact:true})).toBeVisible({timeout:5000});
  await second.close();
});

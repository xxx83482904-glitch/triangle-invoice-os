import { test, expect, Page } from "@playwright/test";

// UI fixtures only. The test server is always an isolated Mock backend.
const TOKEN = "e2e-mock-only-" + "x".repeat(40);
async function openPlus(page: Page, getActive = () => true) {
  await page.route("**/api/status", async route => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({json: {...data, mode: "wxautox4", state: "connected", can_send: true,
      monitoring: {registered: getActive() ? 1 : 0, discovered: 5, ambiguous: 2, registration_failures: 1,
        limit: 8, reconnections: 1, scope: "visible_sessions", complete: false,
        active_chat_ids: getActive() ? ["mock:studio"] : []}}});
  });
  await page.goto("/");
  await page.getByLabel("このアプリの接続キー", {exact:true}).fill(TOKEN);
  await page.getByRole("button", {name:"このPCに接続",exact:true}).click();
  await page.getByRole("button", {name:"チャット一覧",exact:true}).click();
  await page.getByTestId("chat-mock:studio").click();
  // The mobile conversation intentionally hides the top bar, but its state
  // still tracks the WebSocket. Sending is asserted through the visible UI.
  await expect(page.getByText("リアルタイム接続", {exact:true})).toBeAttached();
}

test("Plus send requires recipient/text review; cancel preserves draft; confirmation sends once to Mock", async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await openPlus(page);
  let sends = 0;
  page.on("request", r => { if (r.method() === "POST" && /\/send$/.test(r.url())) sends++; });
  const input = page.getByLabel("メッセージを入力", {exact:true});
  await input.fill("確認画面を通る合成メッセージ");
  await page.getByLabel("メッセージを送信",{exact:true}).click();
  const dialog = page.getByRole("dialog",{name:"宛先と本文を確認"});
  await expect(dialog).toContainText("確認画面を通る合成メッセージ");
  await expect(dialog).toContainText("参加者全員");
  expect(sends).toBe(0);
  await page.setViewportSize({width:320,height:720});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await dialog.getByRole("button",{name:"下書きに戻る"}).click();
  await expect(input).toHaveValue("確認画面を通る合成メッセージ");
  expect(sends).toBe(0);
  await input.press("Control+Enter");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button",{name:"この宛先に送信"}).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".message-row").filter({hasText:"確認画面を通る合成メッセージ"}).getByText("送信確認済み",{exact:true})).toBeVisible();
  expect(sends).toBe(1);
});

test("Plus stale recipient disables a pending confirmation", async ({page}) => {
  let active = true;
  await openPlus(page, () => active);
  let sends = 0;
  page.on("request", r => { if (r.method() === "POST" && /\/send$/.test(r.url())) sends++; });
  await page.getByLabel("メッセージを入力",{exact:true}).fill("再接続後には勝手に送らない");
  await page.getByLabel("メッセージを送信",{exact:true}).click();
  active = false;
  const dialog = page.getByRole("dialog",{name:"宛先と本文を確認"});
  await expect(dialog.getByRole("button",{name:"この宛先に送信"})).toBeDisabled({timeout:15000});
  await expect(dialog).toContainText("状態が変わりました");
  expect(sends).toBe(0);
});

test("Plus coverage remains partial on mobile and archived chats cannot send", async ({page}) => {
  await page.setViewportSize({width:320,height:720});
  await openPlus(page, () => false);
  await page.getByLabel("メッセージを入力",{exact:true}).fill("保存だけの会話");
  await expect(page.getByLabel("メッセージを送信",{exact:true})).toBeDisabled();
  await page.getByRole("button",{name:"一覧に戻る",exact:true}).click();
  await page.getByRole("button",{name:"接続状態・設定",exact:true}).click();
  const card = page.getByRole("article",{name:"Plusの監視範囲"});
  await expect(card).toContainText("一部の会話");
  await expect(card).toContainText("画面上で発見した会話");
  await expect(card).toContainText("完全に取得できたとは扱いません");
  await card.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:"../test-results/plus-coverage-mobile.png"});
});

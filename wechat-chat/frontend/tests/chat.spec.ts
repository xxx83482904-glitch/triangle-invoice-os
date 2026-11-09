import { test, expect, Page } from "@playwright/test";

const TOKEN = "e2e-mock-only-" + "x".repeat(40);
const ORIGIN = "http://127.0.0.1:8877";
async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("このアプリの接続キー").fill(TOKEN);
  await page.getByRole("button", { name: "このPCに接続", exact: true }).click();
  await expect(page.getByText("リアルタイム接続", {exact: true})).toBeVisible();
}
async function chat(page: Page, id="mock:lin") { await page.getByTestId(`chat-${id}`).click(); }

test.beforeEach(async ({request}) => {
  // One isolated Mock server is shared by this suite; reset transient fault state.
  const headers = { Authorization: `Bearer ${TOKEN}`, Origin: ORIGIN };
  expect((await request.post("/api/mock", {headers, data:{action:"reconnect"}})).ok()).toBe(true);
  expect((await request.post("/api/mock", {headers, data:{action:"next_confirmed"}})).ok()).toBe(true);
});

test("desktop: list, WebSocket arrival, reply, search and local persistence", async ({page}) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.setViewportSize({width: 1440, height: 960}); await login(page);
  await expect(page.getByTestId("chat-mock:studio")).toBeVisible(); await chat(page);
  await page.getByRole("button", {name:"新着をシミュレート"}).click();
  await expect(page.locator(".bubble").filter({hasText:"新着メッセージのテストです"})).toBeVisible();
  await page.getByLabel("メッセージを入力", {exact:true}).fill("ブラウザから返信テスト ☀️");
  await page.getByLabel("メッセージを送信", {exact:true}).click();
  const row = page.locator(".message-row").filter({hasText:"ブラウザから返信テスト"});
  await expect(row.getByText("送信確認済み", {exact:true})).toBeVisible();
  await page.reload(); await expect(page.getByText("リアルタイム接続", {exact:true})).toBeVisible(); await chat(page);
  await expect(page.locator(".bubble").filter({hasText:"ブラウザから返信テスト"})).toHaveCount(1);
  await page.screenshot({path:"../test-results/desktop.png"});
  await page.getByRole("button", {name:"メッセージ検索", exact:true}).click();
  await page.getByLabel("メッセージ検索キーワード").fill("ブラウザから返信");
  await expect(page.locator(".search-result")).toHaveCount(1);
  await page.locator(".search-result").click(); await expect(page.locator(".bubble").filter({hasText:"ブラウザから返信テスト"})).toBeVisible();
  expect(errors).toEqual([]);
});

test("group send and incomplete history label", async ({page}) => {
  await login(page); await chat(page, "mock:studio");
  await expect(page.locator(".history-banner")).toContainText("以前の履歴は未取得");
  await expect(page.locator(".sender-name").first()).toBeVisible();
  await page.getByLabel("メッセージを入力", {exact:true}).fill("グループへの返信を確認");
  await page.getByLabel("メッセージを送信", {exact:true}).click();
  await expect(page.locator(".message-row").filter({hasText:"グループへの返信を確認"}).getByText("送信確認済み",{exact:true})).toBeVisible();
});

test("uncertain sends remain uncertain, failure and offline never show success", async ({page}) => {
  await login(page); await chat(page);
  await page.getByRole("button", {name:"接続状態・設定",exact:true}).click();
  await page.getByLabel("次のMock送信結果").selectOption("unknown");
  await expect(page.getByRole("status")).toContainText("次のMock送信結果を変更");
  await page.getByRole("button", {name:"チャット一覧",exact:true}).click(); await chat(page);
  await page.getByLabel("メッセージを入力", {exact:true}).fill("確認不能のテスト"); await page.getByLabel("メッセージを送信", {exact:true}).click();
  await expect(page.locator(".message-row").filter({hasText:"確認不能のテスト"}).getByText("確認不能",{exact:true})).toBeVisible();
  await page.getByRole("button", {name:"接続状態・設定",exact:true}).click();
  await page.getByRole("button", {name:"接続を切断",exact:true}).click();
  await page.getByRole("button", {name:"チャット一覧",exact:true}).click(); await chat(page);
  await page.getByLabel("メッセージを入力", {exact:true}).fill("オフライン下書き");
  await expect(page.getByLabel("メッセージを送信", {exact:true})).toBeDisabled();
  await page.getByRole("button", {name:"接続状態・設定",exact:true}).click();
  await page.getByRole("button", {name:"再接続",exact:true}).click();
  await page.getByLabel("次のMock送信結果").selectOption("failed");
  await expect(page.getByRole("status")).toContainText("次のMock送信結果を変更");
  await page.getByRole("button", {name:"チャット一覧",exact:true}).click(); await chat(page);
  await expect(page.getByLabel("メッセージを入力",{exact:true})).toHaveValue("オフライン下書き");
  await page.getByLabel("メッセージを送信",{exact:true}).click();
  await expect(page.locator(".message-row").filter({hasText:"オフライン下書き"}).getByText("失敗",{exact:true})).toBeVisible();
  await expect(page.locator(".message-row").filter({hasText:"確認不能のテスト"}).getByText("確認不能",{exact:true})).toBeVisible();
});

test("mobile layout, navigation, IME-safe enter and dark theme", async ({page}) => {
  await page.setViewportSize({width:390,height:844}); await login(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({path:"../test-results/mobile-list.png"});
  await chat(page);
  await expect(page.getByLabel("一覧に戻る",{exact:true})).toBeVisible();
  await page.getByLabel("メッセージを入力",{exact:true}).fill("Enterだけでは送信しない");
  await page.getByLabel("メッセージを入力",{exact:true}).press("Enter");
  await expect(page.locator(".bubble").filter({hasText:"Enterだけでは送信しない"})).toHaveCount(0);
  await page.screenshot({path:"../test-results/mobile-chat.png"});
  await page.getByLabel("一覧に戻る",{exact:true}).click();
  await page.getByRole("button",{name:"接続状態・設定",exact:true}).click();
  await page.getByRole("button",{name:"ダーク",exact:true}).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme","dark");
  await expect(page.locator(".secondary").first()).toHaveCSS("background-color", "rgb(29, 39, 33)");
  await page.screenshot({path:"../test-results/mobile-dark.png"});
  await page.reload(); await expect(page.locator("html")).toHaveAttribute("data-theme","dark");
});

test("mobile app instructions and a message sent from the compact viewport", async ({page}) => {
  await page.setViewportSize({width:390,height:844}); await login(page);
  await page.getByRole("button",{name:"接続状態・設定",exact:true}).click();
  await expect(page.getByRole("heading",{name:"携帯でアプリとして使う"})).toBeVisible();
  await expect(page.locator(".install-steps")).toContainText("ホーム画面に追加");
  await expect(page.locator(".mobile-install")).toContainText("携帯用の接続先は未設定");
  await page.getByRole("button",{name:"チャット一覧",exact:true}).click(); await chat(page,"mock:studio");
  await page.setViewportSize({width:390,height:500});
  await page.getByLabel("メッセージを入力",{exact:true}).fill("携帯サイズからのMock返信");
  const send = page.getByLabel("メッセージを送信",{exact:true});
  const bounds = await send.boundingBox();
  expect(bounds).not.toBeNull(); expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(500);
  await send.click();
  await expect(page.locator(".message-row").filter({hasText:"携帯サイズからのMock返信"}).getByText("送信確認済み",{exact:true})).toBeVisible();
});

test("public mobile access explains that a phone VPN is unnecessary", async ({page}) => {
  await page.setViewportSize({width:390,height:844}); await login(page);
  await page.route("**/api/device", route => route.fulfill({json:{mobile_url:"https://device.tailnet.ts.net",mobile_access:"public",ai_enabled:false,push_enabled:false}}));
  await page.getByRole("button",{name:"接続状態・設定",exact:true}).click();
  await expect(page.locator(".mobile-install")).toContainText("携帯のVPN接続は不要です");
  await expect(page.locator(".install-steps")).not.toContainText("Tailscaleに接続");
  await expect(page.locator(".mobile-address a")).toHaveAttribute("href","https://device.tailnet.ts.net");
});

test("authentication, destination mismatch and service worker privacy", async ({page}) => {
  expect((await page.request.get("/api/chats")).status()).toBe(401);
  await login(page);
  const chats = await (await page.request.get("/api/chats")).json();
  const result = await page.request.post(`/api/chats/${chats[0].id}/send`,{headers:{Origin:ORIGIN},data:{content:"must not send",expected_external_id:"wrong",expected_name:chats[0].name,client_request_id:crypto.randomUUID()}});
  expect(result.status()).toBe(409);
  expect((await page.request.post("/api/mock",{headers:{Origin:"https://evil.example"},data:{action:"disconnect"}})).status()).toBe(403);
  const manifest = await (await page.request.get("/manifest.webmanifest")).json(); expect(manifest.display).toBe("standalone");
  await page.evaluate(() => navigator.serviceWorker.ready);
  const cached = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async key => (await (await caches.open(key)).keys()).map(r=>r.url)))).flat());
  expect(cached.every(url => !url.includes("/api/") && !url.includes("token"))).toBe(true);
  await page.getByRole("button",{name:"接続状態・設定",exact:true}).click();
  await page.getByRole("button",{name:"この端末からログアウト"}).click();
  await expect(page.getByLabel("このアプリの接続キー")).toBeVisible();
  expect((await page.request.get("/api/chats")).status()).toBe(401);
});

test("offline navigation has a truthful offline page", async ({page,context}) => {
  await login(page); await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); await expect(page.getByText("リアルタイム接続",{exact:true})).toBeVisible();
  await context.setOffline(true); await page.reload();
  await expect(page.getByRole("heading",{name:"接続を待っています。"})).toBeVisible();
  await expect(page.getByText(/オフライン中の送信は行いません/)).toBeVisible();
  await context.setOffline(false);
});

test("lost HTTP acknowledgement is checked by request ID without resending", async ({page}) => {
  await login(page); await chat(page);
  let sends = 0;
  await page.route("**/api/chats/*/send", async route => {
    sends += 1;
    await route.fetch(); // The backend accepted the message, but the browser loses the reply.
    await route.abort("failed");
  });
  await page.getByLabel("メッセージを入力",{exact:true}).fill("HTTP応答だけ失われるテスト");
  await page.getByLabel("メッセージを送信",{exact:true}).click();
  await expect(page.locator(".global-banner[role=alert]")).toContainText("自動再送はしません");
  await expect(page.getByLabel("メッセージを送信",{exact:true})).toBeDisabled();
  await page.getByRole("button",{name:"受付状態を確認",exact:true}).click();
  await expect(page.getByRole("status")).toContainText("受付を確認しました");
  await expect(page.locator(".message-row").filter({hasText:"HTTP応答だけ失われるテスト"}).getByText("送信確認済み",{exact:true})).toBeVisible();
  expect(sends).toBe(1);
});

test("backend outage disables sending while preserving the draft", async ({page}) => {
  await login(page); await chat(page);
  await page.getByLabel("メッセージを入力",{exact:true}).fill("PCが切断されても保持する下書き");
  await page.route("**/api/**", route => route.abort("failed"));
  await expect(page.getByLabel("メッセージを送信",{exact:true})).toBeDisabled({timeout:15000});
  await expect(page.getByText("PCに接続できません",{exact:true})).toBeVisible();
  await expect(page.getByLabel("メッセージを入力",{exact:true})).toHaveValue("PCが切断されても保持する下書き");
});

test("mobile list does not mark a hidden conversation as read", async ({page}) => {
  await page.setViewportSize({width:390,height:844}); await login(page); await chat(page);
  await page.getByLabel("この会話のメッセージを検索",{exact:true}).click();
  await page.getByRole("button",{name:"チャット一覧",exact:true}).click();
  const chats = await (await page.request.get("/api/chats")).json();
  const target = chats.find((c:{external_id:string}) => c.external_id === "mock:lin");
  await page.request.post("/api/mock",{headers:{Origin:ORIGIN},data:{action:"receive",chat_id:target.id}});
  await expect(page.getByTestId("chat-mock:lin").locator(".unread-badge")).toBeVisible();
  await expect(page.locator(".conversation")).toBeHidden();
});

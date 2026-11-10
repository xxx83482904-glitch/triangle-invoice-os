import { test, expect } from "@playwright/test";

const TOKEN = "e2e-mock-only-" + "x".repeat(40);

test("mobile media through real API: explicit transcription, image, file download and confirmed UIA label", async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  let fetches = 0, sends = 0;
  page.on("request", r => {
    if (r.method() === "POST" && /\/attachments\/.*\/fetch$/.test(r.url())) fetches++;
    if (r.method() === "POST" && /\/send$/.test(r.url())) sends++;
  });
  await page.goto("/");
  await page.getByLabel("このアプリの接続キー",{exact:true}).fill(TOKEN);
  await page.getByRole("button",{name:"このPCに接続",exact:true}).click();
  await expect(page.getByRole("button",{name:"チャット一覧",exact:true})).toBeVisible();
  const seed = await page.request.post("/api/test/media",{data:{},headers:{Origin:"http://127.0.0.1:8877"}});
  expect(seed.ok()).toBe(true);
  await page.getByRole("button",{name:"チャット一覧",exact:true}).click();
  await page.getByTestId("chat-mock:studio").click();
  const card = page.getByRole("region",{name:"ボイスメッセージ"});
  await expect(card.getByRole("button",{name:"文字起こしを読み込む"})).toBeVisible();
  expect(fetches).toBe(0);
  await card.getByRole("button",{name:"文字起こしを読み込む"}).click();
  await expect(card).toContainText("明日の集合は10時です。");
  await expect(card).toContainText("原音の取得・再生は未対応");
  expect(fetches).toBe(1);
  const image = page.getByAltText("WeChatから保存した画像");
  await image.scrollIntoViewIfNeeded();
  await expect(image).toBeVisible();
  expect(await image.evaluate((el: HTMLImageElement)=>el.complete && el.naturalWidth > 0)).toBe(true);
  const download = page.waitForEvent("download");
  await page.getByRole("region",{name:"ファイル"}).getByRole("link",{name:"保存したファイルをダウンロード"}).click();
  const downloaded = await download;
  expect(downloaded.suggestedFilename()).toBe("資料.txt");
  const stream = await downloaded.createReadStream();
  let content = "";
  for await (const chunk of stream) content += chunk.toString();
  expect(content).toBe("test");
  await expect(page.locator(".message-row").filter({hasText:"確認済みの合成送信"})).toContainText("送信確認済み");
  await expect(page.locator("audio")).toHaveCount(0);
  await page.setViewportSize({width:320,height:720});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(sends).toBe(0);
});

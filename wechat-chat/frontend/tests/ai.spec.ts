import { test, expect, Page } from "@playwright/test";

const TOKEN = "e2e-mock-only-" + "x".repeat(40);
async function openChat(page: Page, externalId: string) {
  await page.goto("/");
  await expect(page.locator("#access-token, .chat-sidebar")).toBeVisible();
  const login = page.getByLabel("このアプリの接続キー");
  if (await login.isVisible()) {
    await login.fill(TOKEN);
    await page.getByRole("button",{name:"このPCに接続",exact:true}).click();
  }
  await expect(page.getByLabel("チャットの並び順")).toHaveValue("recent");
  await page.getByRole("button",{name:"チャット一覧",exact:true}).click();
  await page.getByTestId(`chat-${externalId}`).click();
  await expect(page.locator(".bubble").first()).toBeVisible();
}

async function generate(page: Page) {
  const dialog = page.getByRole("dialog",{name:"AIアシスト",exact:true});
  await dialog.getByRole("button",{name:"送る内容を確認",exact:true}).click();
  const run = dialog.getByRole("button",{name:"テスト生成を実行",exact:true});
  await expect(run).toBeDisabled();
  await dialog.getByLabel("テスト用の内容を確認しました",{exact:true}).check();
  await run.click();
  await expect(dialog.getByRole("region",{name:"AIの結果",exact:true})).toBeVisible();
  return dialog;
}

test("AI preview, translation toggle, reply drafts, summary and reviewed tasks never send automatically", async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await openChat(page,"mock:chen");
  const queueBefore = await (await page.request.get("/api/queue")).json();
  const tasksBefore = await (await page.request.get("/api/tasks")).json();
  await page.getByLabel("メッセージを入力",{exact:true}).fill("自分で書いた下書き");
  await page.getByRole("button",{name:"AIアシストを開く"}).click();
  let dialog = page.getByRole("dialog",{name:"AIアシスト",exact:true});
  await expect(dialog).toContainText("テスト応答です");
  dialog = await generate(page);
  const result = dialog.getByRole("region",{name:"AIの結果",exact:true});
  await expect(result).toContainText("確認してからご連絡します。");
  await result.getByRole("button",{name:"原文",exact:true}).click();
  await expect(result).toContainText("資料を確認しました。ありがとうございます！");
  await result.getByRole("button",{name:"訳文",exact:true}).click();
  await expect(result).toContainText("確認してからご連絡します。");
  await dialog.getByRole("button",{name:"返信案",exact:true}).click();
  await generate(page);
  await dialog.getByRole("button",{name:"返信案1を下書きに追加",exact:true}).click();
  await expect(page.getByLabel("メッセージを入力",{exact:true})).toHaveValue("自分で書いた下書き\n\n谢谢您的消息，我确认后再回复您。");
  await dialog.getByRole("button",{name:"要約・決定事項",exact:true}).click();
  await generate(page);
  await expect(result).toContainText("返答の時期は未確定です。");
  await dialog.getByRole("button",{name:"タスク候補",exact:true}).click();
  await generate(page);
  expect(await (await page.request.get("/api/tasks")).json()).toHaveLength(tasksBefore.length);
  expect(await (await page.request.get("/api/queue")).json()).toEqual(queueBefore);
  expect(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
  await page.screenshot({path:"../test-results/ai-mobile.png"});
  await dialog.getByRole("button",{name:"タスク内容を確認",exact:true}).click();
  const task = page.getByRole("dialog",{name:"次にやることを、タスクに。"});
  await expect(task.getByLabel("タスク名",{exact:true})).toHaveValue("依頼内容を確認する");
  await task.getByLabel("タスク名",{exact:true}).fill("資料の内容を確認する");
  await task.getByRole("button",{name:"タスクに追加",exact:true}).click();
  await expect(task).toHaveCount(0);
  expect(await (await page.request.get("/api/tasks")).json()).toHaveLength(tasksBefore.length+1);
  expect(await (await page.request.get("/api/queue")).json()).toEqual(queueBefore);
});

test("lost AI acknowledgement only checks the existing job; draft translation survives reload", async ({page}) => {
  await openChat(page,"mock:lin");
  await page.getByLabel("メッセージを入力",{exact:true}).fill("確認してから返信します。");
  await page.getByRole("button",{name:"AIアシストを開く"}).click();
  const dialog = page.getByRole("dialog",{name:"AIアシスト",exact:true});
  await dialog.getByLabel("入力中の下書き",{exact:true}).check();
  let executions = 0;
  await page.route("**/api/ai/translate", async route => { executions++; await route.fetch(); await route.abort("failed"); });
  await dialog.getByRole("button",{name:"送る内容を確認",exact:true}).click();
  await dialog.getByLabel("テスト用の内容を確認しました",{exact:true}).check();
  await dialog.getByRole("button",{name:"テスト生成を実行",exact:true}).click();
  await dialog.getByRole("button",{name:"AIの受付結果だけを確認",exact:true}).click();
  await expect(dialog.getByRole("region",{name:"AIの結果",exact:true})).toContainText("我确认后再回复您。");
  expect(executions).toBe(1);
  await dialog.getByRole("button",{name:"AIアシストを閉じる",exact:true}).click();
  await openChat(page,"mock:lin");
  await page.getByRole("button",{name:"AIアシストを開く"}).click();
  await dialog.getByText("この会話の生成履歴",{exact:true}).click();
  await dialog.getByRole("button",{name:"翻訳 · 生成済み",exact:true}).click();
  await dialog.getByRole("button",{name:"原文",exact:true}).click();
  await expect(dialog.getByRole("region",{name:"AIの結果",exact:true})).toContainText("確認してから返信します。");
  expect(executions).toBe(1);
});

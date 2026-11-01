import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

// A real Chromium browser with touch events. This is not a physical iPad/Safari test.
const base = process.env.AKIRA_BASE_URL || "http://localhost:3060/akira-kitchen/";
const output = path.resolve(process.env.AKIRA_QA_OUTPUT || "../../docs/akira-kitchen/qa/browser-v2.2");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1,
  hasTouch: true, isMobile: true, locale: "ja-JP", timezoneId: "Asia/Tokyo", reducedMotion: "reduce",
});
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
const runtimeErrors = [], checks = [], screenshots = [], metrics = [];
page.on("pageerror", error => runtimeErrors.push(error.message));
const check = (name, detail = {}) => { checks.push({ name, ...detail }); console.log("PASS " + name); };
const button = name => page.getByRole("button", { name, exact: true });
const tap = async name => { await button(name).tap(); await page.waitForTimeout(180); };
const stage = async number => page.locator(`[data-screen="${number}"][aria-busy="false"]`).waitFor();
const session = () => page.evaluate(() => JSON.parse(localStorage.getItem("akira-kitchen:session:v2")));
async function imagesReady() {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const urls = [...document.querySelectorAll("img, image")].map(el => el.getAttribute("src") || el.getAttribute("href")).filter(Boolean);
    await Promise.all([...new Set(urls)].map(src => new Promise((resolve, reject) => {
      const image = new Image(); image.onload = resolve; image.onerror = () => reject(new Error("Missing image: " + src)); image.src = src;
    })));
  });
}
async function shot(number, suffix = "") {
  await stage(number); await imagesReady(); await page.waitForTimeout(250);
  const file = `${String(number).padStart(2, "0")}${suffix}.png`;
  await page.screenshot({ path: path.join(output, file), fullPage: true }); screenshots.push(file);
}
async function touchPath(locator, points) {
  const b = await locator.boundingBox(); assert.ok(b);
  const coords = points.map(([x, y]) => ({ x: b.x + b.width * x, y: b.y + b.height * y, id: 1 }));
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [coords[0]] });
  for (const point of coords.slice(1)) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [point] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(180);
}
async function cook(process) {
  const el = page.locator(`[data-process="${process}"]`);
  const before = Number(await el.getAttribute("data-progress"));
  for (let i = 0; i < 15 && await el.getAttribute("aria-label") !== "できた！"; i++) {
    await touchPath(el, Array.from({ length: 28 }, (_, i) => [0.5 + 0.3 * Math.cos(i / 2), 0.5 + 0.3 * Math.sin(i / 2)]));
  }
  assert.equal(await el.getAttribute("aria-label"), "できた！");
  check(`touch gesture completes ${process}`, { before, after: Number(await el.getAttribute("data-progress")) });
}
async function place(name, position) {
  const target = page.locator('[aria-label="おべんとうばこ"], [aria-label="ケーキの かざりだい"]');
  const board = await target.boundingBox(), source = await button(name).first().boundingBox();
  const start = { x: source.x + source.width / 2, y: source.y + source.height / 2, id: 1 };
  const end = { x: board.x + board.width * position[0], y: board.y + board.height * position[1], id: 1 };
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [start] });
  for (let i = 1; i <= 12; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: start.x + (end.x - start.x) * i / 12, y: start.y + (end.y - start.y) * i / 12, id: 1 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(250);
}
async function fontSize(name, minimum) {
  const data = await button(name).evaluate(el => {
    const box = el.getBoundingClientRect(), scale = box.width / el.offsetWidth;
    return { text: el.textContent, font: getComputedStyle(el).fontFamily, px: parseFloat(getComputedStyle(el).fontSize) * scale, height: box.height };
  });
  assert.ok(data.px >= minimum, `${name} ${data.px}px < ${minimum}`); metrics.push(data);
}
try {
  await page.goto(base); await stage(1); await shot(1); await fontSize("アルバム", 30);
  await tap("おべんとう"); await shot(2);
  await tap("おにぎり"); await tap("うめ");
  await page.locator('[data-process="rice"]').tap(); await page.locator('[data-process="rice"]').tap();
  await shot(3); await cook("rice"); await shot(3, "-finished");
  await tap("つぎへ"); await stage(4);
  await page.locator('[data-process="egg"]').tap(); await page.locator('[data-process="egg"]').tap();
  await shot(4); await cook("egg"); await tap("つぎへ");
  await tap("カレー"); await shot(5); await cook("chicken"); await tap("つぎへ");
  await shot(6); await cook("broccoli"); await tap("にんじん"); await tap("ほしの にんじん"); await cook("carrot");
  await tap("トマト"); await cook("tomato"); await tap("つぎへ"); await stage(7);
  await place("おにぎりを のせる", [0.3, 0.4]); await place("おにぎりを のせる", [0.3, 0.4]);
  for (const [name, pos] of [["たまごやきを のせる", [0.7, 0.3]], ["からあげを のせる", [0.7, 0.65]], ["にんじんを のせる", [0.4, 0.7]], ["トマトを のせる", [0.55, 0.65]]]) await place(name, pos);
  let recipe = (await session()).recipe;
  assert.equal(recipe.items.length, 6); assert.notDeepEqual([recipe.items[0].x, recipe.items[0].y], [recipe.items[1].x, recipe.items[1].y]);
  check("duplicate placement snaps apart");
  await place("おにぎりを うごかす", [0.2, 0.7]);
  await tap("はずす"); await tap("もどす"); await fontSize("もどす", 24); await shot(7);
  await tap("できた！"); await shot(8); await tap("たべてみる");
  await button("おにぎりを たべる").first().tap(); await shot(9);
  assert.ok(await page.locator('img[src$="chef-taste-v2.png"]').count());
  await tap("アルバムへ"); await shot(10); await tap("ほぞんする"); await button("ほぞんしたよ").waitFor({ state: "visible", timeout: 20000 });
  await tap("アルバム"); await shot(16, "-bento");
  await page.reload(); await stage(16); assert.equal(await page.locator("time").count(), 1);
  check("bento image and recipe persist after reload");
  await page.locator("time").first().locator("..").tap(); await tap("けす");
  await button("けした さくひんを もどす").waitFor(); await shot(16, "-restore-visible");
  const undo = button("けした さくひんを もどす");
  assert.ok(await undo.evaluate(el => { const b = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)); }));
  await tap("けした さくひんを もどす"); assert.equal(await page.locator("time").count(), 1);
  check("undo is immediately touchable without closing the notice");
  await tap("もどる"); await tap("ケーキ"); await button("チョコ").first().tap(); await shot(11); await tap("つくろう");
  await shot(12); await cook("batter"); await tap("つぎへ"); await shot(13);
  assert.ok((await page.locator("main").innerText()).includes("かたへ とろ〜り"));
  assert.equal(await page.getByText("オーブンを タップ！", { exact: true }).count(), 0);
  await cook("bake"); await shot(13, "-baked"); await tap("つぎへ"); await tap("ぬる");
  await touchPath(page.locator('[aria-label="ケーキの かざりだい"]'), Array.from({ length: 26 }, (_, i) => [0.5 + 0.2 * Math.cos(i / 4), 0.32 + 0.1 * Math.sin(i / 4)]));
  await place("いちごを のせる", [0.4, 0.3]); await place("いちごを のせる", [0.55, 0.3]);
  await place("バナナを のせる", [0.65, 0.4]); await place("ブルーベリーを のせる", [0.35, 0.4]);
  await shot(14); await fontSize("ぬる", 24);
  recipe = (await session()).recipe; assert.equal(recipe.items.length, 4); assert.equal(recipe.strokes.length, 1); assert.equal(recipe.cake, "chocolate");
  check("cake paint and touch placement persist independently");
  await tap("できた！"); await shot(15); await tap("ほぞんする"); await button("ほぞんしたよ").waitFor({ state: "visible", timeout: 20000 });
  await tap("アルバム"); await page.reload(); await stage(16); await shot(16); assert.equal(await page.locator("time").count(), 2);
  check("both works survive reload with actual artwork");
  await tap("もどる"); await tap("せってい"); await fontSize("ホームへ", 30); await shot(17);
  await page.getByRole("button", { name: "オン", exact: true }).tap();
  await page.getByRole("button", { name: "オフ", exact: true }).last().tap();
  await page.getByRole("slider").focus(); await page.keyboard.press("Home");
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(250); await page.reload(); await stage(17);
  const settings = (await session()).settings; assert.equal(settings.sound, false); assert.equal(settings.bgm, true); assert.equal(settings.volume, 0.3);
  check("sound, music and volume persist after reload");
  if (process.env.AKIRA_OFFLINE === "1") {
    await page.evaluate(() => navigator.serviceWorker.ready); await tap("ホームへ");
    await page.reload(); await stage(1); await context.setOffline(true); await page.reload(); await stage(1); await imagesReady();
    await tap("おべんとう"); await tap("おにぎり"); await tap("うめ"); await shot(3, "-offline");
    check("offline reload includes local font and new illustrations"); await context.setOffline(false);
  }
  assert.deepEqual(runtimeErrors, []); assert.equal(new Set(screenshots.filter(x => /^\d\d\.png$/.test(x))).size, 17);
  check("all 17 screens captured at 1024x768; no page errors");
  await writeFile(path.join(output, "results.json"), JSON.stringify({ base, browser: await browser.version(), viewport: { width: 1024, height: 768 }, physicalIPadSafari: false, checks, screenshots, metrics, runtimeErrors }, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
  await writeFile(path.join(output, "failure.json"), JSON.stringify({ error: String(error), checks, runtimeErrors }, null, 2));
  throw error;
} finally { await browser.close(); }

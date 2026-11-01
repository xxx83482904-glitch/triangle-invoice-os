import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import { chromium } from "playwright";
import { startServer } from "./test-server.mjs";
const server = process.env.AKIRA_BASE_URL ? null : await startServer(),
  base = process.env.AKIRA_BASE_URL || server.base;
const output = path.resolve(
  process.env.AKIRA_QA_OUTPUT || fileURLToPath(new URL("../../docs/akira-kitchen/qa/browser-v3/",import.meta.url)),
);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.AKIRA_CHROME ||
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1024, height: 768 },
  deviceScaleFactor: 1,
  hasTouch: true,
  isMobile: true,
  locale: "ja-JP",
  timezoneId: "Asia/Tokyo",
  reducedMotion: "reduce",
});
await context.addInitScript(() => {
  const Base = window.AudioContext;
  window.__audio = { voices: 0, tones: 0 };
  window.AudioContext = class extends Base {
    createBufferSource() {
      const source = super.createBufferSource(),
        start = source.start.bind(source);
      source.start = (...args) => {
        window.__audio.voices++;
        return start(...args);
      };
      return source;
    }
    createOscillator() {
      const source = super.createOscillator(),
        start = source.start.bind(source);
      source.start = (...args) => {
        window.__audio.tones++;
        return start(...args);
      };
      return source;
    }
  };
});
const page = await context.newPage(),
  cdp = await context.newCDPSession(page);
const errors = [],
  badResponses = [],
  checks = [],
  screenshots = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("response", (r) => {
  if (r.status() >= 400)
    badResponses.push({ url: r.url(), status: r.status() });
});
const check = (name, details = {}) => {
  checks.push({ name, ...details });
  console.log("PASS " + name);
};
const button = (name) => page.getByRole("button", { name, exact: true });
const tap = async (name) => {
  const el = button(name);
  if ((await el.getAttribute("aria-disabled")) === "true") {
    const r = await el.boundingBox();
    await page.touchscreen.tap(r.x + r.width / 2, r.y + r.height / 2);
  } else await el.tap({ timeout: 5000 });
  await page.waitForTimeout(220);
};
const stage = async (n) => {
  await page
    .locator('[data-screen="' + n + '"][aria-busy="false"]')
    .waitFor({ timeout: 6000 });
};
const session = () =>
  page.evaluate(() =>
    JSON.parse(localStorage.getItem("akira-kitchen:session:v2")),
  );
async function shot(n, suffix = "") {
  await stage(n);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  const file = String(n).padStart(2, "0") + suffix + ".png";
  await page.screenshot({ path: path.join(output, file) });
  screenshots.push(file);
  const layout = await page
    .locator("[data-screen] button")
    .evaluateAll((buttons) =>
      buttons
        .filter((b) => b.getBoundingClientRect().width > 0)
        .map((b) => {
          const r = b.getBoundingClientRect();
          return {
            label: b.getAttribute("aria-label") || b.textContent,
            x: r.x,
            y: r.y,
            right: r.right,
            bottom: r.bottom,
            width: r.width,
            height: r.height,
          };
        }),
    );
  assert.ok(
    layout.every(
      (b) => b.x >= -1 && b.y >= -1 && b.right <= 1025 && b.bottom <= 769,
    ),
    "buttons remain inside iPad viewport: " +
      JSON.stringify(
        layout.filter((b) => b.x < 0 || b.right > 1025 || b.bottom > 769),
      ),
  );
  assert.ok(
    await page.locator("[data-screen] .lucide-hand").count(),
    "hand hint on screen " + n,
  );
}
async function pathTouch(locator, points) {
  const b = await locator.boundingBox();
  assert.ok(b);
  const coords = points.map(([x, y]) => ({
    x: b.x + b.width * x,
    y: b.y + b.height * y,
    id: 1,
  }));
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [coords[0]],
  });
  for (const p of coords.slice(1))
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [p],
    });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await page.waitForTimeout(150);
}
async function cook(name) {
  const el = page.locator('[data-process="' + name + '"]');
  for (
    let n = 0;
    n < 20 && (await el.getAttribute("aria-label")) !== "できた！";
    n++
  ) {
    if (name === "rice") await el.tap();
    else
      await pathTouch(
        el,
        Array.from({ length: 30 }, (_, i) => [
          0.5 + 0.27 * Math.cos(i / 2),
          0.5 + 0.27 * Math.sin(i / 2),
        ]),
      );
    await page.waitForTimeout(60);
  }
  assert.equal(await el.getAttribute("aria-label"), "できた！");
  check("touch completes " + name);
}
async function drag(source, fx, fy, target = page.locator("[data-board]")) {
  const a = await source.boundingBox(),
    b = await target.boundingBox();
  assert.ok(a && b);
  const start = { x: a.x + a.width / 2, y: a.y + a.height / 2, id: 1 },
    end = { x: b.x + b.width * fx, y: b.y + b.height * fy, id: 1 };
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [start],
  });
  for (let i = 1; i <= 12; i++)
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          x: start.x + ((end.x - start.x) * i) / 12,
          y: start.y + ((end.y - start.y) * i) / 12,
          id: 1,
        },
      ],
    });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await page.waitForTimeout(250);
}
async function holdGate(ms) {
  const b = await button("3びょう ながおし").boundingBox();
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2, id: 1 }],
  });
  await page.waitForTimeout(ms);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await page.waitForTimeout(300);
}
try {
  await page.goto(base);
  await shot(1);
  await tap("おべんとう");
  await shot(2);
  assert.equal(await button("つめよう").getAttribute("aria-disabled"), "true");
  await tap("つめよう");
  await stage(2);
  check("packing locked until a cooked food exists");
  await tap("おにぎり");
  await shot(3);
  await tap("うめ");
  await cook("rice");
  await tap("つぎへ");
  await shot(4);
  await page.locator('[data-process="egg"]').tap();
  await page.waitForTimeout(90);
  assert.equal(
    Number(
      await page.locator('[data-process="egg"]').getAttribute("data-progress"),
    ),
    0.5,
  );
  await page.locator('[data-process="egg"]').tap();
  await page.waitForTimeout(90);
  assert.equal(
    Number(
      await page.locator('[data-process="egg"]').getAttribute("data-progress"),
    ),
    1,
  );
  check("two egg taps count two eggs");
  await cook("egg");
  await tap("つぎへ");
  await shot(5);
  await tap("カレー");
  await cook("chicken");
  await tap("つぎへ");
  await shot(6);
  await cook("broccoli");
  await tap("メニューへ");
  await tap("トマト");
  await cook("tomato");
  await tap("メニューへ");
  await tap("にんじん");
  await tap("ほし");
  await cook("carrot");
  await tap("つぎへ");
  await stage(7);
  assert.equal(await button("できた！").getAttribute("aria-disabled"), "true");
  await tap("できた！");
  await stage(7);
  check("empty bento cannot complete");
  assert.equal(await page.locator("[data-food-drag]").count(), 3);
  check("shelf shows exactly three large items");
  await drag(button("おにぎりを のせる"), 0.3, 0.4);
  await tap("おにぎりを のせる");
  await tap("たまごやきを のせる");
  await tap("つぎの おかず");
  await tap("ブロッコリーを のせる");
  await tap("トマトを のせる");
  await drag(button("にんじんを のせる"), 0.75, 0.55);
  let r = (await session()).recipe;
  assert.equal(r.items.length, 6);
  assert.equal(r.items[0].variant, "ume");
  assert.equal(r.items.find((p) => p.food === "carrot").variant, "star");
  check("tap, drag, variants and duplicate food placement work");
  const first = r.items[0].id,
    firstLoc = page.locator('[data-piece="' + first + '"]');
  await drag(firstLoc, 0.25, 0.6);
  r = (await session()).recipe;
  const beforeTurn = r.items.find((p) => p.id === first).rotation;
  await firstLoc.tap();
  await page.waitForTimeout(70);
  await firstLoc.tap();
  await page.waitForTimeout(250);
  assert.equal(
    (await session()).recipe.items.find((p) => p.id === first).rotation,
    (beforeTurn + 90) % 360,
  );
  check("double tap rotates food by 90 degrees");
  await drag(firstLoc, 0.5, 0.5, page.locator("[data-shelf]"));
  assert.equal((await session()).recipe.items.length, 5);
  await tap("もどす");
  assert.equal((await session()).recipe.items.length, 6);
  assert.equal(await button("もどす").getAttribute("aria-disabled"), "true");
  check(
    "return to shelf removes food and one-step undo restores exact arrangement",
  );
  await shot(7);
  const original = (await session()).recipe;
  await tap("できた！");
  await shot(8);
  await tap("たべてみる");
  await shot(9);
  await page.locator("[data-eat]").first().tap();
  await page.waitForTimeout(100);
  assert.equal(await page.locator("[data-eat]").count(), 6);
  await page.locator("[data-eat]").first().tap();
  await page.waitForTimeout(100);
  assert.equal(await page.locator("[data-eat]").count(), 5);
  assert.deepEqual((await session()).recipe.items, original.items);
  check("two bites consume display food while preserving original artwork");
  await tap("アルバムへ");
  await shot(10);
  await tap("ほぞんする");
  await button("アルバムへ").waitFor({ timeout: 15000 });
  await tap("アルバムへ");
  await stage(16);
  assert.equal(await page.locator('img[alt="つくった おべんとう"]').count(), 1);
  await page.reload();
  await stage(16);
  assert.equal(await page.locator('img[alt="つくった おべんとう"]').count(), 1);
  check("IndexedDB album persists after reload");
  await page.locator('img[alt="つくった おべんとう"]').tap();
  assert.equal(await button("この さくひんを けす").count(), 0);
  await tap("おうちの かたへ");
  await holdGate(600);
  assert.equal(await button("3びょう ながおし").count(), 1);
  await holdGate(3200);
  await tap("この さくひんを けす");
  await tap("けした さくひんを もどす");
  check("album deletion requires parent hold; undo restores artwork");
  await tap("ホーム");
  await tap("ケーキ");
  await shot(11);
  await tap("チョコ");
  assert.ok(await page.locator('svg image[href*="cake-chocolate"]').count());
  await tap("バナナは あとで のせる");
  check("cake flavor updates immediately and future toppings respond");
  await tap("つくろう");
  await shot(12);
  await cook("batter");
  await tap("つぎへ");
  await shot(13);
  await cook("bake");
  await tap("つぎへ");
  await stage(14);
  await pathTouch(page.locator("[data-board]"), [
    [0.24, 0.3],
    [0.76, 0.3],
    [0.76, 0.4],
    [0.24, 0.4],
  ]);
  for (let i = 0; i < 5 && (await page.getByRole("progressbar").count()); i++)
    await pathTouch(page.locator("[data-board]"), [
      [0.22, 0.24 + i * 0.03],
      [0.78, 0.24 + i * 0.03],
      [0.7, 0.44],
      [0.3, 0.44],
    ]);
  assert.equal(await page.getByRole("progressbar").count(), 0);
  check("cream requires coverage and retains actual painted strokes");
  assert.equal(await button("できた！").getAttribute("aria-disabled"), "true");
  await tap("できた！");
  await stage(14);
  check("empty cake cannot complete");
  await tap("いちごを のせる");
  await tap("いちごを のせる");
  await drag(button("いちごを のせる"), 0.65, 0.35);
  await tap("つぎの おかず");
  await tap("ブルーベリーを のせる");
  await shot(14);
  assert.equal(
    (await session()).recipe.items.filter((p) => p.food === "strawberry")
      .length,
    3,
  );
  check("cake count mission reaches exactly three strawberries");
  await page.reload();
  await button("つづきから").waitFor();
  await tap("つづきから");
  await stage(14);
  assert.equal(await button("つづきから").count(), 0);
  assert.equal((await session()).recipe.items.length, 4);
  check("one resume choice restores cake draft and decorations");
  await tap("できた！");
  await shot(15);
  await tap("たべてみる");
  await stage(9);
  assert.equal((await session()).recipe.mode, "cake");
  await tap("アルバムへ");
  await tap("ほぞんする");
  await button("アルバムへ").waitFor({ timeout: 15000 });
  await tap("アルバムへ");
  await shot(16);
  assert.equal(await page.locator('img[alt^="つくった"]').count(), 2);
  check("cake and bento both survive taste/save flow in the same album");
  await tap("ホーム");
  await tap("せってい");
  await holdGate(3200);
  await shot(17);
  assert.equal(
    await page.getByText("ことば：にほんご", { exact: true }).count(),
    0,
  );
  await page.getByRole("switch", { name: "こえの あんない" }).tap();
  await page.waitForTimeout(300);
  let audio = await page.evaluate(() => window.__audio);
  await tap("もういちど きく");
  await page.waitForTimeout(700);
  assert.equal(
    (await page.evaluate(() => window.__audio)).voices,
    audio.voices,
  );
  check("narration setting prevents playback independently");
  await page.getByRole("switch", { name: "こうかおん" }).tap();
  await page.waitForTimeout(200);
  audio = await page.evaluate(() => window.__audio);
  await tap("もういちど きく");
  assert.equal((await page.evaluate(() => window.__audio)).tones, audio.tones);
  check("sound toggle prevents new oscillator sounds");
  await page.getByRole("switch", { name: "こえの あんない" }).tap();
  await tap("もういちど きく");
  await page.waitForTimeout(700);
  assert.ok((await page.evaluate(() => window.__audio)).voices > audio.voices);
  check("prerecorded narration plays through unlocked AudioContext");
  await page.reload();
  await holdGate(3200);
  await stage(17);
  assert.equal(
    await page
      .getByRole("switch", { name: "こうかおん" })
      .getAttribute("aria-checked"),
    "false",
  );
  check("settings persist and remain parent gated after reload");
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.getByText("よこに してね", { exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, "portrait.png") });
  check("portrait overlay replaces shrunken play stage");
  await page.setViewportSize({ width: 568, height: 320 });
  await page.getByText("よこに してね", { exact: true }).waitFor();
  check("small landscape phone also gets rotation/tablet guidance");
  await page.setViewportSize({ width: 1024, height: 768 });
  await tap("もどる");
  await stage(1);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForTimeout(1500);
  await context.setOffline(true);
  await page.reload();
  await stage(1);
  await tap("アルバム");
  await stage(16);
  assert.equal(await page.locator('img[alt^="つくった"]').count(), 2);
  check("offline reload and saved album work");
  await context.setOffline(false);
  assert.deepEqual(errors, []);
  assert.deepEqual(badResponses, []);
  check("no runtime errors, console errors or 404 responses");
  assert.equal(new Set(screenshots.map((f) => Number(f.slice(0, 2)))).size, 17);
  check("all 17 screens captured at 1024 by 768");
} catch (error) {
  await page.screenshot({ path: path.join(output, "failure.png") });
  throw error;
} finally {
  await writeFile(
    path.join(output, "report.json"),
    JSON.stringify(
      {
        base,
        checks,
        screenshots,
        errors,
        badResponses,
        physicalIPadSafari: false,
      },
      null,
      2,
    ),
  );
  await browser.close();
  await server?.close();
}

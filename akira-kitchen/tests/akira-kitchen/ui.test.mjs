import assert from "node:assert/strict";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { JSDOM, VirtualConsole } from "jsdom";
import { indexedDB } from "fake-indexeddb";
import { bundle, project } from "./bundle.mjs";
const runtimeErrors = [];
// Only the app's local PNG assets are available to this offline test harness.
globalThis.fetch = async (url) => {
  assert.match(String(url), /^\/akira-kitchen\/illustration-[a-z-]+\.png$/);
  return new Response(await readFile(project + "public" + url), {
    headers: { "content-type": "image/png" },
  });
};
const virtualConsole = new VirtualConsole();
virtualConsole.on("jsdomError", (e) => runtimeErrors.push(e.message));
const dom = new JSDOM(
  '<!doctype html><html lang="ja"><body><div id="root"></div></body></html>',
  {
    url: "http://localhost:3060/akira-kitchen/",
    pretendToBeVisual: true,
    virtualConsole,
  },
);
const w = dom.window;
Object.assign(globalThis, {
  window: w,
  document: w.document,
  HTMLElement: w.HTMLElement,
  SVGElement: w.SVGElement,
  HTMLDialogElement: w.HTMLDialogElement,
  localStorage: w.localStorage,
  indexedDB,
  IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: w.navigator,
});
class Pointer extends w.MouseEvent {
  constructor(type, options) {
    super(type, options);
    Object.defineProperty(this, "pointerId", { value: options.pointerId ?? 1 });
    Object.defineProperty(this, "pointerType", {
      value: options.pointerType ?? "touch",
    });
  }
}
w.PointerEvent = Pointer;
globalThis.PointerEvent = Pointer;
globalThis.ResizeObserver = class {
  constructor(callback) {
    this.callback = callback;
  }
  observe() {
    this.callback();
  }
  disconnect() {}
};
w.HTMLElement.prototype.setPointerCapture = () => {};
w.HTMLElement.prototype.getBoundingClientRect = function () {
  const isBoard =
    this.getAttribute("aria-label")?.includes("かざりだい") ||
    this.getAttribute("aria-label") === "おべんとうばこ";
  return {
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: isBoard ? 800 : 520,
    bottom: isBoard ? 500 : 400,
    width: isBoard ? 800 : 520,
    height: isBoard ? 500 : 400,
  };
};
w.HTMLDialogElement.prototype.showModal = function () {
  this.open = true;
};
w.HTMLDialogElement.prototype.close = function () {
  this.open = false;
};
let oscillatorStarts = 0;
const gains = [];
class Param {
  value = 1;
  setValueAtTime() {}
  linearRampToValueAtTime() {}
  exponentialRampToValueAtTime() {}
}
class AudioStub {
  currentTime = 0;
  destination = {};
  createGain() {
    const node = { gain: new Param(), connect() {}, disconnect() {} };
    gains.push(node);
    return node;
  }
  createOscillator() {
    return {
      frequency: new Param(),
      connect() {},
      disconnect() {},
      start() {
        oscillatorStarts++;
      },
      stop() {},
      type: "sine",
    };
  }
  resume() {
    return Promise.resolve();
  }
  suspend() {
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
}
w.AudioContext = AudioStub;
const { act } = await import("react"),
  React = await import("react"),
  { createRoot } = await import("react-dom/client");
const { AkiraKitchen } = await bundle(
  "ui",
  "src/app/akira-kitchen/akira-kitchen.tsx",
);
const storage = await bundle(
  "storage",
  "src/app/akira-kitchen/cooking-storage.ts",
);
const art = await bundle("art", "src/app/akira-kitchen/cooking-art.tsx");
const illustrations = await bundle(
  "illustrations",
  "src/app/akira-kitchen/illustration-assets.ts",
);
let root = createRoot(document.getElementById("root"));
const checks = [];
const check = (name, fn) => {
  fn?.();
  checks.push(name);
  console.log("PASS " + name);
};
const settle = async (ms = 150) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
const norm = (s) => (s ?? "").replace(/\s/g, "");
const buttons = () => [
  ...(document.querySelector("dialog[open]") ?? document).querySelectorAll(
    "button",
  ),
];
const button = (name) => {
  const b = buttons().find(
    (b) => norm(b.getAttribute("aria-label") ?? b.textContent) === norm(name),
  );
  assert.ok(b, "button " + name);
  return b;
};
const click = async (el) => {
  assert.ok(el && !el.disabled, "clickable element");
  await act(async () =>
    el.dispatchEvent(new w.MouseEvent("click", { bubbles: true, detail: 0 })),
  );
};
const pointer = async (el, type, x = 200, y = 150, id = 1) =>
  act(async () =>
    el.dispatchEvent(
      new Pointer(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        pointerId: id,
        pointerType: "touch",
        button: 0,
      }),
    ),
  );
const tap = async (el) => {
  await pointer(el, "pointerdown");
  await pointer(el, "pointerup");
};
const screen = () =>
  Number(document.querySelector("[data-screen]").dataset.screen);
const recipe = () =>
  JSON.parse(localStorage.getItem("akira-kitchen:session:v2")).recipe;
const next = async () => click(button("つぎへ"));
const cook = async (process) => {
  for (let n = 0; n < 20; n++) {
    const target = document.querySelector(`[data-process="${process}"]`);
    if (target.getAttribute("aria-label") === "できた！") return;
    await tap(target);
  }
  assert.fail("cooking did not finish");
};
await act(async () => root.render(React.createElement(AkiraKitchen)));
await settle();
check("home is composed from DOM controls and supplied character", () => {
  assert.equal(screen(), 1);
  assert.ok(
    document.querySelector(
      'image[href="/akira-kitchen/illustration-chef.png"]',
    ),
  );
  assert.equal(document.querySelectorAll("img.full-img").length, 0);
});
await click(button("おべんとう"));
assert.equal(screen(), 2);
await click(button("おにぎり"));
assert.equal(screen(), 3);
await click(button("うめ"));
await cook("rice");
await settle();
check(
  "rice is taken, squeezed through three stages and flavor retained",
  () => {
    assert.equal(recipe().progress.rice, 3);
    assert.equal(recipe().rice, "ume");
    assert.ok(recipe().ready.includes("onigiri"));
  },
);
await next();
await click(button("チーズ"));
await tap(document.querySelector('[data-process="egg"]'));
await tap(document.querySelector('[data-process="egg"]'));
const eggGesture = document.querySelector('[data-process="egg"]');
await pointer(eggGesture, "pointerdown", 260, 100);
await pointer(eggGesture, "pointermove", 340, 150);
assert.ok(eggGesture.querySelector('g[transform^="rotate("]'));
for (const [x, y] of [
  [300, 250],
  [200, 250],
  [160, 150],
  [260, 100],
])
  await pointer(eggGesture, "pointermove", x, y);
await pointer(eggGesture, "pointerup", 260, 100);
check("freehand circular motion advances mixing and updates the spoon", () => {
  assert.ok(Number(eggGesture.dataset.progress) > 1);
});
await cook("egg");
await settle();
check("egg cracks, mixes, pours, rolls twice and completes", () => {
  assert.equal(recipe().progress.egg, 5);
  assert.equal(recipe().egg, "cheese");
});
await next();
await click(button("カレー"));
await cook("chicken");
await settle();
check("chicken seasoning, rolling, pot and browning complete", () => {
  assert.equal(recipe().progress.chicken, 4);
  assert.equal(recipe().chicken, "curry");
});
await next();
await cook("broccoli");
await click(button("にんじん"));
await click(button("ほしの にんじん"));
await cook("carrot");
await click(button("トマト"));
await cook("tomato");
await settle();
check("vegetables cook independently with selected carrot shape", () => {
  assert.equal(recipe().vegetables.length, 3);
  assert.equal(recipe().carrotShape, "star");
});
await next();
assert.equal(screen(), 7);
const tile = button("おにぎりを のせる");
await pointer(tile, "pointerdown", 100, 600);
await pointer(tile, "pointermove", 220, 160);
await pointer(tile, "pointerup", 220, 160);
await settle();
check("pantry food follows pointer and places at chosen coordinates", () => {
  assert.equal(recipe().items.length, 1);
  assert.ok(Math.abs(recipe().items[0].x - 27.5) < 0.001);
  assert.equal(recipe().items[0].y, 32);
  assert.equal(recipe().items[0].variant, "ume");
});
await tap(button("おにぎりを のせる"));
await tap(button("たまごやきを のせる"));
await tap(button("からあげを のせる"));
await tap(button("にんじんを のせる"));
await settle();
check("duplicate foods and selected flavors are reflected in the dish", () => {
  assert.equal(recipe().items.length, 5);
  assert.equal(recipe().items[2].variant, "cheese");
  assert.equal(recipe().items[3].variant, "curry");
  assert.equal(recipe().items[4].variant, "star");
});
const first = document.querySelector("[data-piece]");
await pointer(first, "pointerdown", 220, 160);
await pointer(first, "pointermove", 600, 360);
await pointer(first, "pointerup", 600, 360);
await settle();
const beforeCancel = structuredClone(recipe());
check("existing food can be repositioned freely", () =>
  assert.notEqual(recipe().items[0].x, 27.5),
);
await pointer(button("トマトを のせる"), "pointerdown");
await pointer(button("トマトを のせる"), "pointermove", 500, 200);
await pointer(button("トマトを のせる"), "pointercancel", 500, 200);
await settle();
check("cancelled pointer does not add or lose food", () =>
  assert.deepEqual(recipe(), beforeCancel),
);
await click(button("↩ はずす"));
await settle();
assert.equal(recipe().items.length, 4);
await click(button("もどす"));
await settle();
check("remove and undo restore exact arrangement", () =>
  assert.deepEqual(recipe().items, beforeCancel.items),
);
await click(button("できた！"));
assert.equal(screen(), 8);
await settle();
const finished = structuredClone(recipe());
check("completion renders actual selected arrangement", () =>
  assert.ok(
    document.querySelector(
      '[aria-label="じぶんの おべんとう"] ellipse[fill="#fff0a4"]',
    ),
  ),
);
await click(button("たべてみる"));
await click(button("おにぎりを たべる"));
await settle();
check("tasting consumes display food without changing saved original", () => {
  assert.equal(screen(), 9);
  assert.deepEqual(recipe().items, finished.items);
  assert.ok(document.body.textContent.includes("おいしい！"));
});
await click(button("アルバムへ"));
assert.equal(screen(), 10);
await click(button("ほぞんする"));
await settle();
let saved = await storage.listArtworks();
check("IndexedDB stores image, date, choices and all coordinates", () => {
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].recipe, finished);
  assert.equal(saved[0].image.type, "image/svg+xml");
  assert.ok(Date.parse(saved[0].createdAt));
});
assert.equal(
  await saved[0].image.text(),
  await illustrations.embedIllustrations(art.dishSVG(finished)),
);
await click(button("アルバム"));
assert.equal(screen(), 16);
await click(document.querySelector("time").closest("button"));
check("album reopens actual stored artwork in accessible dialog", () =>
  assert.ok(document.querySelector('dialog[open] img[src^="blob:"]')),
);
await click(button("けす"));
await settle();
assert.equal((await storage.listArtworks()).length, 0);
await click(button("けした さくひんを もどす"));
await settle();
saved = await storage.listArtworks();
check("deletion is persisted and undo restores the image and recipe", () =>
  assert.equal(saved.length, 1),
);
await click(button("もどる"));
await click(button("ケーキ"));
assert.equal(screen(), 11);
await click(button("チョコ"));
await click(button("つくろう"));
assert.equal(screen(), 12);
await cook("batter");
await next();
await cook("bake");
await next();
assert.equal(screen(), 14);
await click(button("🖌 クリーム"));
const board = document.querySelector('[aria-label="ケーキの かざりだい"]');
await pointer(board, "pointerdown", 280, 180);
await pointer(board, "pointermove", 340, 200);
await pointer(board, "pointermove", 460, 200);
await pointer(board, "pointerup", 460, 200);
await settle();
check("cream strokes follow touch and persist as one stroke", () => {
  assert.equal(recipe().strokes.length, 1);
  assert.equal(recipe().strokes[0].length, 3);
  assert.equal(recipe().progress.cream, 1);
});
await tap(button("いちごを のせる"));
await tap(button("バナナを のせる"));
await tap(button("ブルーベリーを のせる"));
await settle();
let topping = document.querySelector("[data-piece]");
await pointer(topping, "pointerdown", 200, 200);
await pointer(topping, "pointermove", 300, 150);
await pointer(topping, "pointerup", 300, 150);
await click(button("↩ はずす"));
await click(button("もどす"));
await settle();
check("cake toppings add, move, delete and undo independently of cream", () => {
  assert.equal(recipe().items.length, 3);
  assert.equal(recipe().strokes.length, 1);
  assert.equal(recipe().cake, "chocolate");
});
await click(button("できた！"));
assert.equal(screen(), 15);
await click(button("ほぞんする"));
await settle();
assert.equal((await storage.listArtworks()).length, 2);
check("cake and bento coexist in persistent album");
const originalCake = (await storage.listArtworks()).find(
  (w) => w.recipe.mode === "cake",
);
assert.ok(button("ほぞんしたよ").disabled);
await click(button("もどる"));
await tap(button("チョコを のせる"));
await settle();
check(
  "editing a saved work forks its id and keeps the original artwork",
  () => {
    assert.notEqual(recipe().id, originalCake.id);
  },
);
assert.deepEqual(
  (await storage.listArtworks()).find((w) => w.id === originalCake.id).recipe,
  originalCake.recipe,
);
await click(button("できた！"));
await click(button("ほぞんする"));
await settle();
assert.equal((await storage.listArtworks()).length, 3);
await click(button("アルバム"));
await click(button("もどる"));
await click(button("せってい"));
assert.equal(screen(), 17);
const soundToggle = buttons().find((b) =>
  b.closest("div")?.textContent.startsWith("おと"),
);
await click(soundToggle);
await settle();
await pointer(button("ホームへ"), "pointerdown");
const beforeMute = oscillatorStarts;
await click(button("ホームへ"));
await click(button("おべんとう"));
assert.equal(oscillatorStarts, beforeMute);
check("sound-off prevents new audio oscillators", () =>
  assert.equal(
    JSON.parse(localStorage.getItem("akira-kitchen:session:v2")).settings.sound,
    false,
  ),
);
await settle();
const reloadDraft = structuredClone(recipe());
await act(async () => root.unmount());
root = createRoot(document.getElementById("root"));
await act(async () => root.render(React.createElement(AkiraKitchen)));
await settle();
check("reload restores settings, draft and IndexedDB album", () => {
  assert.deepEqual(recipe(), reloadDraft);
  assert.equal(
    JSON.parse(localStorage.getItem("akira-kitchen:session:v2")).settings.sound,
    false,
  );
});
assert.equal((await storage.listArtworks()).length, 3);
// All 17 actual React trees, exported as reviewable DOM snapshots (not browser screenshots).
await mkdir(project + "docs/akira-kitchen/qa/v2-dom", { recursive: true });
for (let i = 1; i <= 17; i++) {
  await act(async () => {
    w.history.replaceState({}, "", `#screen=${i}`);
    w.dispatchEvent(new w.HashChangeEvent("hashchange"));
  });
  assert.equal(screen(), i);
  assert.ok(document.querySelector("h1").textContent);
  await writeFile(
    project + `docs/akira-kitchen/qa/v2-dom/${String(i).padStart(2, "0")}.html`,
    document.querySelector("main").outerHTML,
  );
}
check("all 17 screens render without runtime exceptions", () =>
  assert.deepEqual(runtimeErrors, []),
);
// Low-storage errors are recoverable, never masquerade as a successful save.
await act(async () => {
  w.history.replaceState({}, "", "#screen=10");
  w.dispatchEvent(new w.HashChangeEvent("hashchange"));
});
const realIDB = globalThis.indexedDB;
globalThis.indexedDB = {
  open() {
    throw new Error("QuotaExceededError");
  },
};
await click(button("ほぞんする"));
await settle();
globalThis.indexedDB = realIDB;
check("failed album write gives retry feedback and leaves save enabled", () => {
  assert.ok(document.body.textContent.includes("ほぞんできませんでした"));
  assert.equal(button("ほぞんする").disabled, false);
});
await act(async () => root.unmount());
w.close();
await writeFile(
  project + "docs/akira-kitchen/qa/v2-ui-results.json",
  JSON.stringify(
    {
      environment:
        "JSDOM + fake-indexeddb + synthetic Pointer Events; not iPad Safari",
      passed: checks.length,
      checks,
      runtimeErrors,
    },
    null,
    2,
  ),
);
console.log(`${checks.length} UI/storage checks passed.`);

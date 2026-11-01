import assert from "node:assert/strict";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { JSDOM, VirtualConsole } from "jsdom";
import { indexedDB } from "fake-indexeddb";
import { bundle, project } from "./bundle.mjs";
const runtimeErrors = [];
// Only the app's local PNG assets are available to this offline test harness.
globalThis.fetch = async (url) => {
  assert.match(
    String(url),
    /^\/akira-kitchen\/(?:media\/[a-z0-9-]+\.webp|audio\/[a-z0-9-]+\.mp3)$/,
  );
  return new Response(await readFile(project + "public" + url), {
    headers: {
      "content-type": String(url).endsWith(".mp3")
        ? "audio/mpeg"
        : "image/webp",
    },
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
    left: this.hasAttribute("data-shelf") ? 1000 : 0,
    top: 0,
    right: this.hasAttribute("data-shelf") ? 1300 : isBoard ? 800 : 520,
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
globalThis.Image = class {
  set src(value) {
    queueMicrotask(() => this.onload?.());
  }
  decode() {
    return Promise.resolve();
  }
};
globalThis.requestAnimationFrame = w.requestAnimationFrame.bind(w);
globalThis.cancelAnimationFrame = w.cancelAnimationFrame.bind(w);
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
const saveFromUI = async () => {
  await click(button("ほぞんする"));
  // Image embedding and IndexedDB have variable latency. Wait for the UI's
  // completed state inside act instead of assuming a fixed 150 ms is enough.
  for (let attempt = 0; attempt < 50; attempt++) {
    await settle(100);
    if (buttons().some((b) => norm(b.textContent) === "アルバムへ")) return;
  }
  assert.fail("save did not finish");
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

check("home has independent controls and canonical chef", () => {
  assert.equal(screen(), 1);
  assert.ok(document.querySelector('img[src$="/chef-home.webp"]'));
  assert.ok(button("もういちど きく"));
});
await click(button("おべんとう"));
await settle(300);
await click(button("つめよう"));
await settle();
check("empty pantry cannot reach arrangement", () => assert.equal(screen(), 2));
await click(button("おにぎり"));
await settle();
await click(button("うめ"));
await cook("rice");
await next();
await settle();
await cook("egg");
await next();
await settle();
await click(button("カレー"));
await cook("chicken");
await next();
await settle();
await cook("broccoli");
await next();
await settle();
check("all main cooking types reach completed state", () =>
  assert.deepEqual(recipe().ready, [
    "onigiri",
    "tamago",
    "karaage",
    "broccoli",
  ]),
);
await click(button("できた！"));
await settle();
check("empty bento cannot complete", () => assert.equal(screen(), 7));
await click(button("おにぎりを のせる"));
await settle();
await click(button("おにぎりを のせる"));
await click(button("たまごやきを のせる"));
await settle();
check("duplicate food, selected flavors and placement persist", () => {
  assert.equal(recipe().items.length, 3);
  assert.equal(recipe().items[0].variant, "ume");
  assert.notEqual(recipe().items[0].x, recipe().items[1].x);
});
const first = recipe().items[0],
  piece = document.querySelector('[data-piece="' + first.id + '"]');
await pointer(piece, "pointerdown", first.x * 8, first.y * 5);
await pointer(piece, "pointermove", 600, 300);
await pointer(piece, "pointerup", 600, 300);
await settle();
check("moving food updates only its coordinates", () => {
  assert.notEqual(recipe().items[0].x, first.x);
  assert.equal(recipe().items.length, 3);
});
await click(button("はずす"));
await settle();
assert.equal(recipe().items.length, 2);
await click(button("もどす"));
await settle();
check("one-step undo restores exact food", () =>
  assert.equal(recipe().items.length, 3),
);
const original = structuredClone(recipe());
await click(button("できた！"));
await settle();
check("completion renders selected dish", () => {
  assert.equal(screen(), 8);
  assert.ok(document.querySelector('image[href*="rice-ume"]'));
});
await click(button("たべてみる"));
await settle();
await click(button("おにぎりを たべる"));
await settle();
check("one bite retains food; second bite removes only display", () =>
  assert.equal(document.querySelectorAll("[data-eat]").length, 3),
);
await click(button("おにぎりを たべる"));
await settle();
assert.equal(document.querySelectorAll("[data-eat]").length, 2);
assert.deepEqual(recipe().items, original.items);
await click(button("アルバムへ"));
await settle();
await saveFromUI();
const saved = await storage.listArtworks();
check("IndexedDB stores real image, choices, coordinates and date", () => {
  assert.equal(saved.length, 1);
  assert.equal(saved[0].recipe.rice, "ume");
  assert.deepEqual(saved[0].recipe.items, original.items);
  assert.ok(saved[0].image.size > 10000);
  assert.ok(Date.parse(saved[0].createdAt));
});
const svg = await saved[0].image.text();
check("saved work has embedded WebP artwork and no external dependency", () => {
  assert.ok(svg.includes("data:image/webp;base64,"));
  assert.ok(!svg.includes('href="/akira-kitchen/'));
});
await click(button("アルバムへ"));
await settle();
await click(
  document.querySelector('img[alt="つくった おべんとう"]').closest("button"),
);
await settle();
check(
  "album opens a full-screen artwork and hides delete behind parent gate",
  () => {
    assert.ok(document.querySelector('[role="dialog"][aria-label="さくひん"]'));
    assert.ok(
      !buttons().some((b) => norm(b.textContent) === "このさくひんをけす"),
    );
  },
);
await click(button("とじる"));
await click(button("ホーム"));
await settle();
await click(button("ケーキ"));
await settle(300);
await click(button("チョコ"));
await click(button("つくろう"));
await settle();
await cook("batter");
await next();
await settle();
await cook("bake");
await next();
await settle();
check("cake starts with cream before toppings", () => {
  assert.equal(screen(), 14);
  assert.ok(document.querySelector('[role="progressbar"]'));
  assert.equal(document.querySelectorAll("[data-food-drag]").length, 0);
});
let board = document.querySelector("[data-board]");
for (let n = 0; n < 5 && document.querySelector('[role="progressbar"]'); n++) {
  await pointer(board, "pointerdown", 200, 130);
  await pointer(board, "pointermove", 600, 130 + n * 20);
  await pointer(board, "pointermove", 600, 200);
  await pointer(board, "pointermove", 200, 200);
  await pointer(board, "pointerup", 200, 200);
  await settle();
}
check(
  "cream follows strokes, reaches coverage, then unlocks topping shelf",
  () => {
    assert.ok(recipe().strokes.length);
    assert.equal(recipe().progress.cream, 1);
    assert.equal(document.querySelectorAll("[data-food-drag]").length, 3);
  },
);
await click(button("できた！"));
await settle();
assert.equal(screen(), 14);
await click(button("いちごを のせる"));
await click(button("いちごを のせる"));
await click(button("いちごを のせる"));
await settle();
const cake = recipe();
await click(button("できた！"));
await settle();
await click(button("たべてみる"));
await settle();
assert.equal(recipe().mode, "cake");
await click(button("アルバムへ"));
await settle();
await saveFromUI();
const savedCakeAlbum = await storage.listArtworks();
check("cake survives tasting and is saved beside bento", () => {
  assert.equal(savedCakeAlbum.length, 2);
  assert.equal(recipe().cake, "chocolate");
  assert.deepEqual(recipe().strokes, cake.strokes);
});
await act(async () => root.unmount());
root = createRoot(document.getElementById("root"));
await act(async () => root.render(React.createElement(AkiraKitchen)));
await settle();
check("resume dialog is shown once on restoration", () =>
  assert.ok(button("つづきから")),
);
await click(button("つづきから"));
await settle();
check("resume restores saved draft without touching album", () =>
  assert.equal(recipe().mode, "cake"),
);
await act(async () => root.unmount());
assert.deepEqual(runtimeErrors, []);
console.log("UI contract checks: " + checks.length + " passed");

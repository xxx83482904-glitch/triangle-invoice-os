import assert from "node:assert/strict";
import test from "node:test";
import { bundle } from "./bundle.mjs";
const { KitchenAudio } = await bundle(
  "audio",
  "src/app/akira-kitchen/cooking-audio.ts",
);
let starts = 0,
  resumed = 0,
  closed = false;
const gains = [];
let tick;
class Param {
  value = 1;
  setValueAtTime() {}
  linearRampToValueAtTime() {}
  exponentialRampToValueAtTime() {}
}
class Audio {
  currentTime = 0;
  destination = {};
  createGain() {
    const n = { gain: new Param(), connect() {}, disconnect() {} };
    gains.push(n);
    return n;
  }
  createOscillator() {
    return {
      frequency: new Param(),
      connect() {},
      disconnect() {},
      start() {
        starts++;
      },
      stop() {},
    };
  }
  resume() {
    resumed++;
    return Promise.resolve();
  }
  suspend() {
    return Promise.resolve();
  }
  close() {
    closed = true;
    return Promise.resolve();
  }
}
globalThis.window = { AudioContext: Audio };
globalThis.document = { hidden: false };
const originalInterval = globalThis.setInterval,
  originalClear = globalThis.clearInterval;
globalThis.setInterval = (fn) => {
  tick = fn;
  return 1;
};
globalThis.clearInterval = () => {
  tick = undefined;
};
const engine = new KitchenAudio();
test("audio stays silent until explicitly unlocked; sfx honor volume", () => {
  engine.play("finish");
  assert.equal(starts, 0);
  engine.unlock();
  assert.ok(resumed);
  engine.configure({ sound: true, bgm: false, volume: 0.4, language: "ja" });
  engine.play("finish");
  assert.equal(starts, 4);
  assert.equal(gains[0].gain.value, 0.4 * 0.23);
});
test("effect mute and background music are independent and persist through configure", () => {
  engine.configure({ sound: false, bgm: true, volume: 0.7, language: "ja" });
  const before = starts;
  engine.play("tap");
  assert.equal(starts, before);
  assert.equal(gains[0].gain.value, 0);
  tick();
  assert.equal(starts, before + 1);
  assert.equal(gains[1].gain.value, 0.7 * 0.08);
  document.hidden = true;
  tick();
  assert.equal(starts, before + 1);
  engine.configure({ sound: false, bgm: false, volume: 0, language: "ja" });
  assert.equal(tick, undefined);
  assert.equal(gains[1].gain.value, 0);
});
test("dispose releases audio and timers", () => {
  engine.dispose();
  assert.ok(closed);
  assert.equal(tick, undefined);
  globalThis.setInterval = originalInterval;
  globalThis.clearInterval = originalClear;
});

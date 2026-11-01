import type { Settings } from "./cooking-model";
export type Sound =
  | "tap"
  | "squeeze"
  | "mix"
  | "crack"
  | "pour"
  | "roll"
  | "pop"
  | "bake"
  | "eat"
  | "finish"
  | "save";
export class KitchenAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private note = 0;
  private settings: Settings = {
    sound: true,
    bgm: false,
    volume: 0.55,
    language: "ja",
  };
  unlock() {
    try {
      if (!this.context) {
        const Type =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        if (!Type) return;
        this.context = new Type();
        this.master = this.context.createGain();
        this.master.connect(this.context.destination);
        this.music = this.context.createGain();
        this.music.connect(this.context.destination);
      }
      void this.context.resume().catch(() => {});
      this.configure(this.settings);
    } catch {
      /* Cooking remains playable if audio is unavailable. */
    }
  }
  configure(settings: Settings) {
    this.settings = settings;
    if (this.master)
      this.master.gain.value = settings.sound ? settings.volume * 0.23 : 0;
    if (this.music)
      this.music.gain.value = settings.bgm ? settings.volume * 0.08 : 0;
    if (settings.bgm && this.context && !this.timer)
      this.timer = setInterval(() => {
        if (document.hidden) return;
        const melody = [
          261.63, 329.63, 392, 329.63, 293.66, 349.23, 440, 349.23,
        ];
        this.tone(melody[this.note++ % melody.length], 0.32, 0, true);
      }, 480);
    if (!settings.bgm && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
  private tone(frequency: number, duration: number, delay = 0, bgm = false) {
    if (!this.context || !this.master || !this.music) return;
    const osc = this.context.createOscillator(),
      gain = this.context.createGain(),
      time = this.context.currentTime + delay;
    osc.type = bgm ? "sine" : "triangle";
    osc.frequency.setValueAtTime(frequency, time);
    osc.frequency.exponentialRampToValueAtTime(
      frequency * 0.86,
      time + duration,
    );
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.6, time + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    osc.connect(gain);
    gain.connect(bgm ? this.music : this.master);
    osc.start(time);
    osc.stop(time + duration + 0.01);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }
  play(sound: Sound) {
    if (!this.settings.sound) return;
    const notes: Record<Sound, number[]> = {
      tap: [660],
      squeeze: [290, 420],
      mix: [340, 460],
      crack: [890, 380],
      pour: [470, 390, 310],
      roll: [350, 490],
      pop: [700],
      bake: [260, 360, 420],
      eat: [240, 180],
      finish: [523, 659, 784, 1046],
      save: [660, 880, 1046],
    };
    notes[sound].forEach((n, i) => this.tone(n, 0.12, i * 0.065));
  }
  suspend() {
    void this.context?.suspend().catch(() => {});
  }
  dispose() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    void this.context?.close().catch(() => {});
    this.context = null;
  }
}

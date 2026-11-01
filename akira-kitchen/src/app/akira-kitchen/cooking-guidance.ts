import voices from "../../../content/narration.json";
import type { Point, Process, Recipe, Screen } from "./cooking-model";
export type Voice = keyof typeof voices;
export const countVoice = (count: number): Voice =>
  count >= 1 && count <= 6 ? (("count-" + count) as Voice) : "praise-4";
const captions: Partial<Record<Voice, string>> = {
  "triangle-mission": "さんかくを つくろう！",
  "triangle-done": "さんかく、できた！",
  "egg-mission": "たまごを 2こ わろう！",
  "brown-mission": "きつねいろに しよう！",
  "red-mission": "あかいのは どれ？",
  "green-mission": "みどりの やさいだね！",
  "flower-mission": "おはなの かたちは どれ？",
  "ingredients-mission": "ざいりょうを 3つ！",
  "cream-mission": "しろく ぬろう！",
  "take-rice": "ごはんを とろう！",
  squeeze: "ぎゅっ ぎゅっ！",
  mix: "ぐるぐる まぜよう！",
  pour: "とろーり いれよう！",
  roll: "くるっと まこう！",
  "round-meat": "ころころ まるめよう！",
  bake: "ふっくら やこう！",
  undo: "ひとつ もどしたよ！",
  "praise-2": "いいね！",
};
export const phrase = (key: Voice) => captions[key] ?? voices[key];
export const SCREEN_VOICE: Record<Screen, Voice> = {
  1: "home",
  2: "bento-menu",
  3: "rice-title",
  4: "egg-title",
  5: "chicken-title",
  6: "vegetables-title",
  7: "pack-title",
  8: "finish",
  9: "taste",
  10: "save",
  11: "cake-menu",
  12: "mix-title",
  13: "bake-title",
  14: "decorate-title",
  15: "finish",
  16: "album",
  17: "settings",
};
export function instruction(process: Process, value: number): Voice {
  const steps: Record<Process, Voice[]> = {
    rice: ["take-rice", "squeeze", "triangle-mission"],
    egg: ["egg-mission", "mix", "pour", "roll", "roll"],
    chicken: ["mix", "round-meat", "pot", "brown-mission"],
    broccoli: ["pot", "lift"],
    carrot: ["flower-mission", "cut-shape"],
    tomato: ["red-mission", "plate"],
    batter: ["flour", "egg", "milk", "mix", "mix"],
    bake: ["pour", "oven", "bake"],
    cream: ["cream-mission"],
  };
  return steps[process][Math.min(steps[process].length - 1, Math.floor(value))];
}
export function stageGroups(
  process: Process,
  value: number,
): { icons: string[]; active: number } {
  const icons: Record<Process, string[]> = {
    rice: ["rice-round", "rice-triangle", "rice-nori"],
    egg: ["ingredient-egg", "ingredient-milk", "tamago"],
    chicken: ["karaage", "karaage", "karaage"],
    broccoli: ["broccoli", "broccoli"],
    carrot: ["carrot-star", "carrot"],
    tomato: ["tomato", "tomato"],
    batter: ["ingredient-flour", "ingredient-egg", "ingredient-milk"],
    bake: ["cake-base", "cake-base", "cake-base"],
    cream: ["cream"],
  };
  const active =
    process === "egg"
      ? value < 1
        ? 0
        : value < 3
          ? 1
          : 2
      : process === "chicken"
        ? Math.min(2, Math.floor(value))
        : process === "batter"
          ? value < 3
            ? 0
            : value < 5
              ? 1
              : 2
          : Math.min(2, Math.floor(value));
  return { icons: icons[process], active };
}
export function mission(recipe: Recipe): {
  voice: Voice;
  done: boolean;
  count: number;
  target: number;
  food: string;
} {
  if (recipe.mode === "cake") {
    const count = recipe.items.filter((p) => p.food === "strawberry").length;
    return {
      voice: "strawberry-mission",
      done: count === 3,
      count,
      target: 3,
      food: "strawberry",
    };
  }
  if (recipe.ready.includes("onigiri")) {
    const count = recipe.items.filter((p) => p.food === "onigiri").length;
    return {
      voice: "pack-rice",
      done: count >= 2,
      count,
      target: 2,
      food: "onigiri",
    };
  }
  return {
    voice: "put-two",
    done: recipe.items.length >= 2,
    count: recipe.items.length,
    target: 2,
    food: recipe.ready[0] ?? "tomato",
  };
}
export function creamCoverage(strokes: Point[][]): number {
  const points: Point[] = [];
  for (let y = 16; y <= 48; y += 8)
    for (let x = 24; x <= 76; x += 8) points.push({ x, y });
  const near = (p: Point, a: Point, b: Point) => {
    const dx = b.x - a.x,
      dy = b.y - a.y,
      t = Math.max(
        0,
        Math.min(
          1,
          ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
        ),
      );
    return Math.hypot(p.x - a.x - dx * t, (p.y - a.y - dy * t) * 0.625) < 7;
  };
  return (
    points.filter((p) =>
      strokes.some((stroke) =>
        stroke.some((a, i) => near(p, a, stroke[i + 1] ?? a)),
      ),
    ).length / points.length
  );
}
export function rotatePiece(recipe: Recipe, id: string): Recipe {
  return {
    ...recipe,
    items: recipe.items.map((p) =>
      p.id === id ? { ...p, rotation: (p.rotation + 90) % 360 } : p,
    ),
  };
}

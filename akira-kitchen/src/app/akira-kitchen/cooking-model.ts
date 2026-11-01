export type Screen =
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14
  | 15
  | 16
  | 17;
export type Mode = "bento" | "cake";
export type Food =
  | "onigiri"
  | "tamago"
  | "karaage"
  | "broccoli"
  | "tomato"
  | "carrot"
  | "lettuce"
  | "miniTomato"
  | "strawberry"
  | "chocolate"
  | "banana"
  | "cream"
  | "blueberry"
  | "sprinkles";
export type Process =
  | "rice"
  | "egg"
  | "chicken"
  | "broccoli"
  | "carrot"
  | "tomato"
  | "batter"
  | "bake"
  | "cream";
export type Point = { x: number; y: number };
export type Piece = Point & {
  id: string;
  food: Food;
  variant: string;
  rotation: number;
};
export type Settings = {
  sound: boolean;
  bgm: boolean;
  volume: number;
  language: "ja";
};
export type Recipe = {
  id: string;
  mode: Mode;
  rice: string;
  egg: string;
  chicken: string;
  vegetables: Food[];
  carrotShape: string;
  cake: string;
  toppings: Food[];
  items: Piece[];
  strokes: Point[][];
  progress: Record<Process, number>;
  ready: Food[];
};
export type Session = {
  version: 2;
  screen: Screen;
  recipe: Recipe;
  settings: Settings;
};
export type Artwork = {
  id: string;
  createdAt: string;
  recipe: Recipe;
  image: Blob;
};
export const DEFAULT_SETTINGS: Settings = {
  sound: true,
  bgm: false,
  volume: 0.55,
  language: "ja",
};
export const SESSION_KEY = "akira-kitchen:session:v2";
export const MAX_PIECES = 30;
export const TITLES = [
  "",
  "なにを つくる？",
  "おべんとうを つくろう！",
  "おにぎりを つくろう！",
  "たまごやきを つくろう！",
  "からあげを つくろう！",
  "やさいを じゅんび！",
  "おべんとうに つめよう！",
  "できあがり！",
  "たべてみよう！",
  "アルバムに のこそう！",
  "ケーキを つくろう！",
  "まぜまぜ しよう！",
  "スポンジを やこう！",
  "ケーキを かざろう！",
  "できあがり！",
  "アルバム",
  "せってい",
];
export const NEXT: Partial<Record<Screen, Screen>> = {
  3: 4,
  4: 5,
  5: 6,
  6: 7,
  7: 8,
  8: 9,
  9: 10,
  10: 16,
  11: 12,
  12: 13,
  13: 14,
  14: 15,
  15: 16,
};
export const BACK: Record<Screen, Screen> = {
  1: 1,
  2: 1,
  3: 2,
  4: 2,
  5: 2,
  6: 2,
  7: 2,
  8: 7,
  9: 8,
  10: 9,
  11: 1,
  12: 11,
  13: 12,
  14: 13,
  15: 14,
  16: 1,
  17: 1,
};
export const FOODS: { id: Food; label: string }[] = [
  { id: "onigiri", label: "おにぎり" },
  { id: "tamago", label: "たまごやき" },
  { id: "karaage", label: "からあげ" },
  { id: "broccoli", label: "ブロッコリー" },
  { id: "tomato", label: "トマト" },
  { id: "carrot", label: "にんじん" },
  { id: "lettuce", label: "レタス" },
  { id: "miniTomato", label: "ミニトマト" },
  { id: "strawberry", label: "いちご" },
  { id: "chocolate", label: "チョコ" },
  { id: "banana", label: "バナナ" },
  { id: "cream", label: "クリーム" },
  { id: "blueberry", label: "ブルーベリー" },
  { id: "sprinkles", label: "カラフル" },
];
export const BENTO: Food[] = [
  "onigiri",
  "tamago",
  "karaage",
  "broccoli",
  "tomato",
  "carrot",
];
export const TOPPINGS: Food[] = [
  "strawberry",
  "chocolate",
  "banana",
  "cream",
  "blueberry",
  "sprinkles",
];
export const RICE = [
  ["nori", "のり"],
  ["ume", "うめ"],
  ["wakame", "わかめ"],
  ["salmon", "さけ"],
  ["yukari", "ゆかり"],
  ["sesame", "ごま"],
];
export const EGGS = [
  ["plain", "プレーン"],
  ["scallion", "ねぎ"],
  ["cheese", "チーズ"],
  ["spinach", "ほうれんそう"],
  ["carrot", "にんじん"],
];
export const CHICKEN = [
  ["soy", "しょうゆ"],
  ["salt", "しお"],
  ["curry", "カレー"],
  ["garlic", "にんにく"],
  ["lemon", "レモン"],
];
export const STAGES: Record<Process, string[]> = {
  rice: ["ごはんを とろう", "ぎゅっ ぎゅっ！", "さんかくに ぎゅっ！"],
  egg: [
    "たまごを ぱかっ！",
    "ぐるぐる まぜよう",
    "フライパンへ とろ〜り",
    "くるっと まこう",
    "もういちど くるっ！",
  ],
  chicken: [
    "あじを えらんで まぜよう",
    "ころころ まるめよう",
    "おなべへ ぽん！",
    "こんがり おいしく！",
  ],
  broccoli: ["おなべへ ぽん！", "やさいを すくおう"],
  carrot: ["かたちを えらぼう", "ぽんっと かたぬき！"],
  tomato: ["すきな トマトを えらぼう", "おさらへ ぽん！"],
  batter: [
    "たまごを いれよう",
    "こむぎこを いれよう",
    "ミルクを いれよう",
    "ぐるぐる まぜよう",
    "なめらかに まぜよう",
  ],
  bake: ["かたへ とろ〜り", "オーブンへ いれよう", "ふっくら やこう！"],
  cream: ["クリームを ぬろう"],
};
export function id(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
}
export function newRecipe(mode: Mode): Recipe {
  return {
    id: id(),
    mode,
    rice: "nori",
    egg: "plain",
    chicken: "soy",
    vegetables: [],
    carrotShape: "flower",
    cake: "vanilla",
    toppings: ["strawberry", "cream"],
    items: [],
    strokes: [],
    progress: {
      rice: 0,
      egg: 0,
      chicken: 0,
      broccoli: 0,
      carrot: 0,
      tomato: 0,
      batter: 0,
      bake: 0,
      cream: 0,
    },
    ready: [],
  };
}
export function label(food: Food) {
  return FOODS.find((x) => x.id === food)?.label ?? food;
}
export function progress(
  recipe: Recipe,
  process: Process,
  amount: number,
): Recipe {
  const old = recipe.progress[process];
  const limit = STAGES[process].length;
  const value = Math.min(
    limit,
    Math.floor(old + 1e-7) + 1,
    Math.round((old + Math.max(0, amount)) * 1000) / 1000,
  );
  const next = {
    ...recipe,
    progress: { ...recipe.progress, [process]: value },
  };
  const food: Food | undefined = (
    {
      rice: "onigiri",
      egg: "tamago",
      chicken: "karaage",
      broccoli: "broccoli",
      carrot: "carrot",
      tomato: "tomato",
    } as const
  )[process as "rice"];
  if (value >= limit && food) {
    next.ready = [...new Set([...recipe.ready, food])];
    if (["broccoli", "carrot", "tomato"].includes(food))
      next.vegetables = [...new Set([...recipe.vegetables, food])];
  }
  return next;
}
export function variant(recipe: Recipe, food: Food): string {
  return food === "onigiri"
    ? recipe.rice
    : food === "tamago"
      ? recipe.egg
      : food === "karaage"
        ? recipe.chicken
        : food === "carrot"
          ? recipe.carrotShape
          : "";
}
export function bound(mode: Mode, point: Point): Point {
  const x = Number.isFinite(point.x) ? point.x : 50,
    y = Number.isFinite(point.y) ? point.y : 50;
  if (mode === "bento")
    return {
      x: Math.max(15, Math.min(85, x)),
      y: Math.max(23, Math.min(66, y)),
    };
  const dx = (x - 50) / 29,
    dy = (y - 33) / 12,
    d = Math.max(1, Math.hypot(dx, dy));
  return { x: 50 + (dx / d) * 29, y: 33 + (dy / d) * 12 };
}
export function place(
  mode: Mode,
  point: Point,
  items: Piece[],
  exclude?: string,
): Point {
  const base = bound(mode, point);
  const others = items.filter((p) => p.id !== exclude);
  const separation = mode === "bento" ? 17 : 11;
  const clear = (p: Point) =>
    others.every((q) => Math.hypot(p.x - q.x, (p.y - q.y) * 0.8) >= separation);
  if (clear(base)) return base;
  // Search the closest available spot, never move a child's other food.
  for (let r = 5; r <= 90; r += 5)
    for (let a = 0; a < 24; a++) {
      const p = bound(mode, {
        x: base.x + Math.cos((a * Math.PI) / 12) * r,
        y: base.y + Math.sin((a * Math.PI) / 12) * r,
      });
      if (clear(p)) return p;
    }
  return base;
}
export function addPiece(
  recipe: Recipe,
  food: Food,
  point: Point = { x: 50, y: 50 },
): Recipe {
  if (recipe.items.length >= MAX_PIECES) return recipe;
  return {
    ...recipe,
    items: [
      ...recipe.items,
      {
        id: id(),
        food,
        variant: variant(recipe, food),
        rotation: 0,
        ...place(recipe.mode, point, recipe.items),
      },
    ],
  };
}
export function movePiece(
  recipe: Recipe,
  pieceId: string,
  point: Point,
  snap = true,
): Recipe {
  return {
    ...recipe,
    items: recipe.items.map((p) =>
      p.id === pieceId
        ? {
            ...p,
            ...(snap
              ? place(recipe.mode, point, recipe.items, pieceId)
              : bound(recipe.mode, point)),
          }
        : p,
    ),
  };
}
export function screenFrom(value: unknown): Screen {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 17
    ? (value as Screen)
    : 1;
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
export function parseSettings(v: unknown): Settings {
  if (!object(v)) return { ...DEFAULT_SETTINGS };
  return {
    sound: v.sound !== false,
    bgm: v.bgm === true,
    volume:
      typeof v.volume === "number" && Number.isFinite(v.volume)
        ? Math.max(0, Math.min(1, v.volume))
        : 0.55,
    language: "ja",
  };
}
export function parseRecipe(v: unknown): Recipe | null {
  if (!object(v) || (v.mode !== "bento" && v.mode !== "cake")) return null;
  const r = newRecipe(v.mode);
  r.id = typeof v.id === "string" ? v.id.slice(0, 100) : r.id;
  for (const [key, options] of [
    ["rice", RICE],
    ["egg", EGGS],
    ["chicken", CHICKEN],
  ] as const)
    if (options.some((x) => x[0] === v[key])) r[key] = String(v[key]);
  if (["vanilla", "chocolate", "strawberry"].includes(String(v.cake)))
    r.cake = String(v.cake);
  if (["flower", "star", "heart"].includes(String(v.carrotShape)))
    r.carrotShape = String(v.carrotShape);
  for (const key of ["vegetables", "ready", "toppings"] as const)
    if (Array.isArray(v[key]))
      r[key] = [
        ...new Set(
          v[key].filter((f): f is Food => FOODS.some((x) => x.id === f)),
        ),
      ];
  if (object(v.progress))
    for (const p of Object.keys(STAGES) as Process[]) {
      const n = v.progress[p];
      if (typeof n === "number" && Number.isFinite(n))
        r.progress[p] = Math.max(0, Math.min(STAGES[p].length, n));
    }
  const seen = new Set<string>();
  if (Array.isArray(v.items))
    for (const p of v.items.slice(0, MAX_PIECES))
      if (
        object(p) &&
        typeof p.id === "string" &&
        !seen.has(p.id) &&
        FOODS.some((x) => x.id === p.food) &&
        typeof p.x === "number" &&
        typeof p.y === "number" &&
        Number.isFinite(p.x) &&
        Number.isFinite(p.y)
      ) {
        seen.add(p.id);
        r.items.push({
          id: p.id.slice(0, 100),
          food: p.food as Food,
          variant: typeof p.variant === "string" ? p.variant.slice(0, 24) : "",
          rotation:
            typeof p.rotation === "number" && Number.isFinite(p.rotation)
              ? Math.max(-30, Math.min(30, p.rotation))
              : 0,
          ...bound(r.mode, { x: p.x, y: p.y }),
        });
      }
  if (Array.isArray(v.strokes))
    r.strokes = v.strokes
      .slice(0, 80)
      .filter(Array.isArray)
      .map((s) =>
        s
          .slice(0, 150)
          .filter(
            (p): p is Point =>
              object(p) &&
              typeof p.x === "number" &&
              typeof p.y === "number" &&
              Number.isFinite(p.x) &&
              Number.isFinite(p.y),
          )
          .map((p) => bound("cake", p)),
      );
  return r;
}
export function parseSession(raw: string | null): Session | null {
  try {
    const v = JSON.parse(raw ?? "null");
    if (!object(v) || v.version !== 2) return null;
    const recipe = parseRecipe(v.recipe);
    return recipe
      ? {
          version: 2,
          recipe,
          screen: screenFrom(v.screen),
          settings: parseSettings(v.settings),
        }
      : null;
  } catch {
    return null;
  }
}

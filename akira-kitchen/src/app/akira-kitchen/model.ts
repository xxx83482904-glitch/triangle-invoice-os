export type KitchenMode = "bento" | "cake";
export type FoodId = "rice" | "egg" | "broccoli" | "tomato" | "shrimp" | "carrot" | "sausage" | "peas" | "strawberry" | "blueberry" | "cream" | "kiwi" | "orange" | "star" | "heart";
export type FoodColor = "しろ" | "きいろ" | "みどり" | "あか" | "オレンジ" | "むらさき" | "ピンク";
export type MissionId = "rainbow" | "berries" | "triangles";

export type Ingredient = { id: FoodId; name: string; color: FoodColor; category: string; modes: KitchenMode[] };
export type FoodPiece = { id: string; food: FoodId; x: number; y: number; rotation: number };
export type Recipe = { mode: KitchenMode; base: string; items: FoodPiece[]; mission: MissionId | null };
export type Work = Recipe & { id: string; title: string; createdAt: string; missionComplete: boolean };
export type Settings = { sound: boolean; voice: boolean };
export type SavedState = { version: 1; works: Work[]; draft: Recipe | null; settings: Settings };

export const STORAGE_KEY = "akira-kitchen:v1";
export const MAX_PIECES = 18;
export const MAX_WORKS = 50;
export const DEFAULT_SETTINGS: Settings = { sound: true, voice: false };

// randomUUID is unavailable over the local HTTP address used by an iPad.
// These are local artwork IDs, not authentication tokens.
export function createLocalId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  if (typeof globalThis.crypto?.getRandomValues === "function") return Array.from(globalThis.crypto.getRandomValues(new Uint32Array(4)), (value) => value.toString(16).padStart(8, "0")).join("");
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}


export const INGREDIENTS: Ingredient[] = [
  { id: "rice", name: "おにぎり", color: "しろ", category: "ごはん・おかず", modes: ["bento"] },
  { id: "egg", name: "たまごやき", color: "きいろ", category: "ごはん・おかず", modes: ["bento"] },
  { id: "broccoli", name: "ブロッコリー", color: "みどり", category: "やさい", modes: ["bento"] },
  { id: "tomato", name: "ミニトマト", color: "あか", category: "やさい", modes: ["bento"] },
  { id: "shrimp", name: "エビフライ", color: "オレンジ", category: "ごはん・おかず", modes: ["bento"] },
  { id: "carrot", name: "にんじん", color: "オレンジ", category: "やさい", modes: ["bento"] },
  { id: "sausage", name: "たこさん", color: "あか", category: "ごはん・おかず", modes: ["bento"] },
  { id: "peas", name: "えだまめ", color: "みどり", category: "やさい", modes: ["bento"] },
  { id: "strawberry", name: "いちご", color: "あか", category: "くだもの", modes: ["bento", "cake"] },
  { id: "blueberry", name: "ブルーベリー", color: "むらさき", category: "くだもの", modes: ["cake"] },
  { id: "cream", name: "クリーム", color: "しろ", category: "かざり", modes: ["cake"] },
  { id: "kiwi", name: "キウイ", color: "みどり", category: "くだもの", modes: ["cake"] },
  { id: "orange", name: "みかん", color: "オレンジ", category: "くだもの", modes: ["cake"] },
  { id: "star", name: "おほしさま", color: "きいろ", category: "かざり", modes: ["cake"] },
  { id: "heart", name: "ハート", color: "ピンク", category: "かざり", modes: ["cake"] },
];

export const BASES = {
  bento: [
    { id: "coral", name: "いちごいろ", color: "#e58a76" },
    { id: "mint", name: "はっぱいろ", color: "#8eb59b" },
    { id: "yellow", name: "おひさまいろ", color: "#eac06f" },
  ],
  cake: [
    { id: "vanilla", name: "バニラ", color: "#f5e6be" },
    { id: "berry", name: "いちご", color: "#ecc0c4" },
    { id: "chocolate", name: "チョコ", color: "#9c7260" },
  ],
};

export const MISSIONS: { id: MissionId; mode: KitchenMode; title: string; instruction: string; skill: string; target: number; icon: string }[] = [
  { id: "rainbow", mode: "bento", title: "いろいろ おべんとう", instruction: "ちがう いろの たべものを 3いろ いれよう！", skill: "いろ", target: 3, icon: "rainbow" },
  { id: "berries", mode: "cake", title: "いちごを かぞえよう", instruction: "いちごを ちょうど 3こ のせよう！", skill: "かず", target: 3, icon: "strawberry" },
  { id: "triangles", mode: "bento", title: "さんかく みつけた", instruction: "さんかくの おにぎりを ちょうど 2こ いれよう！", skill: "かたち", target: 2, icon: "rice" },
];

export function newRecipe(mode: KitchenMode, mission: MissionId | null = null): Recipe {
  return { mode, base: BASES[mode][0].id, items: [], mission };
}

export function getFood(id: FoodId): Ingredient {
  return INGREDIENTS.find((food) => food.id === id)!;
}

export function getColors(items: FoodPiece[]): FoodColor[] {
  return [...new Set(items.map((item) => getFood(item.food).color))];
}

export function missionProgress(recipe: Recipe): { value: number; target: number; complete: boolean; hint: string } | null {
  if (!recipe.mission) return null;
  const mission = MISSIONS.find((item) => item.id === recipe.mission)!;
  const value = recipe.mission === "rainbow" ? getColors(recipe.items).length : recipe.items.filter((item) => item.food === (recipe.mission === "berries" ? "strawberry" : "rice")).length;
  const complete = recipe.mission === "rainbow" ? value >= mission.target : value === mission.target;
  const hint = complete ? "できたね！ おだい クリア！" : value > mission.target ? `${value - mission.target}こ はずすと、ちょうど ${mission.target}こ！` : mission.instruction;
  return { value, target: mission.target, complete, hint };
}

// The whole ingredient stays inside the lunchbox or the elliptical cake top.
export function constrainPosition(mode: KitchenMode, x: number, y: number): { x: number; y: number } {
  if (mode === "bento") return { x: Math.max(24, Math.min(76, x)), y: Math.max(33, Math.min(65, y)) };
  const dx = (x - 50) / 25;
  const dy = (y - 43) / 18;
  const distance = Math.max(1, Math.hypot(dx, dy));
  return { x: 50 + dx / distance * 25, y: 43 + dy / distance * 18 };
}

export function nextPosition(mode: KitchenMode, index: number): { x: number; y: number } {
  const bento = [[31, 37], [52, 37], [72, 37], [31, 62], [52, 62], [72, 62], [40, 50], [62, 50], [23, 50]];
  const cake = [[50, 29], [67, 39], [61, 55], [39, 55], [33, 39], [50, 43], [50, 58], [27, 44], [73, 44]];
  const point = (mode === "bento" ? bento : cake)[index % 9];
  return constrainPosition(mode, point[0], point[1]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function parseRecipe(value: unknown): Recipe | null {
  if (!isRecord(value) || (value.mode !== "bento" && value.mode !== "cake") || !Array.isArray(value.items)) return null;
  const mode = value.mode;
  const base = BASES[mode].find((item) => item.id === value.base)?.id ?? BASES[mode][0].id;
  const ids = new Set<string>();
  const items: FoodPiece[] = [];
  for (const item of value.items.slice(0, MAX_PIECES)) {
    if (!isRecord(item) || typeof item.id !== "string" || ids.has(item.id) || typeof item.x !== "number" || typeof item.y !== "number" || !Number.isFinite(item.x) || !Number.isFinite(item.y)) continue;
    const food = INGREDIENTS.find((ingredient) => ingredient.id === item.food && ingredient.modes.includes(mode));
    if (!food) continue;
    ids.add(item.id);
    items.push({ id: item.id.slice(0, 100), food: food.id, ...constrainPosition(mode, item.x, item.y), rotation: typeof item.rotation === "number" && Number.isFinite(item.rotation) ? Math.max(-30, Math.min(30, item.rotation)) : 0 });
  }
  const mission = MISSIONS.find((item) => item.id === value.mission && item.mode === mode)?.id ?? null;
  return { mode, base, items, mission };
}

export function readSavedState(raw: string | null): SavedState {
  const fallback: SavedState = { version: 1, works: [], draft: null, settings: { ...DEFAULT_SETTINGS } };
  if (!raw) return fallback;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== 1) return fallback;
    if (isRecord(value.settings)) fallback.settings = { sound: value.settings.sound !== false, voice: value.settings.voice === true };
    fallback.draft = parseRecipe(value.draft);
    const ids = new Set<string>();
    if (Array.isArray(value.works)) for (const item of value.works.slice(0, MAX_WORKS)) {
      const recipe = parseRecipe(item);
      if (!recipe || !isRecord(item) || typeof item.id !== "string" || ids.has(item.id) || typeof item.title !== "string" || typeof item.createdAt !== "string" || Number.isNaN(Date.parse(item.createdAt))) continue;
      ids.add(item.id);
      fallback.works.push({ ...recipe, id: item.id, title: item.title.slice(0, 32), createdAt: item.createdAt, missionComplete: missionProgress(recipe)?.complete ?? false });
    }
    return fallback;
  } catch {
    return fallback;
  }
}

export const SAMPLE_BENTO: Recipe = { mode: "bento", base: "coral", mission: null, items: [
  { id: "a", food: "rice", x: 30, y: 41, rotation: -8 },
  { id: "b", food: "rice", x: 49, y: 43, rotation: 8 },
  { id: "c", food: "broccoli", x: 70, y: 38, rotation: 12 },
  { id: "d", food: "egg", x: 69, y: 59, rotation: -9 },
  { id: "e", food: "tomato", x: 46, y: 67, rotation: 0 },
  { id: "f", food: "carrot", x: 27, y: 66, rotation: 8 },
] };

export const SAMPLE_CAKE: Recipe = { mode: "cake", base: "vanilla", mission: null, items: [
  { id: "a", food: "strawberry", x: 35, y: 39, rotation: -13 },
  { id: "b", food: "strawberry", x: 65, y: 39, rotation: 13 },
  { id: "c", food: "strawberry", x: 50, y: 56, rotation: 0 },
  { id: "d", food: "cream", x: 50, y: 30, rotation: 0 },
  { id: "e", food: "cream", x: 32, y: 53, rotation: 0 },
  { id: "f", food: "cream", x: 68, y: 53, rotation: 0 },
] };

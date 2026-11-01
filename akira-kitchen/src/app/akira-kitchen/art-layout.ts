import geometry from "./media-geometry.json";
import type { Point, Recipe } from "./cooking-model";

export const mediaGeometry = geometry as Record<string, {
  src: string; width: number; height: number;
  x: number; y: number; paintWidth: number; paintHeight: number;
}>;
export type ArtBox = { x: number; y: number; width: number; height: number };
export const boxString = (b: ArtBox) => `${b.x} ${b.y} ${b.width} ${b.height}`;
export function croppedMediaBox(name: string): ArtBox {
  const a = mediaGeometry[name];
  return { x: a.x, y: a.y, width: a.paintWidth, height: a.paintHeight };
}
export function cakeAsset(recipe: Pick<Recipe, "cake">) {
  return recipe.cake === "chocolate" || recipe.cake === "strawberry"
    ? "cake-" + recipe.cake : "cake-base";
}
// A 2:1 presentation keeps the large box above the footer. The original model
// surface is still x=20..780 / y=15..485 in an 800x500 canvas.
const bentoHeight = 400;
/** Recipes retain their original 800 x 500 coordinate system. Only drawing changes. */
export function dishBox(recipe: Pick<Recipe, "mode" | "cake">): ArtBox {
  if (recipe.mode === "bento") return { x: 0, y: 0, width: 800, height: bentoHeight };
  const a = mediaGeometry[cakeAsset(recipe)];
  return { x: a.x * 800 / a.width, y: a.y * 500 / a.height,
    width: a.paintWidth * 800 / a.width, height: a.paintHeight * 500 / a.height };
}
export function dishPoint(recipe: Pick<Recipe, "mode">, p: Point): Point {
  return recipe.mode === "bento"
    ? { x: (p.x * 8 - 20) * 800 / 760, y: (p.y * 5 - 15) * bentoHeight / 470 }
    : { x: p.x * 8, y: p.y * 5 };
}
export function modelPoint(recipe: Pick<Recipe, "mode" | "cake">, percent: Point): Point {
  const b = dishBox(recipe), x = b.x + percent.x * b.width / 100, y = b.y + percent.y * b.height / 100;
  return recipe.mode === "bento"
    ? { x: (x * 760 / 800 + 20) / 8, y: (y * 470 / bentoHeight + 15) / 5 }
    : { x: x / 8, y: y / 5 };
}
export function pieceSize(mode: string) { return mode === "bento" ? 155 * 800 / 760 : 98; }
/** Same centers and square artwork sizes for HTML controls and exported SVG. */
export function pieceStyle(recipe: Pick<Recipe, "mode" | "cake">, point: Point) {
  const b = dishBox(recipe), p = dishPoint(recipe, point), size = pieceSize(recipe.mode);
  return { left: (p.x - b.x) * 100 / b.width + "%", top: (p.y - b.y) * 100 / b.height + "%",
    width: size * 100 / b.width + "%", height: size * 100 / b.height + "%" };
}
export function foodBox(food: string, variant = ""): ArtBox {
  const candidate = food === "onigiri" ? "rice-" + variant : food === "carrot" ? "carrot-" + variant : food;
  const a = mediaGeometry[candidate] ?? mediaGeometry[food];
  if (!a) return { x: 0, y: 0, width: 200, height: 200 };
  const scale = 200 / Math.max(a.width, a.height);
  return { x: (200-a.width*scale)/2+a.x*scale, y: (200-a.height*scale)/2+a.y*scale,
    width: a.paintWidth*scale, height: a.paintHeight*scale };
}

import { SHAPES } from "./prototype-shapes";
import { illustratedFood, illustratedBase, illustratedVariant, riceSmile } from "./illustration-assets";
import type { Food, Piece, Recipe, Point } from "./cooking-model";
const COLORS: Record<string, string> = {
  ume: "#ef6b89",
  wakame: "#278c51",
  salmon: "#ff8b52",
  yukari: "#913690",
  sesame: "#a48558",
  scallion: "#2b9956",
  spinach: "#247843",
  cheese: "#fff0a4",
  carrot: "#ff823c",
  salt: "#f3bf6b",
  curry: "#c99121",
  lemon: "#edb94b",
  garlic: "#da964e",
};
const dots = (color: string) =>
  Array.from(
    { length: 16 },
    (_, i) =>
      `<ellipse cx="${55 + ((i * 37) % 91)}" cy="${65 + ((i * 29) % 73)}" rx="3" ry="5" fill="${color}" transform="rotate(${i * 31} ${55 + ((i * 37) % 91)} ${65 + ((i * 29) % 73)})"/>`,
  ).join("");
export function foodMarkup(food: string, variant = "", smiling = true): string {
  const variantArt = illustratedVariant(food, variant);
  if (variantArt) return variantArt + (food === "onigiri" && smiling ? riceSmile() : "");
  const illustration = illustratedFood(food);
  if (
    illustration &&
    !(food === "carrot" && ["star", "heart"].includes(variant))
  ) {
    const garnish =
      ["onigiri", "tamago", "karaage"].includes(food) && COLORS[variant]
        ? dots(COLORS[variant])
        : "";
    return illustration + garnish;
  }
  let shape = SHAPES[food] ?? SHAPES.star;
  if (food === "onigiri")
    shape =
      shape.replace(
        "M88 127q5-6 10 0 M114 127q5-6 10 0",
        "M83 110q5-6 10 0 M115 110q5-6 10 0",
      ) +
      '<path d="M95 121q10 15 21 0" stroke="#24374c" stroke-width="5" fill="none" stroke-linecap="round"/>';
  if (food === "onigiri" && variant && variant !== "nori")
    shape =
      shape.replace(/<path d="M68 132H132V179Q100 187 68 177Z"[^>]*\/>/, "") +
      dots(COLORS[variant] ?? "#4a824d");
  if (food === "tamago" && variant !== "plain" && COLORS[variant])
    shape += dots(COLORS[variant]);
  if (food === "karaage" && COLORS[variant])
    shape = shape.replaceAll("#bf6928", COLORS[variant]);
  if (food === "carrot") {
    if (variant === "star")
      shape = SHAPES.star
        .replaceAll("#ffd33d", "#ff823c")
        .replaceAll("#f4ac28", "#ea6d21");
    else if (variant === "heart")
      shape = SHAPES.pinkHeart.replace("#fa6b95", "#ff823c");
    else if (variant === "flower")
      shape =
        '<g fill="#ff823c" stroke="#ef6c22" stroke-width="4">' +
        Array.from(
          { length: 6 },
          (_, i) =>
            `<circle cx="${100 + 45 * Math.cos((i * Math.PI) / 3)}" cy="${100 + 45 * Math.sin((i * Math.PI) / 3)}" r="34"/>`,
        ).join("") +
        '<circle cx="100" cy="100" r="30" fill="#ffa54a"/></g>';
  }
  return shape;
}
export function FoodArt({
  food,
  variant = "",
  className,
  smiling = true,
}: {
  food: string;
  variant?: string;
  className?: string;
  smiling?: boolean;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 200 200"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: foodMarkup(food, variant, smiling) }}
    />
  );
}
export function baseMarkup(recipe: Recipe): string {
  return illustratedBase(recipe.mode, recipe.cake);
}
function icingMarkup(strokes: Point[][]): string {
  return (
    '<defs><clipPath id="icing-surface"><ellipse cx="400" cy="155" rx="282" ry="97"/></clipPath></defs><g clip-path="url(#icing-surface)">' +
    strokes
      .map((s) =>
        s.length === 1
          ? `<circle cx="${s[0].x * 8}" cy="${s[0].y * 5}" r="32" fill="#fffefa"/>`
          : s.length
            ? `<path d="M${s.map((p) => `${p.x * 8} ${p.y * 5}`).join(" L")}" fill="none" stroke="#fffefa" stroke-width="64" stroke-linecap="round" stroke-linejoin="round"/>`
            : "",
      )
      .join("") +
    "</g>"
  );
}
export function pieceMarkup(piece: Piece, mode: string): string {
  const size = mode === "bento" ? 155 : 98;
  return `<g transform="translate(${piece.x * 8 - size / 2} ${piece.y * 5 - size / 2}) rotate(${piece.rotation} ${size / 2} ${size / 2}) scale(${size / 200})">${foodMarkup(piece.food, piece.variant)}</g>`;
}
export function dishInner(recipe: Recipe): string {
  return (
    baseMarkup(recipe) +
    icingMarkup(recipe.strokes) +
    recipe.items.map((p) => pieceMarkup(p, recipe.mode)).join("")
  );
}
export function dishSVG(recipe: Recipe): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="750" viewBox="0 0 800 500"><rect width="800" height="500" rx="40" fill="#fff9eb"/>${dishInner(recipe)}</svg>`;
}
export function DishArt({
  recipe,
  className,
  stretch = false,
}: {
  recipe: Recipe;
  className?: string;
  stretch?: boolean;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 800 500"
      preserveAspectRatio={stretch ? "none" : "xMidYMid meet"}
      role="img"
      aria-label={
        recipe.mode === "bento" ? "じぶんの おべんとう" : "じぶんの ケーキ"
      }
      dangerouslySetInnerHTML={{ __html: dishInner(recipe) }}
    />
  );
}
export function DishBase({ recipe }: { recipe: Recipe }) {
  return (
    <svg
      viewBox="0 0 800 500"
      aria-hidden="true"
      dangerouslySetInnerHTML={{
        __html: baseMarkup(recipe) + icingMarkup(recipe.strokes),
      }}
    />
  );
}
export function sampleRecipe(mode: "bento" | "cake", seed: Recipe): Recipe {
  const foods: Food[] =
    mode === "bento"
      ? [
          "onigiri",
          "onigiri",
          "tamago",
          "karaage",
          "broccoli",
          "tomato",
          "carrot",
        ]
      : ["strawberry", "strawberry", "strawberry", "blueberry", "cream"];
  const coords =
    mode === "bento"
      ? [
          [25, 35],
          [41, 58],
          [75, 29],
          [60, 52],
          [78, 59],
          [59, 31],
          [23, 64],
        ]
      : [
          [34, 29],
          [50, 21],
          [66, 29],
          [35, 44],
          [62, 43],
        ];
  return {
    ...seed,
    mode,
    strokes:
      mode === "cake"
        ? [14, 23, 32, 41, 48].map((y) => [
            { x: 16, y },
            { x: 84, y },
          ])
        : [],
    items: foods.map((food, i) => ({
      id: String(i),
      food,
      variant: food === "carrot" ? "flower" : "nori",
      rotation: 0,
      x: coords[i][0],
      y: coords[i][1],
    })),
  };
}

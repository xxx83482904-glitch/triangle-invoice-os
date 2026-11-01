"use client";
import { useRef, useState, type PointerEvent, type CSSProperties } from "react";
import {
  Hand,
  Undo2,
  ChevronRight,
  ChevronLeft,
  Check,
  RotateCw,
} from "lucide-react";
import { FoodArt, DishBase } from "./cooking-art";
import {
  addPiece,
  bound,
  label,
  movePiece,
  STAGES,
  type Food,
  type Point,
  type Process,
  type Recipe,
} from "./cooking-model";
import { ArtImage, mediaUrl } from "./media-assets";
import { creamCoverage, rotatePiece, type Voice } from "./cooking-guidance";
import type { Sound } from "./cooking-audio";
import s from "./kitchen.module.css";

export function Chef({
  celebrate = false,
  small = false,
  pose = "wave",
  reaction = "やったね！",
}: {
  celebrate?: boolean;
  small?: boolean;
  pose?: "wave" | "squeeze" | "taste";
  reaction?: string;
}) {
  const asset =
    pose === "squeeze"
      ? "chef-squeeze"
      : pose === "taste"
        ? "chef-taste"
        : celebrate
          ? "chef-celebrate"
          : small
            ? "chef-home"
            : "chef-ladle";
  return (
    <div
      className={`${s.chef} ${small ? s.smallChef : ""} ${celebrate ? s.happy : ""}`}
    >
      <ArtImage
        name={asset}
        alt="あきらくん"
        fetchPriority={small ? "high" : undefined}
        draggable={false}
        className={s.chefPicture}
      />
      {celebrate && <span className={s.chefReaction}>{reaction}</span>}
    </div>
  );
}
export function HandHint({
  motion = "circle",
}: {
  motion?: "circle" | "squeeze" | "drag";
}) {
  return (
    <div className={`${s.handHint} ${s[motion]}`} aria-hidden="true">
      <Hand fill="#fff9e8" stroke="#0d2867" strokeWidth={2.5} />
    </div>
  );
}

export function IngredientArt({
  ingredient,
}: {
  ingredient: "egg" | "flour" | "milk";
}) {
  return (
    <ArtImage
      className={s.ingredientArt}
      name={`ingredient-${ingredient}`}
      alt=""
      draggable={false}
    />
  );
}

export function RiceProgress({ value }: { value: number }) {
  return (
    <ol className={s.riceProgress} aria-label="おにぎりの つくりかた">
      {[
        ["round", "にぎる"],
        ["triangle", "さんかく"],
        ["nori", "できあがり"],
      ].map(([asset, title], i) => (
        <li
          key={asset}
          aria-current={
            Math.min(2, Math.floor(value)) === i ? "step" : undefined
          }
        >
          <b>{value > i ? <Check /> : i + 1}</b>
          <ArtImage name={`rice-${asset}`} alt="" draggable={false} />
          <span>{title}</span>
          {i < 2 && <ChevronRight className={s.riceStepArrow} />}
        </li>
      ))}
    </ol>
  );
}

export function processCue(process: Process, value: number) {
  const cues: Record<Process, string[]> = {
    rice: ["とってみよう", "ぎゅっ ぎゅっ！", "さんかくに！"],
    egg: ["ぱかっ！", "ぐるぐる！", "とろ〜り！", "くるっと！", "もういちど！"],
    chicken: ["まぜまぜ！", "ころころ！", "ぽん！", "こんがり！"],
    broccoli: ["ぽん！", "すくおう！"],
    carrot: ["えらぼう！", "ぽん！"],
    tomato: ["えらぼう！", "ぽん！"],
    batter: [
      "さらさら！",
      "ぱかっ！",
      "とろ〜り！",
      "ぐるぐる！",
      "なめらか！",
    ],
    bake: ["とろ〜り！", "いれよう！", "ふっくら！"],
    cream: ["ぬりぬり！"],
  };
  return cues[process][Math.min(cues[process].length - 1, Math.floor(value))];
}
export function ProgressDots({ value, max }: { value: number; max: number }) {
  return (
    <div
      className={s.progress}
      aria-label={`${max}つの うち ${Math.min(max, Math.floor(value))}つ できた`}
    >
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={i < value ? s.dotDone : ""} />
      ))}
    </div>
  );
}

const colorHex = (...channels: number[]) =>
  "#" +
  channels.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
function ProcessArt({
  process,
  value,
  recipe,
  angle,
}: {
  process: Process;
  value: number;
  recipe: Recipe;
  angle: number;
}) {
  const phase = Math.min(Math.floor(value), STAGES[process].length - 1),
    complete = value >= STAGES[process].length,
    f = complete ? 1 : value % 1;
  const batterColor =
    recipe.cake === "chocolate"
      ? "#97613e"
      : recipe.cake === "strawberry"
        ? "#efb6bd"
        : "#f8db95";
  const bakedColor =
    recipe.cake === "chocolate"
      ? "#805237"
      : recipe.cake === "strawberry"
        ? "#de9a9a"
        : "#e8b553";
  const middleColor =
    recipe.cake === "chocolate"
      ? "#8d5a3b"
      : recipe.cake === "strawberry"
        ? "#e8a5ae"
        : "#edc66b";
  const bowl = (fill: string) => (
    <>
      <ellipse cx="260" cy="266" rx="207" ry="70" fill="#b8e7f5" />
      <path d="M55 215Q68 358 260 363Q450 360 465 215" fill="#90d7ef" />
      <ellipse
        cx="260"
        cy="217"
        rx="205"
        ry="77"
        fill="#f6fdff"
        stroke="#91cadf"
        strokeWidth="12"
      />
      <ellipse cx="260" cy="219" rx="175" ry="55" fill={fill} />
    </>
  );
  const swirl = (
    <g transform={`rotate(${angle} 260 220)`}>
      <path
        d="M126 216Q228 154 355 215Q392 261 239 250Q171 229 267 211"
        stroke="#fff4b5"
        strokeWidth="15"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M307 78L253 227"
        stroke="#b98144"
        strokeWidth="17"
        strokeLinecap="round"
      />
    </g>
  );
  return (
    <svg viewBox="0 0 520 400" aria-hidden="true" className={s.processArt}>
      {process === "rice" &&
        (complete ? (
          <svg x="65" y="0" width="390" height="390">
            <FoodArt food="onigiri" variant={recipe.rice} />
          </svg>
        ) : (
          <>
            <ellipse cx="260" cy="340" rx="208" ry="38" fill="#d0effa" />
            {phase === 0 ? (
              <image href={mediaUrl("rice-tub")} width="520" height="350" />
            ) : (
              <g
                style={{
                  transformOrigin: "260px 220px",
                  transform: `scale(${1 - f * 0.11},${1 + f * 0.07})`,
                }}
              >
                <image
                  href={mediaUrl(phase === 1 ? "rice-round" : "rice-triangle")}
                  x="35"
                  y="0"
                  width="450"
                  height="365"
                />
              </g>
            )}
          </>
        ))}
      {process === "egg" &&
        (complete ? (
          <svg x="100" y="25" width="320" height="320">
            <FoodArt food="tamago" variant={recipe.egg} />
          </svg>
        ) : phase === 0 ? (
          <>
            {bowl("#fff4dd")}
            <g transform={`translate(${-f * 45} 0) rotate(${-f * 18} 250 140)`}>
              <path
                d="M260 40C164 25 151 193 259 190L242 162L263 141L241 115L260 89Z"
                fill="#fff2da"
                stroke="#d7aa70"
                strokeWidth="6"
              />
            </g>
            <g transform={`translate(${f * 45} 0)`}>
              <path
                d="M260 40C350 25 362 193 259 190L275 162L254 141L275 115L260 89Z"
                fill="#ffe4b9"
                stroke="#d7aa70"
                strokeWidth="6"
              />
            </g>
            <circle cx="260" cy={195 + f * 20} r={22 + f * 15} fill="#ffbc2e" />
          </>
        ) : phase === 1 ? (
          <>
            {bowl("#ffda38")}
            {swirl}
          </>
        ) : (
          <>
            <rect
              x="61"
              y="99"
              width="337"
              height="228"
              rx="40"
              fill="#354960"
              stroke="#21374f"
              strokeWidth="12"
            />
            <rect
              x="380"
              y="179"
              width="130"
              height="40"
              rx="18"
              fill="#2e425a"
            />
            <rect
              x="83"
              y="120"
              width="292"
              height="183"
              rx="25"
              fill="#ffda4b"
            />
            {phase === 2 ? (
              <path
                d={`M190 30Q210 130 240 ${155 + f * 70}`}
                fill="none"
                stroke="#ffe87c"
                strokeWidth={12 + f * 28}
                strokeLinecap="round"
              />
            ) : (
              <>
                <rect
                  x={phase === 3 ? 90 + f * 100 : 185 + f * 85}
                  y="132"
                  width={phase === 3 ? 60 + f * 45 : 105 + f * 35}
                  height="158"
                  rx="30"
                  fill="#efb02e"
                />
                <ellipse
                  cx={phase === 3 ? 120 + f * 100 : 220 + f * 85}
                  cy="208"
                  rx="22"
                  ry="62"
                  fill="#ffdf68"
                />
                <path
                  d={`M${phase === 3 ? 120 + f * 100 : 220 + f * 85} 169q-25 40 0 78q25-40 0-50`}
                  stroke="#cf8d28"
                  strokeWidth="8"
                  fill="none"
                />
              </>
            )}
          </>
        ))}
      {process === "chicken" &&
        (complete ? (
          <svg x="110" y="40" width="300" height="300">
            <FoodArt food="karaage" variant={recipe.chicken} />
          </svg>
        ) : (
          <>
            {bowl(phase > 1 ? "#ffe4ac" : "#fae5df")}
            {[0, 1, 2].map((i) => (
              <g
                key={i}
                transform={`translate(${95 + i * 115} ${phase === 2 ? 90 + f * 80 : 155})`}
              >
                <path
                  d={
                    phase === 0
                      ? "M0 20Q35-15 75 10L83 70Q40 92 0 65Z"
                      : "M0 35Q-5-2 45 0Q90 3 85 45Q90 85 42 85Q-5 82 0 35"
                  }
                  fill={
                    phase === 3
                      ? ["#f0d09c", "#dc9d52", "#b96e2f"][
                          Math.min(2, Math.floor(f * 3))
                        ]
                      : phase === 1
                        ? "#e9c29e"
                        : "#eeac9b"
                  }
                  stroke="#cd8b66"
                  strokeWidth="5"
                />
              </g>
            ))}
            {phase === 0 && swirl}
            {phase === 3 &&
              [0, 1, 2, 3, 4].map((i) => (
                <circle
                  key={i}
                  cx={100 + i * 75}
                  cy={210 - Math.sin(angle / 20 + i) * 14}
                  r="8"
                  fill="#fff8d6"
                />
              ))}
          </>
        ))}
      {["broccoli", "carrot", "tomato"].includes(process) && (
        <>
          {process === "broccoli" ? (
            <>
              <rect
                x="60"
                y="170"
                width="400"
                height="170"
                rx="70"
                fill="#8bd5ee"
              />
              <ellipse
                cx="260"
                cy="180"
                rx="200"
                ry="65"
                fill="#d7f6ff"
                stroke="#78bed9"
                strokeWidth="10"
              />
            </>
          ) : (
            <ellipse cx="260" cy="320" rx="215" ry="48" fill="#d5eff9" />
          )}
          <svg
            x="145"
            y={process === "broccoli" && !complete ? 30 + f * 85 : 50}
            width="230"
            height="230"
          >
            <FoodArt
              food={process}
              variant={process === "carrot" ? recipe.carrotShape : ""}
            />
          </svg>
          {complete && (
            <text x="430" y="90" fill="#32b66c" fontSize="70">
              ✓
            </text>
          )}
        </>
      )}
      {process === "batter" && (
        <>
          {bowl(
            value < 1
              ? "#fff9ed"
              : value < 3
                ? "#ffe3a3"
                : recipe.cake !== "vanilla"
                  ? batterColor
                  : colorHex(
                      248,
                      218 + Math.min(25, (value - 3) * 12),
                      155 + Math.min(30, (value - 3) * 15),
                    ),
          )}
          {phase < 3 ? (
            <>
              <path
                d={`M260 25V${120 + f * 100}`}
                stroke={phase === 0 ? "#ffbd2c" : "#fff8e7"}
                strokeWidth="45"
                strokeLinecap="round"
              />
              <image
                href={mediaUrl(`ingredient-${["flour", "egg", "milk"][phase]}`)}
                x="192"
                y="0"
                width="136"
                height="125"
              />
            </>
          ) : (
            swirl
          )}
        </>
      )}
      {process === "bake" && (
        <>
          {phase === 0 ? (
            <>
              <rect
                x="95"
                y="180"
                width="330"
                height="130"
                rx="35"
                fill="#97c9e0"
              />
              <ellipse cx="260" cy="180" rx="165" ry="50" fill={batterColor} />
              <path
                d={`M260 30V${100 + f * 110}`}
                stroke={batterColor}
                strokeWidth="40"
                strokeLinecap="round"
              />
            </>
          ) : (
            <>
              <rect
                x="42"
                y="30"
                width="436"
                height="330"
                rx="35"
                fill="#ccecf6"
                stroke="#76b9d4"
                strokeWidth="13"
              />
              <rect
                x="70"
                y="110"
                width="380"
                height="215"
                rx="22"
                fill="#51657e"
              />
              <rect
                x="90"
                y="130"
                width="340"
                height="175"
                rx="16"
                fill="#fff0cb"
              />
              <circle cx="110" cy="72" r="17" fill="#ff823c" />
              <circle cx="163" cy="72" r="17" fill="#f65182" />
              <rect
                x="290"
                y="58"
                width="110"
                height="24"
                rx="12"
                fill="white"
              />
              <path
                d={`M130 270V${phase === 1 ? 245 : 240 - f * 65}Q260 ${phase === 1 ? 215 : 195 - f * 80} 390 ${phase === 1 ? 245 : 240 - f * 65}V270Z`}
                fill={
                  complete
                    ? bakedColor
                    : phase === 2
                      ? [batterColor, middleColor, bakedColor][
                          Math.min(2, Math.floor(f * 3))
                        ]
                      : batterColor
                }
                stroke={bakedColor}
                strokeWidth="7"
              />
            </>
          )}
        </>
      )}
    </svg>
  );
}

export function CookingGesture({
  process,
  recipe,
  onProgress,
  play,
}: {
  process: Process;
  recipe: Recipe;
  onProgress: (p: Process, n: number) => void;
  play: (s: Sound) => void;
}) {
  const [angle, setAngle] = useState(0),
    [active, setActive] = useState(false);
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    phase: number;
    travel: number;
  } | null>(null);
  const lastSound = useRef(0);
  const value = recipe.progress[process],
    max = STAGES[process].length,
    complete = value >= max;
  const sound: Sound =
    process === "rice"
      ? "squeeze"
      : process === "egg"
        ? value < 1
          ? "crack"
          : value < 2
            ? "mix"
            : value < 3
              ? "pour"
              : "roll"
        : process === "batter"
          ? "mix"
          : process === "bake"
            ? "bake"
            : process === "chicken"
              ? "roll"
              : "pop";
  const act = (amount: number) => {
    if (complete) {
      play("pop");
      return;
    }
    if (!complete) {
      onProgress(process, amount);
      if (Date.now() - lastSound.current > 150) {
        play(sound);
        lastSound.current = Date.now();
      }
    }
  };
  const move = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (process === "rice" || (process === "egg" && value < 1)) return;
    if (!d || d.id !== e.pointerId || Math.floor(value) > d.phase) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const dist =
      (Math.hypot(e.clientX - d.x, e.clientY - d.y) * 520) /
      Math.max(1, rect.width);
    d.x = e.clientX;
    d.y = e.clientY;
    d.travel += dist;
    setAngle((a) => a + dist * 0.8);
    act(Math.min(0.2, dist / 360));
  };
  return (
    <button
      type="button"
      className={`${s.gestureArea} ${active ? s.pressed : ""}`}
      aria-label={complete ? "できた！" : STAGES[process][Math.floor(value)]}
      data-process={process}
      data-progress={value}
      onPointerDown={(e) => {
        if (drag.current || e.button > 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        drag.current = {
          id: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          phase: Math.floor(value),
          travel: 0,
        };
        setActive(true);
      }}
      onPointerMove={move}
      onPointerUp={(e) => {
        if (drag.current?.id !== e.pointerId) return;
        if (drag.current.travel < 12)
          act(
            process === "batter" && value < 3
              ? 1
              : process === "rice"
                ? 0.5
                : process === "bake" && value >= 2
                  ? 0.34
                  : 0.5,
          );
        drag.current = null;
        setActive(false);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setActive(false);
      }}
      onClick={(e) => {
        if (e.detail === 0) {
          if (complete) play("finish");
          else act(process === "batter" && value < 3 ? 1 : 0.5);
        }
      }}
    >
      <ProcessArt
        process={process}
        recipe={recipe}
        value={value}
        angle={angle}
      />
      {!complete && !active && (
        <HandHint
          motion={
            process === "rice"
              ? "squeeze"
              : (process === "bake" && value < 2) ||
                  (process === "egg" && value >= 2) ||
                  (process === "chicken" && value >= 2) ||
                  process === "broccoli" ||
                  process === "tomato"
                ? "drag"
                : "circle"
          }
        />
      )}
      <span className={s.gestureCaption}>
        {complete ? "できた！" : STAGES[process][Math.floor(value)]}
      </span>
    </button>
  );
}

type Drag = {
  pointer: number;
  piece?: string;
  food: Food;
  point: Point;
  start: Point;
  travel: number;
};
export function Arrangement({
  recipe,
  onChange,
  play,
  foods,
  paint = false,
  onFeedback,
}: {
  recipe: Recipe;
  onChange: (r: Recipe, record?: boolean) => void;
  play: (s: Sound) => void;
  foods: Food[];
  paint?: boolean;
  onFeedback?: (voice: Voice) => void;
}) {
  const board = useRef<HTMLDivElement>(null),
    shelf = useRef<HTMLDivElement>(null),
    drag = useRef<Drag | null>(null);
  const stroke = useRef<Point[] | null>(null),
    strokePointer = useRef<number | null>(null),
    lastTap = useRef({ id: "", time: 0 });
  const [liveStroke, setLiveStroke] = useState<Point[]>([]),
    [ghost, setGhost] = useState<{
      food: Food;
      point: Point;
      piece?: string;
    } | null>(null);
  const [selected, setSelected] = useState<string | null>(null),
    [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(foods.length / 3)),
    safePage = Math.min(page, pageCount - 1);
  const point = (e: { clientX: number; clientY: number }): Point => {
    const r = board.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * 100,
      y: ((e.clientY - r.top) / r.height) * 100,
    };
  };
  const variant = (food: Food) =>
    food === "onigiri"
      ? recipe.rice
      : food === "tamago"
        ? recipe.egg
        : food === "karaage"
          ? recipe.chicken
          : food === "carrot"
            ? recipe.carrotShape
            : "";
  const remove = (id: string) => {
    onChange({ ...recipe, items: recipe.items.filter((p) => p.id !== id) });
    setSelected(null);
    play("pop");
    onFeedback?.("removed");
  };
  const turn = (id: string) => {
    onChange(rotatePiece(recipe, id));
    play("pop");
    onFeedback?.("turn-food");
  };
  const begin = (
    e: PointerEvent<HTMLButtonElement>,
    food: Food,
    piece?: string,
  ) => {
    if (paint || drag.current || e.button > 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = {
      pointer: e.pointerId,
      food,
      piece,
      point: point(e),
      start: { x: e.clientX, y: e.clientY },
      travel: 0,
    };
    if (piece) setSelected(piece);
  };
  const move = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    d.point = point(e);
    d.travel = Math.hypot(e.clientX - d.start.x, e.clientY - d.start.y);
    setGhost({ food: d.food, point: d.point, piece: d.piece });
  };
  const end = (e: PointerEvent<HTMLButtonElement>, cancel = false) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    drag.current = null;
    setGhost(null);
    if (cancel) return;
    if (d.piece) {
      const r = shelf.current?.getBoundingClientRect();
      if (
        d.travel > 8 &&
        r &&
        e.clientX >= r.left &&
        e.clientX <= r.right &&
        e.clientY >= r.top &&
        e.clientY <= r.bottom
      ) {
        remove(d.piece);
        return;
      }
      if (d.travel > 8) onChange(movePiece(recipe, d.piece, d.point));
      else {
        if (
          lastTap.current.id === d.piece &&
          Date.now() - lastTap.current.time < 450
        ) {
          turn(d.piece);
          lastTap.current = { id: "", time: 0 };
          return;
        }
        lastTap.current = { id: d.piece, time: Date.now() };
        onFeedback?.("tap-here");
      }
    } else
      onChange(addPiece(recipe, d.food, d.travel < 8 ? undefined : d.point));
    play("pop");
  };
  const props = (food: Food, piece?: string) => ({
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) =>
      begin(e, food, piece),
    onPointerMove: move,
    onPointerUp: (e: PointerEvent<HTMLButtonElement>) => end(e),
    onPointerCancel: (e: PointerEvent<HTMLButtonElement>) => end(e, true),
    onClick: (e: React.MouseEvent<HTMLButtonElement>) => {
      if (e.detail === 0) {
        if (piece) {
          setSelected(piece);
          play("pop");
        } else {
          onChange(addPiece(recipe, food));
          play("pop");
        }
      }
    },
  });
  return (
    <>
      <div className={s.boardWrap}>
        <div
          className={[s.board, paint ? s.paintBoard : ""].join(" ")}
          ref={board}
          data-board
          aria-label={
            recipe.mode === "bento" ? "おべんとうばこ" : "ケーキの かざりだい"
          }
          onPointerDown={(e) => {
            if (!paint || strokePointer.current !== null || e.button > 0)
              return;
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            stroke.current = [bound("cake", point(e))];
            strokePointer.current = e.pointerId;
            setLiveStroke([...stroke.current]);
          }}
          onPointerMove={(e) => {
            if (
              stroke.current &&
              strokePointer.current === e.pointerId &&
              stroke.current.length < 150
            ) {
              stroke.current.push(bound("cake", point(e)));
              setLiveStroke([...stroke.current]);
            }
          }}
          onPointerUp={(e) => {
            if (stroke.current && strokePointer.current === e.pointerId) {
              const strokes = [...recipe.strokes.slice(0, 79), stroke.current];
              onChange({
                ...recipe,
                strokes,
                progress: {
                  ...recipe.progress,
                  cream: Math.min(1, creamCoverage(strokes) / 0.6),
                },
              });
              stroke.current = null;
              strokePointer.current = null;
              setLiveStroke([]);
              play("pour");
              onFeedback?.("praise-2");
            }
          }}
          onPointerCancel={() => {
            stroke.current = null;
            strokePointer.current = null;
            setLiveStroke([]);
          }}
        >
          <DishBase
            recipe={
              liveStroke.length
                ? { ...recipe, strokes: [...recipe.strokes, liveStroke] }
                : recipe
            }
          />
          {recipe.items.map((p) => (
            <button
              key={p.id}
              type="button"
              data-piece={p.id}
              className={[
                s.piece,
                recipe.mode === "cake" ? s.topping : "",
                selected === p.id ? s.selectedPiece : "",
              ].join(" ")}
              style={
                {
                  left: p.x + "%",
                  top: p.y + "%",
                  opacity: ghost?.piece === p.id ? 0.3 : 1,
                  "--turn": p.rotation + "deg",
                } as CSSProperties
              }
              aria-label={label(p.food) + "を うごかす"}
              {...props(p.food, p.id)}
              onKeyDown={(e) => {
                if (e.key === "Delete" || e.key === "Backspace") {
                  e.preventDefault();
                  remove(p.id);
                } else if (e.key.toLowerCase() === "r") {
                  turn(p.id);
                } else if (e.key.startsWith("Arrow")) {
                  e.preventDefault();
                  onChange(
                    movePiece(
                      recipe,
                      p.id,
                      {
                        x:
                          p.x +
                          (e.key === "ArrowRight"
                            ? 4
                            : e.key === "ArrowLeft"
                              ? -4
                              : 0),
                        y:
                          p.y +
                          (e.key === "ArrowDown"
                            ? 4
                            : e.key === "ArrowUp"
                              ? -4
                              : 0),
                      },
                      false,
                    ),
                  );
                  play("pop");
                }
              }}
            >
              <FoodArt food={p.food} variant={p.variant} />
            </button>
          ))}
          {ghost && (
            <div
              className={[
                s.piece,
                s.ghost,
                recipe.mode === "cake" ? s.topping : "",
              ].join(" ")}
              style={{ left: ghost.point.x + "%", top: ghost.point.y + "%" }}
            >
              <FoodArt food={ghost.food} variant={variant(ghost.food)} />
            </div>
          )}
          <HandHint motion={paint ? "circle" : "drag"} />
        </div>
        {paint && (
          <div
            className={s.coverage}
            role="progressbar"
            aria-valuenow={Math.round(recipe.progress.cream * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span style={{ width: recipe.progress.cream * 100 + "%" }} />
          </div>
        )}
        {!paint && selected && (
          <div className={s.boardTools}>
            <button
              className={s.smallButton}
              onClick={() => turn(selected)}
              aria-label="90ど まわす"
            >
              <RotateCw />
            </button>
            <button
              className={s.smallButton}
              onClick={() => remove(selected)}
              aria-label="はずす"
            >
              <Undo2 />
            </button>
          </div>
        )}
      </div>
      {!paint && (
        <div className={s.shelf} ref={shelf} aria-label="おかずだな" data-shelf>
          {foods.slice(safePage * 3, safePage * 3 + 3).map((food) => (
            <button
              key={food}
              type="button"
              className={s.shelfTile}
              data-food-drag={food}
              aria-label={label(food) + "を のせる"}
              {...props(food)}
            >
              <FoodArt food={food} variant={variant(food)} />
              <span>{label(food)}</span>
              <b className={s.countBadge}>
                {recipe.items.filter((p) => p.food === food).length}こ
              </b>
            </button>
          ))}
          {pageCount > 1 && (
            <div className={s.shelfPages}>
              <button
                aria-label="まえの おかず"
                onClick={() => {
                  setPage((safePage + pageCount - 1) % pageCount);
                  play("tap");
                  onFeedback?.(
                    recipe.mode === "cake" ? "next-topping" : "next-food",
                  );
                }}
              >
                <ChevronLeft />
              </button>
              <button
                aria-label="つぎの おかず"
                onClick={() => {
                  setPage((safePage + 1) % pageCount);
                  play("tap");
                  onFeedback?.(
                    recipe.mode === "cake" ? "next-topping" : "next-food",
                  );
                }}
              >
                <ChevronRight />
              </button>
              <span>
                {safePage + 1} / {pageCount}
              </span>
            </div>
          )}
        </div>
      )}
    </>
  );
}

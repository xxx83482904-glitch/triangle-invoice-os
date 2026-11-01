"use client";
import { useRef, useState, type PointerEvent, type CSSProperties } from "react";
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
import type { Sound } from "./cooking-audio";
import s from "./kitchen.module.css";

export function Chef({
  celebrate = false,
  small = false,
}: {
  celebrate?: boolean;
  small?: boolean;
}) {
  return (
    <div
      className={`${s.chef} ${small ? s.smallChef : ""} ${celebrate ? s.happy : ""}`}
    >
      <svg
        viewBox="0 0 1183 1330"
        role="img"
        aria-label="あきらくん"
        className={s.chefPicture}
      >
        <image
          href="/akira-kitchen/illustration-chef.png"
          width="1183"
          height="1330"
        />
      </svg>
      {celebrate && <span className={s.chefReaction}>おいしい！</span>}
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
      <svg viewBox="0 0 100 110">
        <path
          d="M37 60V18C37 7 53 7 53 18V48C58 38 69 40 69 51C79 43 90 51 85 63L75 91Q65 110 43 96L19 70C9 58 19 48 29 56L37 64"
          fill="#fff9e8"
          stroke="#0d2867"
          strokeWidth="5"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
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
          <svg x="125" y="25" width="270" height="300">
            <FoodArt food="onigiri" variant={recipe.rice} />
          </svg>
        ) : (
          <>
            <ellipse cx="260" cy="340" rx="208" ry="38" fill="#d0effa" />
            {phase === 0 ? (
              <>
                <path d="M75 202H445L418 320Q260 376 102 320Z" fill="#d5a36b" />
                <ellipse cx="260" cy="200" rx="185" ry="68" fill="#fff9ee" />
                {Array.from({ length: 22 }, (_, i) => (
                  <ellipse
                    key={i}
                    cx={125 + ((i * 43) % 270)}
                    cy={177 + ((i * 19) % 53)}
                    rx="12"
                    ry="5"
                    fill="white"
                    transform={`rotate(${i * 20} ${125 + ((i * 43) % 270)} ${177 + ((i * 19) % 53)})`}
                  />
                ))}
              </>
            ) : (
              <g
                style={{
                  transformOrigin: "260px 220px",
                  transform: `scale(${1 - f * 0.11},${1 + f * 0.07})`,
                }}
              >
                <path
                  d={
                    phase === 1
                      ? "M260 83C430 80 445 320 263 326C60 320 80 80 260 83"
                      : "M260 48C235 43 94 264 120 305C140 350 399 350 414 305C436 258 290 45 260 48"
                  }
                  fill="white"
                  stroke="#e8e7df"
                  strokeWidth="8"
                />
                <path
                  d="M226 257Q236 247 246 257M280 257Q290 247 300 257"
                  fill="none"
                  stroke="#0d2867"
                  strokeWidth="7"
                  strokeLinecap="round"
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
                      ? colorHex(230 - f * 45, 164 - f * 45, 90 - f * 42)
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
              <text
                x="260"
                y="65"
                textAnchor="middle"
                fontSize="55"
                fill="#0d2867"
              >
                {["🥚", "🥣", "🥛"][phase]}
              </text>
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
              <ellipse cx="260" cy="180" rx="165" ry="50" fill="#f8db95" />
              <path
                d={`M260 30V${100 + f * 110}`}
                stroke="#f5d58c"
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
                fill={complete ? "#e8b553" : "#f6cc76"}
                stroke="#dba34b"
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
        if (drag.current.travel < 12) act(0.5);
        drag.current = null;
        setActive(false);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setActive(false);
      }}
      onClick={(e) => {
        if (e.detail === 0) act(0.5);
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
              : process === "bake"
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
  food?: Food;
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
  onPaintChange,
}: {
  recipe: Recipe;
  onChange: (r: Recipe, history?: boolean) => void;
  play: (s: Sound) => void;
  foods: Food[];
  paint?: boolean;
  onPaintChange?: (v: boolean) => void;
}) {
  const board = useRef<HTMLDivElement>(null),
    drag = useRef<Drag | null>(null),
    stroke = useRef<Point[] | null>(null),
    strokePointer = useRef<number | null>(null),
    [liveStroke, setLiveStroke] = useState<Point[]>([]),
    [ghost, setGhost] = useState<{
      food: Food;
      point: Point;
      piece?: string;
    } | null>(null),
    [selected, setSelected] = useState<string | null>(null);
  const point = (e: { clientX: number; clientY: number }): Point => {
    const r = board.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / Math.max(1, r.width)) * 100,
      y: ((e.clientY - r.top) / Math.max(1, r.height)) * 100,
    };
  };
  const begin = (
    e: PointerEvent<HTMLButtonElement>,
    food: Food,
    piece?: string,
  ) => {
    if (drag.current || e.button > 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const p = point(e);
    drag.current = {
      pointer: e.pointerId,
      food,
      piece,
      point: p,
      start: { x: e.clientX, y: e.clientY },
      travel: 0,
    };
    if (piece) setSelected(piece);
    else setGhost({ food, point: bound(recipe.mode, p) });
    onPaintChange?.(false);
  };
  const move = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    d.point = point(e);
    d.travel = Math.hypot(e.clientX - d.start.x, e.clientY - d.start.y);
    setGhost({
      food: d.food!,
      point: bound(recipe.mode, d.point),
      piece: d.piece,
    });
  };
  const end = (e: PointerEvent<HTMLButtonElement>, cancel = false) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    drag.current = null;
    setGhost(null);
    if (cancel) return;
    const p = d.travel < 8 ? undefined : d.point;
    if (d.piece) {
      if (p) onChange(movePiece(recipe, d.piece, p));
    } else {
      onChange(addPiece(recipe, d.food!, p));
    }
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
        if (piece) setSelected(piece);
        else {
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
          className={`${s.board} ${paint ? s.paintBoard : ""}`}
          ref={board}
          aria-label={
            recipe.mode === "bento" ? "おべんとうばこ" : "ケーキの かざりだい"
          }
          onPointerDown={(e) => {
            if (
              !paint ||
              strokePointer.current !== null ||
              e.button > 0 ||
              (e.target !== e.currentTarget &&
                !(e.target instanceof SVGElement))
            )
              return;
            e.preventDefault();
            e.currentTarget.setPointerCapture?.(e.pointerId);
            stroke.current = [bound("cake", point(e))];
            strokePointer.current = e.pointerId;
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
              onChange({
                ...recipe,
                strokes: [...recipe.strokes.slice(0, 79), stroke.current],
                progress: { ...recipe.progress, cream: 1 },
              });
              stroke.current = null;
              strokePointer.current = null;
              setLiveStroke([]);
              play("pour");
            }
          }}
          onPointerCancel={(e) => {
            if (strokePointer.current !== e.pointerId) return;
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
              className={`${s.piece} ${recipe.mode === "cake" ? s.topping : ""} ${selected === p.id ? s.selectedPiece : ""}`}
              style={
                {
                  left: `${p.x}%`,
                  top: `${p.y}%`,
                  opacity: ghost?.piece === p.id ? 0.3 : 1,
                  "--turn": `${p.rotation}deg`,
                } as CSSProperties
              }
              aria-label={`${label(p.food)}を うごかす`}
              {...props(p.food, p.id)}
              onKeyDown={(e) => {
                if (e.key === "Delete" || e.key === "Backspace") {
                  e.preventDefault();
                  onChange({
                    ...recipe,
                    items: recipe.items.filter((q) => q.id !== p.id),
                  });
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
                }
              }}
            >
              <FoodArt food={p.food} variant={p.variant} />
            </button>
          ))}
          {ghost && (
            <div
              className={`${s.piece} ${s.ghost} ${recipe.mode === "cake" ? s.topping : ""}`}
              style={{ left: `${ghost.point.x}%`, top: `${ghost.point.y}%` }}
            >
              <FoodArt
                food={ghost.food}
                variant={
                  ghost.food === "onigiri"
                    ? recipe.rice
                    : ghost.food === "carrot"
                      ? recipe.carrotShape
                      : ""
                }
              />
            </div>
          )}
          {!recipe.items.length && !paint && <HandHint motion="drag" />}
        </div>
        <div className={s.boardTools}>
          {onPaintChange && (
            <button
              type="button"
              aria-pressed={paint}
              onClick={() => onPaintChange(!paint)}
              className={s.smallButton}
            >
              🖌 クリーム
            </button>
          )}
          {selected && (
            <button
              type="button"
              onClick={() => {
                onChange({
                  ...recipe,
                  items: recipe.items.filter((p) => p.id !== selected),
                });
                setSelected(null);
                play("pop");
              }}
              className={s.smallButton}
            >
              ↩ はずす
            </button>
          )}
        </div>
      </div>
      <div className={s.foodRow}>
        {foods.map((food) => (
          <button
            key={food}
            type="button"
            className={s.foodTile}
            aria-label={`${label(food)}を のせる`}
            {...props(food)}
          >
            <FoodArt
              food={food}
              variant={
                food === "onigiri"
                  ? recipe.rice
                  : food === "tamago"
                    ? recipe.egg
                    : food === "karaage"
                      ? recipe.chicken
                      : food === "carrot"
                        ? recipe.carrotShape
                        : ""
              }
            />
            <span>{label(food)}</span>
          </button>
        ))}
      </div>
    </>
  );
}

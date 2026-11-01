"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Album,
  ArrowLeft,
  ArrowRight,
  Check,
  Home,
  Settings as SettingsIcon,
  Volume2,
  VolumeX,
  RotateCcw,
  X,
  Trash2,
  Plus,
} from "lucide-react";
import {
  Arrangement,
  Chef,
  CookingGesture,
  ProgressDots,
  processCue,
  IngredientArt,
  RiceProgress,
} from "./cooking-controls";
import { DishArt, FoodArt, sampleRecipe } from "./cooking-art";
import {
  BACK,
  BENTO,
  CHICKEN,
  DEFAULT_SETTINGS,
  EGGS,
  MAX_PIECES,
  NEXT,
  RICE,
  STAGES,
  TITLES,
  TOPPINGS,
  id,
  label,
  newRecipe,
  progress,
  screenFrom,
  type Artwork,
  type Food,
  type Mode,
  type Process,
  type Recipe,
  type Screen,
  type Settings,
} from "./cooking-model";
import {
  deleteArtwork,
  listArtworks,
  migrateLegacy,
  putArtwork,
  readSession,
  saveArtwork,
  saveSession,
} from "./cooking-storage";
import { KitchenAudio, type Sound } from "./cooking-audio";
import s from "./kitchen.module.css";
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const STANDALONE = process.env.NEXT_PUBLIC_AKIRA_STANDALONE === "1";
const START_RECIPE: Recipe = {
  id: "initial",
  mode: "bento",
  rice: "nori",
  egg: "plain",
  chicken: "soy",
  vegetables: [],
  carrotShape: "flower",
  cake: "vanilla",
  toppings: ["strawberry", "cream"],
  items: [],
  strokes: [],
  ready: [],
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
};
const PROCESS_SCREEN: Partial<Record<Screen, Process>> = {
  3: "rice",
  4: "egg",
  5: "chicken",
  12: "batter",
  13: "bake",
};
const CARROT_SHAPES = [
  ["flower", "おはなの にんじん"],
  ["star", "ほしの にんじん"],
  ["heart", "ハートの にんじん"],
];
const COOK_SCREEN: Record<string, Screen> = {
  onigiri: 3,
  tamago: 4,
  karaage: 5,
  broccoli: 6,
  tomato: 6,
  carrot: 6,
};
function recipeForScreen(screen: Screen, recipe: Recipe): Recipe {
  const mode =
    screen >= 11 && screen <= 15
      ? "cake"
      : screen >= 2 && screen <= 10
        ? "bento"
        : recipe.mode;
  return recipe.mode === mode ? recipe : newRecipe(mode);
}
function Action({
  children,
  onClick,
  color = "pink",
  disabled = false,
  className = "",
}: {
  children: ReactNode;
  onClick: () => void;
  color?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`${s.action} ${s[color]} ${className}`}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
function Confetti() {
  return (
    <div className={s.confetti} aria-hidden="true">
      {Array.from({ length: 24 }, (_, i) => (
        <i
          key={i}
          style={{
            left: `${4 + i * 4}%`,
            background: ["#ffca33", "#159de9", "#f65182", "#32b66c", "#ff823c"][
              i % 5
            ],
            animationDelay: `${(i % 6) * 0.08}s`,
            transform: `rotate(${i * 23}deg)`,
          }}
        />
      ))}
    </div>
  );
}
function WorkImage({ work }: { work: Artwork }) {
  const img = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const next = URL.createObjectURL(work.image);
    if (img.current) img.current.src = next;
    return () => URL.revokeObjectURL(next);
  }, [work.image]);
  // Local IndexedDB Blob URLs must remain local and need no image optimization service.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={img}
      alt={
        work.recipe.mode === "bento" ? "つくった おべんとう" : "つくった ケーキ"
      }
      draggable={false}
    />
  );
}
export function AkiraKitchen() {
  const [screen, setScreen] = useState<Screen>(1),
    [recipe, setRecipe] = useState<Recipe>(START_RECIPE),
    [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS),
    [ready, setReady] = useState(false);
  const [works, setWorks] = useState<Artwork[]>([]),
    [albumError, setAlbumError] = useState(""),
    [notice, setNotice] = useState(""),
    [saving, setSaving] = useState(false),
    [savedId, setSavedId] = useState("");
  const [vegetable, setVegetable] = useState<Process>("broccoli"),
    [paint, setPaint] = useState(false),
    [eaten, setEaten] = useState<string[]>([]),
    [detail, setDetail] = useState<Artwork | null>(null),
    [deleted, setDeleted] = useState<Artwork | null>(null),
    [offline, setOffline] = useState(
      "オフライン起動は HTTPSの公開版で確認できます",
    );
  const viewport = useRef<HTMLDivElement>(null),
    audio = useRef<KitchenAudio | null>(null),
    saveLock = useRef(false),
    history = useRef<Recipe[]>([]),
    dialog = useRef<HTMLDialogElement>(null),
    current = useRef({ recipe, screen, settings }),
    [scale, setScale] = useState(1),
    [canUndo, setCanUndo] = useState(false);
  // Some touch browsers suppress the compatibility click following a captured
  // cooking gesture. Commit ordinary button taps on pointer-up, and ignore only
  // the duplicate compatibility click. Cooking/drag buttons own their pointers.
  const touchButton = useRef<{ element: HTMLButtonElement; pointer: number; x: number; y: number } | null>(null);
  const ignoreTouchClickUntil = useRef(0);
  useEffect(() => {
    current.current = { recipe, screen, settings };
  }, [recipe, screen, settings]);
  const play = useCallback((sound: Sound) => audio.current?.play(sound), []);
  const go = useCallback(
    (next: Screen) => {
      setScreen(next);
      setNotice("");
      setPaint(false);
      play("tap");
      window.history.replaceState({}, "", `#screen=${next}`);
    },
    [play],
  );
  const refreshAlbum = useCallback(async () => {
    try {
      await migrateLegacy();
      setWorks(await listArtworks());
      setAlbumError("");
    } catch {
      setAlbumError("アルバムを ひらけません。もういちど ためしてね。");
    }
  }, []);
  useEffect(() => {
    const hydration = window.setTimeout(() => {
      const stored = readSession(),
        hash = window.location.hash.match(/screen=(\d+)/);
      if (stored) {
        setRecipe(
          recipeForScreen(
            hash ? screenFrom(Number(hash[1])) : stored.screen,
            stored.recipe,
          ),
        );
        setSettings(stored.settings);
        setScreen(hash ? screenFrom(Number(hash[1])) : stored.screen);
      } else {
        setRecipe(
          recipeForScreen(
            hash ? screenFrom(Number(hash[1])) : 1,
            newRecipe("bento"),
          ),
        );
        if (hash) setScreen(screenFrom(Number(hash[1])));
      }
      setReady(true);
      void refreshAlbum();
    }, 0);
    const engine = new KitchenAudio();
    audio.current = engine;
    const visibility = () => {
      if (document.hidden) {
        engine.suspend();
        saveSession({ version: 2, ...current.current });
      }
    };
    document.addEventListener("visibilitychange", visibility);
    const pageHide = () => saveSession({ version: 2, ...current.current });
    window.addEventListener("pagehide", pageHide);
    const hashChange = () => {
      const next = screenFrom(
        Number(window.location.hash.match(/screen=(\d+)/)?.[1] ?? 1),
      );
      setScreen(next);
      setRecipe((r) => recipeForScreen(next, r));
    };
    window.addEventListener("hashchange", hashChange);
    if (IS_PRODUCTION && STANDALONE && window.location.pathname === "/") {
      window.location.replace("/akira-kitchen/" + window.location.hash);
    }
    if ("serviceWorker" in navigator && window.isSecureContext && IS_PRODUCTION)
      void navigator.serviceWorker
        .register("/akira-kitchen/sw.js", { scope: "/akira-kitchen/" })
        .then(() => navigator.serviceWorker.ready)
        .then(() => setOffline("オフラインで あそべます"))
        .catch(() => setOffline("オフラインの じゅんびは まだです"));

    return () => {
      window.clearTimeout(hydration);
      engine.dispose();
      audio.current = null;
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", pageHide);
      window.removeEventListener("hashchange", hashChange);
    };
  }, [refreshAlbum]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const resize = () => setScale(element.clientWidth / 1448);
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    audio.current?.configure(settings);
  }, [settings]);
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => {
      if (!saveSession({ version: 2, screen, recipe, settings }))
        setNotice("とちゅうの きろくを ほぞんできません");
    }, 120);
    return () => clearTimeout(timer);
  }, [ready, recipe, screen, settings]);
  useEffect(() => {
    if (detail) dialog.current?.showModal?.();
    else dialog.current?.close?.();
  }, [detail]);
  const isSaved =
    savedId === recipe.id || works.some((w) => w.id === recipe.id);
  const editable = (r: Recipe) =>
    works.some((w) => w.id === r.id) ? { ...r, id: id() } : r;
  const change = (next: Recipe, record = true) => {
    if (record) {
      history.current = [...history.current.slice(-29), recipe];
      setCanUndo(true);
    }
    setRecipe(editable(next));
    if (next !== recipe) setSavedId("");
  };
  const undo = () => {
    const previous = history.current.pop();
    if (previous) {
      setRecipe(previous);
      setCanUndo(history.current.length > 0);
      setSavedId("");
      play("pop");
    }
  };
  const start = (mode: Mode, fresh = false) => {
    if (fresh || recipe.mode !== mode || recipe.id === "initial" || isSaved) {
      setRecipe(newRecipe(mode));
      history.current = [];
      setCanUndo(false);
      setSavedId("");
    }
    setEaten([]);
    go(mode === "bento" ? 2 : 11);
  };
  const advance = (p: Process, n: number) =>
    setRecipe((r) => progress(editable(r), p, n));
  const next = () => {
    const target = NEXT[screen];
    if (target) go(target);
  };
  const save = async () => {
    if (saveLock.current || isSaved) return;
    saveLock.current = true;
    setSaving(true);
    try {
      const work = await saveArtwork(recipe);
      setWorks((w) => [work, ...w.filter((x) => x.id !== work.id)]);
      setSavedId(recipe.id);
      setNotice("アルバムに ほぞんしたよ！");
      play("save");
      try {
        void navigator.storage?.persist?.().catch(() => {});
      } catch {
        /* Optional. */
      }
    } catch {
      setNotice("ほぞんできませんでした。もういちど おしてね。");
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  };
  const choose = (
    key: "rice" | "egg" | "chicken" | "cake" | "carrotShape",
    value: string,
  ) => {
    setRecipe((r) => ({ ...editable(r), [key]: value }));
    setSavedId("");
    play("pop");
  };
  const cook = (food: Food) => {
    if (["broccoli", "carrot", "tomato"].includes(food))
      setVegetable(food as Process);
    go(COOK_SCREEN[food] ?? 6);
  };
  const removeWork = async (work: Artwork) => {
    try {
      await deleteArtwork(work.id);
      setWorks((w) => w.filter((x) => x.id !== work.id));
      setDeleted(work);
      setDetail(null);
      setNotice("けしたよ。もとに もどせます");
    } catch {
      setNotice("けせませんでした。もういちど ためしてね");
    }
  };
  const restore = async () => {
    if (!deleted) return;
    try {
      await putArtwork(deleted);
      setWorks((w) => [deleted, ...w.filter((x) => x.id !== deleted.id)]);
      setDeleted(null);
      setNotice("もとに もどしたよ");
    } catch {
      setNotice("もどせませんでした。もういちど ためしてね");
    }
  };
  const process =
      PROCESS_SCREEN[screen] ?? (screen === 6 ? vegetable : undefined),
    complete = process
      ? recipe.progress[process] >= STAGES[process].length
      : false;
  let content: ReactNode;
  if (screen === 1)
    content = (
      <>
        <Chef small />
        <div className={s.homeHeading}>
          <p>
            <span className={s.brandName}>あきら</span>くんと
            <span className={s.brandCooking}>
              {[..."おりょうり"].map((letter, i) => (
                <i key={i}>{letter}</i>
              ))}
            </span>
          </p>
          <h1>{TITLES[1]}</h1>
        </div>
        <div className={s.homeChoices}>
          <button
            className={`${s.homeCard} ${s.homeBento}`}
            onClick={() => start("bento")}
          >
            <img src="/akira-kitchen/illustration-home-bento-v2.png" alt="" draggable={false} />
            <span>
              おべんとう <ArrowRight />
            </span>
          </button>
          <button
            className={`${s.homeCard} ${s.homeCake}`}
            onClick={() => start("cake")}
          >
            <img src="/akira-kitchen/illustration-home-cake-v2.png" alt="" draggable={false} />
            <span>
              ケーキ <ArrowRight />
            </span>
          </button>
        </div>
        <Action className={s.albumHome} color="purple" onClick={() => go(16)}>
          <Album /> アルバム
        </Action>
        <button
          className={`${s.round} ${s.settingsHome}`}
          aria-label="せってい"
          onClick={() => go(17)}
        >
          <SettingsIcon />
        </button>
      </>
    );
  else if (screen === 2)
    content = (
      <>
        <div className={s.menuDish}>
          <DishArt recipe={recipe} stretch />
          <Action onClick={() => go(7)} color="green">
            つめよう <ArrowRight />
          </Action>
        </div>
        <div className={s.foodRow}>
          {BENTO.map((food) => (
            <button
              className={s.foodTile}
              key={food}
              onClick={() => cook(food)}
            >
              <FoodArt
                food={food}
                variant={food === "carrot" ? "flower" : ""}
              />
              <span>{label(food)}</span>
              {recipe.ready.includes(food) && (
                <Check className={s.readyBadge} aria-label="できた" />
              )}
            </button>
          ))}
        </div>
      </>
    );
  else if (process)
    content = (
      <>
        <div
          className={`${s.taskCard} ${screen === 3 ? `${s.riceCard} ${recipe.progress.rice < 1 ? s.ricePickup : ""}` : screen === 4 || screen === 12 ? s.yellowCard : screen === 6 ? s.greenCard : s.pinkCard}`}
        >
          <CookingGesture
            key={process}
            process={process}
            recipe={recipe}
            onProgress={advance}
            play={play}
          />
          <div className={s.taskSide}>
            <p>
              {complete ? "できたね！" : processCue(process, recipe.progress[process])}
            </p>
            <ProgressDots
              value={recipe.progress[process]}
              max={STAGES[process].length}
            />
            <Action onClick={next}>
              {complete ? "つぎへ" : "あとで"} <ArrowRight />
            </Action>
            {complete && screen >= 3 && screen <= 6 && (
              <button className={s.menuReturn} onClick={() => go(2)}>
                メニューへ
              </button>
            )}
          </div>
        </div>
        {screen === 3 && <RiceProgress value={recipe.progress.rice} />}
        {screen === 3 && recipe.progress.rice >= 1 && <img className={s.riceTub} src="/akira-kitchen/illustration-rice-tub-v2.png" alt="" draggable={false} />}
        {screen === 3 && (
          <div className={s.foodRow}>
            {RICE.map(([value, text]) => (
              <button
                key={value}
                className={`${s.foodTile} ${recipe.rice === value ? s.chosen : ""}`}
                aria-pressed={recipe.rice === value}
                onClick={() => choose("rice", value)}
              >
                <FoodArt food="onigiri" variant={value} smiling={false} />
                <span>{text}</span>
              </button>
            ))}
          </div>
        )}
        {screen === 4 && (
          <div className={s.foodRow}>
            {EGGS.map(([value, text]) => (
              <button
                key={value}
                className={`${s.foodTile} ${recipe.egg === value ? s.chosen : ""}`}
                aria-pressed={recipe.egg === value}
                onClick={() => choose("egg", value)}
              >
                <FoodArt food={value === "plain" ? "tamago" : value} />
                <span>{text}</span>
              </button>
            ))}
          </div>
        )}
        {screen === 5 && (
          <div className={s.foodRow}>
            {CHICKEN.map(([value, text]) => (
              <button
                key={value}
                className={`${s.foodTile} ${recipe.chicken === value ? s.chosen : ""}`}
                aria-pressed={recipe.chicken === value}
                onClick={() => choose("chicken", value)}
              >
                <FoodArt food={value} />
                <span>{text}</span>
              </button>
            ))}
          </div>
        )}
        {screen === 6 && (
          <div className={s.foodRow}>
            {(["broccoli", "carrot", "tomato"] as const).map((food) => (
              <button
                className={`${s.foodTile} ${vegetable === food ? s.chosen : ""}`}
                key={food}
                aria-pressed={vegetable === food}
                onClick={() => {
                  setVegetable(food);
                  play("pop");
                }}
              >
                <FoodArt
                  food={food}
                  variant={food === "carrot" ? recipe.carrotShape : ""}
                />
                <span>{label(food)}</span>
                {recipe.ready.includes(food) && (
                  <Check className={s.readyBadge} />
                )}
              </button>
            ))}
            {vegetable === "carrot" &&
              CARROT_SHAPES.map(([shape, shapeLabel]) => (
                <button
                  key={shape}
                  className={`${s.foodTile} ${recipe.carrotShape === shape ? s.chosen : ""}`}
                  aria-label={shapeLabel}
                  onClick={() => choose("carrotShape", shape)}
                >
                  <FoodArt food="carrot" variant={shape} />
                </button>
              ))}
          </div>
        )}
        {screen === 12 && (
          <div className={s.foodRow}>
            {["たまご", "こむぎこ", "ミルク"].map((name, i) => (
              <button
                key={name}
                className={`${s.foodTile} ${recipe.progress.batter > i ? s.chosen : ""}`}
                onClick={() => {
                  if (recipe.progress.batter <= i) advance("batter", 1);
                  play("pour");
                }}
              >
                <IngredientArt ingredient={(["egg", "flour", "milk"] as const)[i]} />
                <span>{name}</span>
              </button>
            ))}
            <div className={s.mixingHint}><span>ゆびで</span><span>ぐるぐる！</span></div>
          </div>
        )}
        {screen === 13 && (
          <div className={s.bakeFooter}>
            <FoodArt food="star" />
            <p>{complete ? "ふっくら やけたよ！" : STAGES.bake[Math.floor(recipe.progress.bake)]}</p>
          </div>
        )}
      </>
    );
  else if (screen === 7 || screen === 14)
    content = (
      <>
        <Arrangement
          recipe={recipe}
          onChange={change}
          play={play}
          foods={
            screen === 7
              ? recipe.ready
              : [...new Set([...recipe.toppings, ...TOPPINGS])]
          }
          paint={paint}
          onPaintChange={screen === 14 ? setPaint : undefined}
        />
        {screen === 7 && recipe.ready.length === 0 && (
          <div className={s.emptyPantry}>
            <Action color="blue" onClick={() => go(2)}>
              おかずを つくろう <ArrowRight />
            </Action>
          </div>
        )}
        <div className={s.arrangeActions}>
          <button className={s.smallButton} disabled={!canUndo} onClick={undo}>
            <RotateCcw /> もどす
          </button>
          <Action
            color="green"
            onClick={() => {
              play("finish");
              next();
            }}
          >
            できた！ <Check />
          </Action>
        </div>
        {recipe.items.length >= MAX_PIECES && (
          <div className={s.limitHint}>
            いっぱい！ はずすと また のせられるよ
          </div>
        )}
      </>
    );
  else if (screen === 8 || screen === 15)
    content = (
      <>
        <Confetti />
        <div className={s.completionCard}>
          <DishArt recipe={recipe} />
          <div className={s.finishActions}>
            <p>やったね！</p>
            {screen === 8 ? (
              <Action onClick={next}>
                たべてみる <ArrowRight />
              </Action>
            ) : (
              <Action
                color="green"
                disabled={saving || isSaved}
                onClick={() => void save()}
              >
                {isSaved ? (
                  <>
                    <Check /> ほぞんしたよ
                  </>
                ) : saving ? (
                  "ほぞんちゅう…"
                ) : (
                  <>
                    <Album /> ほぞんする
                  </>
                )}
              </Action>
            )}
            {screen === 15 && (
              <Action onClick={() => go(16)} color="purple">
                アルバム <ArrowRight />
              </Action>
            )}
            <Action color="blue" onClick={() => start(recipe.mode, true)}>
              もういちど
            </Action>
          </div>
        </div>
      </>
    );
  else if (screen === 9)
    content = (
      <div className={s.tasteCard}>
        <div className={s.tasteDish}>
          <DishArt recipe={{ ...recipe, items: [] }} />
          {recipe.items
            .filter((p) => !eaten.includes(p.id))
            .map((p) => (
              <button
                key={p.id}
                className={s.tastePiece}
                style={{ left: `${p.x}%`, top: `${p.y}%` }}
                aria-label={`${label(p.food)}を たべる`}
                onClick={() => {
                  setEaten((v) => [...v, p.id]);
                  play("eat");
                }}
              >
                <FoodArt food={p.food} variant={p.variant} />
              </button>
            ))}
        </div>
        <p>{eaten.length ? "おいしい！" : "おかずを タップ！"}</p>
        <Action onClick={next} color="green">
          アルバムへ <ArrowRight />
        </Action>
      </div>
    );
  else if (screen === 10)
    content = (
      <div className={s.completionCard}>
        <DishArt recipe={recipe} />
        <div className={s.finishActions}>
          <Action
            color="green"
            disabled={saving || isSaved}
            onClick={() => void save()}
          >
            {isSaved ? (
              <>
                <Check /> ほぞんしたよ
              </>
            ) : saving ? (
              "ほぞんちゅう…"
            ) : (
              "ほぞんする"
            )}
          </Action>
          <Action color="purple" onClick={() => go(16)}>
            <Album /> アルバム
          </Action>
          <Action color="blue" onClick={() => go(1)}>
            <Home /> ホーム
          </Action>
        </div>
      </div>
    );
  else if (screen === 11)
    content = (
      <>
        <div className={`${s.taskCard} ${s.pinkCard}`}>
          <div className={s.cakePreview}>
            <DishArt recipe={sampleRecipe("cake", recipe)} />
          </div>
          <div className={s.taskSide}>
            <div className={s.flavors}>
              {[
                ["vanilla", "バニラ"],
                ["chocolate", "チョコ"],
                ["strawberry", "いちご"],
              ].map(([value, text]) => (
                <button
                  key={value}
                  aria-pressed={recipe.cake === value}
                  onClick={() => choose("cake", value)}
                  className={recipe.cake === value ? s.flavorActive : ""}
                >
                  {text}
                </button>
              ))}
            </div>
            <Action onClick={next}>
              つくろう <ArrowRight />
            </Action>
          </div>
        </div>
        <div className={s.foodRow}>
          {TOPPINGS.map((food) => (
            <button
              key={food}
              className={`${s.foodTile} ${recipe.toppings.includes(food) ? s.chosen : ""}`}
              aria-pressed={recipe.toppings.includes(food)}
              onClick={() => {
                setRecipe((r) => ({
                  ...editable(r),
                  toppings: r.toppings.includes(food)
                    ? r.toppings.filter((f) => f !== food)
                    : [...r.toppings, food],
                }));
                play("pop");
              }}
            >
              <FoodArt food={food} />
              <span>{label(food)}</span>
            </button>
          ))}
        </div>
      </>
    );
  else if (screen === 16)
    content = (
      <>
        <div className={`${s.albumGrid} ${deleted || notice ? s.albumFeedbackSpace : ""}`}>
          {works.map((work) => (
            <button
              key={work.id}
              className={s.albumTile}
              onClick={() => setDetail(work)}
            >
              <WorkImage work={work} />
              <span>
                {work.recipe.mode === "bento" ? "おべんとう" : "ケーキ"}
              </span>
              <time dateTime={work.createdAt}>
                {new Date(work.createdAt).toLocaleDateString("ja-JP")}
              </time>
            </button>
          ))}
          {works.length > 0 && (
            <button className={`${s.albumTile} ${s.makeAgainTile}`} onClick={() => go(1)}>
              <Plus aria-hidden="true" />
              <span>また つくる</span>
            </button>
          )}
          {works.length === 0 && (
            <div className={s.emptyAlbum}>
              <Album />
              <p>{albumError || "つくった おりょうりを ここに のこそう！"}</p>
              {albumError ? (
                <Action onClick={() => void refreshAlbum()}>もういちど</Action>
              ) : (
                <Action onClick={() => go(1)} color="green">
                  つくりに いこう <ArrowRight />
                </Action>
              )}
            </div>
          )}
        </div>
      </>
    );
  else
    content = (
      <div className={s.settingsPanel}>
        <div className={s.settingRow}>
          <span>おと</span>
          <button
            aria-pressed={settings.sound}
            onClick={() => setSettings((v) => ({ ...v, sound: !v.sound }))}
          >
            {settings.sound ? "オン" : "オフ"}
          </button>
        </div>
        <div className={s.settingRow}>
          <span>おんがく</span>
          <button
            aria-pressed={settings.bgm}
            onClick={() => setSettings((v) => ({ ...v, bgm: !v.bgm }))}
          >
            {settings.bgm ? "オン" : "オフ"}
          </button>
        </div>
        <label className={s.settingRow}>
          <span>おんりょう</span>
          <input
            type="range"
            aria-label="おんりょう"
            min="0"
            max="100"
            step="5"
            value={Math.round(settings.volume * 100)}
            onChange={(e) =>
              setSettings((v) => ({
                ...v,
                volume: Number(e.target.value) / 100,
              }))
            }
          />
        </label>
        <div className={s.settingRow}>
          <span>ことば</span>
          <span className={s.language}>にほんご</span>
        </div>
        <details className={s.parentInfo}>
          <summary>おうちの かたへ</summary>
          <p>
            作品と設定は、この端末のブラウザに保存します。ブラウザのデータを消すと作品も消えます。
          </p>
          <p>{offline}</p>
          <p>
            iPadのSafariで「共有」→「ホーム画面に追加」。最初の起動には通信が必要です。
          </p>
          <p>画面の料理あそびです。実際の料理は大人といっしょに。</p>
        </details>
        <Action color="blue" onClick={() => go(1)}>
          <Home /> ホームへ
        </Action>
      </div>
    );
  return (
    <main
      className={s.app}
      onPointerDownCapture={(event) => {
        audio.current?.unlock();
        if (event.pointerType !== "touch" || touchButton.current) return;
        const button = (event.target as Element).closest<HTMLButtonElement>("button");
        if (!button || button.disabled || button.matches("[data-process], [data-piece], [data-food-drag]")) return;
        touchButton.current = { element: button, pointer: event.pointerId, x: event.clientX, y: event.clientY };
      }}
      onPointerUpCapture={(event) => {
        const tap = touchButton.current;
        if (!tap || tap.pointer !== event.pointerId) return;
        touchButton.current = null;
        const rect = tap.element.getBoundingClientRect();
        if (!tap.element.isConnected || tap.element.disabled || Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 24 || event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return;
        ignoreTouchClickUntil.current = Date.now() + 700;
        event.preventDefault();
        tap.element.click();
      }}
      onPointerCancelCapture={(event) => {
        if (touchButton.current?.pointer === event.pointerId) touchButton.current = null;
      }}
      onClickCapture={(event) => {
        if (event.detail > 0 && Date.now() < ignoreTouchClickUntil.current && (event.nativeEvent as PointerEvent).pointerType !== "mouse") {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onKeyDownCapture={() => audio.current?.unlock()}
    >
      <div className={s.viewport} ref={viewport}>
        <div
          className={`${s.stage} ${screen === 1 ? s.homeStage : screen >= 16 ? s.simpleStage : ""} ${screen === 3 ? s.riceStage : ""} ${screen === 7 || screen === 14 ? s.arrangementStage : ""}`}
          style={{ transform: `scale(${scale})` }}
          data-screen={screen}
          aria-busy={!ready}
        >
          {screen !== 1 && (
            <>
              <div className={s.kitchenBackdrop}>
                <span />
                <span />
                <span />
              </div>
              {screen < 16 && (
                <Chef
                  key={screen === 9 ? `taste-${eaten.length}` : screen}
                  pose={screen === 3 ? "squeeze" : screen === 9 && eaten.length > 0 ? "taste" : "wave"}
                  reaction={screen === 9 ? "おいしい！" : "やったね！"}
                  celebrate={
                    screen === 8 ||
                    screen === 15 ||
                    (screen === 9 && eaten.length > 0)
                  }
                />
              )}
              <h1 className={s.cloud} aria-label={TITLES[screen]}>
                <span>{TITLES[screen].split(" ")[0]}</span>
                {TITLES[screen].includes(" ") && (
                  <span className={s.colorTitle} aria-hidden="true">
                    {[...TITLES[screen].split(" ").slice(1).join(" ")].map(
                      (letter, i) => (
                        <i key={i}>{letter}</i>
                      ),
                    )}
                  </span>
                )}
              </h1>
              <button
                type="button"
                className={`${s.round} ${s.back}`}
                aria-label="もどる"
                onClick={() => go(BACK[screen])}
              >
                <ArrowLeft />
              </button>
            </>
          )}
          <button
            type="button"
            className={`${s.round} ${s.sound}`}
            aria-label={settings.sound ? "おとを けす" : "おとを つける"}
            aria-pressed={settings.sound}
            onClick={() => setSettings((v) => ({ ...v, sound: !v.sound }))}
          >
            {settings.sound ? <Volume2 /> : <VolumeX />}
          </button>
          {content}
          {(notice || (screen === 16 && deleted)) && (
            <div className={s.notice} role="status">
              <span>{notice || "けした さくひんを もどせるよ"}</span>
              {screen === 16 && deleted && (
                <button className={s.noticeUndo} aria-label="けした さくひんを もどす" onClick={() => void restore()}>
                  <RotateCcw /> もどす
                </button>
              )}
              <button
                aria-label="おしらせを とじる"
                onClick={() => setNotice("")}
              >
                <X />
              </button>
            </div>
          )}
        </div>
      </div>
      <dialog
        ref={dialog}
        className={s.workDialog}
        onCancel={() => setDetail(null)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setDetail(null);
        }}
      >
        {detail && (
          <>
            <button
              className={s.dialogClose}
              aria-label="とじる"
              onClick={() => setDetail(null)}
            >
              <X />
            </button>
            <WorkImage work={detail} />
            <p>
              {new Date(detail.createdAt).toLocaleDateString("ja-JP")} の{" "}
              {detail.recipe.mode === "bento" ? "おべんとう" : "ケーキ"}
            </p>
            <div className={s.dialogActions}>
              <Action color="blue" onClick={() => setDetail(null)}>
                もどる
              </Action>
              <button onClick={() => void removeWork(detail)}>
                <Trash2 /> けす
              </button>
            </div>
          </>
        )}
      </dialog>
    </main>
  );
}

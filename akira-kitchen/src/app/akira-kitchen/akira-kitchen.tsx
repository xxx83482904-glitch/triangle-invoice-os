"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
} from "react";
import {
  Album,
  ArrowLeft,
  ArrowRight,
  Check,
  Home,
  Settings as SettingsIcon,
  Volume2,
  RotateCcw,
  X,
  Trash2,
  Star,
  Play,
  LockKeyhole,
} from "lucide-react";
import {
  Arrangement,
  Chef,
  CookingGesture,
  ProgressDots,
  HandHint,
} from "./cooking-controls";
import { DishArt, FoodArt, DishBase } from "./cooking-art";
import {
  Action,
  Confetti,
  EntryHand,
  ParentGate,
  RotateOverlay,
  StepPictures,
} from "./kitchen-ui";
import { ArtImage, CroppedArt, preloadMedia, screenMedia } from "./media-assets";
import { dishBox, pieceStyle } from "./art-layout";
import {
  SCREEN_VOICE,
  instruction,
  mission,
  phrase,
  countVoice,
  type Voice,
} from "./cooking-guidance";
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
  variant,
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
const START_RECIPE: Recipe = { ...newRecipe("bento"), id: "initial" };
const PROCESS_SCREEN: Partial<Record<Screen, Process>> = {
  3: "rice",
  4: "egg",
  5: "chicken",
  12: "batter",
  13: "bake",
};
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
      : screen >= 2 && screen <= 8
        ? "bento"
        : recipe.mode;
  return recipe.mode === mode ? recipe : newRecipe(mode);
}
function WorkImage({ work }: { work: Artwork }) {
  const img = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const url = URL.createObjectURL(work.image);
    if (img.current) img.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [work.image]);
  // eslint-disable-next-line @next/next/no-img-element
  return (
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
    [albumBusy, setAlbumBusy] = useState(true),
    [notice, setNotice] = useState(""),
    [reaction, setReaction] = useState(""),
    [saving, setSaving] = useState(false),
    [savedId, setSavedId] = useState("");
  const [vegetable, setVegetable] = useState<Process>("broccoli"),
    [bites, setBites] = useState<Record<string, number>>({}),
    [detail, setDetail] = useState<Artwork | null>(null),
    [deleted, setDeleted] = useState<Artwork | null>(null);
  const [resume, setResume] = useState(false),
    [gate, setGate] = useState<"settings" | "delete" | null>(null),
    [deleteAllowed, setDeleteAllowed] = useState(false),
    [portrait, setPortrait] = useState(false),
    [speaking, setSpeaking] = useState(false),
    [idle, setIdle] = useState(false),
    [stars, setStars] = useState(false),
    [launching, setLaunching] = useState<Mode | null>(null);
  const [scale, setScale] = useState<number | string>(
      "var(--akira-stage-scale, 1)",
    ),
    [canUndo, setCanUndo] = useState(false),
    [offline, setOffline] = useState(
      "はじめは インターネットに つないでください",
    );
  const viewport = useRef<HTMLDivElement>(null),
    audio = useRef<KitchenAudio | null>(null),
    saveLock = useRef(false),
    history = useRef<Recipe | null>(null);
  const current = useRef({ recipe, screen, settings }),
    navigation = useRef(0),
    idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    reactionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchButton = useRef<{
      element: HTMLButtonElement;
      pointer: number;
      x: number;
      y: number;
    } | null>(null),
    ignoreTouchClickUntil = useRef(0),
    lastVoice = useRef({ screen: 0, phase: "" }),
    countTime = useRef(0),
    missionCelebrated = useRef("");
  current.current = { recipe, screen, settings };
  const updateRecipe = (next: Recipe) => {
    current.current.recipe = next;
    setRecipe(next);
  };
  const play = useCallback((sound: Sound) => audio.current?.play(sound), []);
  const say = useCallback((...clips: Voice[]) => {
    void audio.current?.say(...clips);
  }, []);
  const feedback = useCallback(
    (voice: Voice) => {
      setReaction(phrase(voice));
      say(voice);
      if (reactionTimer.current) clearTimeout(reactionTimer.current);
      reactionTimer.current = setTimeout(() => setReaction(""), 1600);
    },
    [say],
  );
  const awake = useCallback(() => {
    setIdle(false);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setIdle(true), 10000);
  }, []);
  const go = useCallback(
    (target: Screen, bypass = false) => {
      if (target === 17 && !bypass) {
        setGate("settings");
        say("parent", "hold");
        return;
      }
      const r = current.current.recipe;
      if ([8, 9, 10, 15].includes(target) && !r.items.length) {
        target = r.mode === "bento" ? 7 : 14;
        say("place-first");
      }
      if (target === 7 && !r.ready.length) {
        target = 2;
        say("cook-first");
      }
      const next = target,
        token = ++navigation.current;
      void Promise.race([
        preloadMedia(screenMedia(next)),
        new Promise((resolve) => setTimeout(resolve, 900)),
      ]).then(() => {
        if (token !== navigation.current) return;
        setRecipe((value) => recipeForScreen(next, value));
        setScreen(next);
        setNotice("");
        setReaction("");
        setBites({});
        play("tap");
        window.history.replaceState({}, "", "#screen=" + next);
        awake();
      });
    },
    [awake, play, say],
  );
  const refreshAlbum = useCallback(async () => {
    setAlbumBusy(true);
    try {
      await migrateLegacy();
      setWorks(await listArtworks());
    } catch {
      setNotice("アルバムを ひらけません。もういちど ためしてね。");
    } finally {
      setAlbumBusy(false);
    }
  }, []);
  useEffect(() => {
    const engine = new KitchenAudio();
    audio.current = engine;
    engine.onSpeaking = setSpeaking;
    const timer = setTimeout(() => {
      const stored = readSession(),
        hash = window.location.hash.match(/screen=(\d+)/),
        target = hash ? screenFrom(Number(hash[1])) : (stored?.screen ?? 1);
      const initial = recipeForScreen(
        target,
        stored?.recipe ?? newRecipe("bento"),
      );
      setRecipe(initial);
      setSettings(stored?.settings ?? DEFAULT_SETTINGS);
      if (target === 6)
        setVegetable(
          (["broccoli", "tomato", "carrot"] as Process[]).find(
            (p) =>
              initial.progress[p] > 0 && initial.progress[p] < STAGES[p].length,
          ) ?? "broccoli",
        );
      if (target === 17) {
        setGate("settings");
        setScreen(1);
      } else if ([8, 9, 10, 15].includes(target) && !initial.items.length)
        setScreen(initial.mode === "cake" ? 14 : 7);
      else if (target === 7 && !initial.ready.length) setScreen(2);
      else setScreen(target);
      if (stored && target > 1 && target < 16) setResume(true);
      setReady(true);
      void refreshAlbum();
      awake();
    }, 0);
    const save = () => saveSession({ version: 2, ...current.current });
    const visibility = () => {
      if (document.hidden) {
        engine.suspend();
        save();
      }
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", save);
    const hashChange = () =>
      go(
        screenFrom(
          Number(window.location.hash.match(/screen=(\d+)/)?.[1] ?? 1),
        ),
      );
    window.addEventListener("hashchange", hashChange);
    const register = () => {
      if (
        "serviceWorker" in navigator &&
        window.isSecureContext &&
        IS_PRODUCTION
      )
        void navigator.serviceWorker
          .register("/akira-kitchen/sw.js", { scope: "/akira-kitchen/" })
          .then(() => navigator.serviceWorker.ready)
          .then((registration) => {
            setOffline("ひらいた がめんは オフラインでも あそべます");
            registration.active?.postMessage({ type: "WARM_KITCHEN" });
          })
          .catch(() => setOffline("オフラインの じゅんびは まだです"));
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
    const cacheReady = (event: MessageEvent) => {
      if (event.data?.type === "KITCHEN_OFFLINE_READY")
        setOffline("おりょうりは すべて オフラインで あそべます");
    };
    navigator.serviceWorker?.addEventListener("message", cacheReady);
    return () => {
      clearTimeout(timer);
      engine.dispose();
      audio.current = null;
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", save);
      window.removeEventListener("hashchange", hashChange);
      window.removeEventListener("load", register);
      navigator.serviceWorker?.removeEventListener("message", cacheReady);
      if (idleTimer.current) clearTimeout(idleTimer.current);
      if (reactionTimer.current) clearTimeout(reactionTimer.current);
    };
  }, [awake, go, refreshAlbum]);
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const resize = () => {
      setScale(el.clientWidth / 1448);
      setPortrait(
        window.innerWidth < 600 || window.innerHeight > window.innerWidth,
      );
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    window.addEventListener("resize", resize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, []);
  useEffect(() => {
    audio.current?.configure(settings);
  }, [settings]);
  useEffect(() => {
    if (!ready || resume) return;
    const timer = setTimeout(() => {
      if (!saveSession({ version: 2, screen, recipe, settings }))
        setNotice("とちゅうの きろくを ほぞんできません");
    }, 120);
    return () => clearTimeout(timer);
  }, [ready, recipe, screen, settings, resume]);
  const activeProcess = screen === 6 ? vegetable : PROCESS_SCREEN[screen];
  const complete = activeProcess
    ? recipe.progress[activeProcess] >= STAGES[activeProcess].length
    : false;
  const paint = screen === 14 && recipe.progress.cream < 1;
  const challenge = mission(recipe);
  const quest: Voice | undefined =
    screen === 3
      ? "triangle-mission"
      : screen === 4
        ? "egg-mission"
        : screen === 5 || screen === 13
          ? "brown-mission"
          : screen === 6
            ? vegetable === "carrot"
              ? "flower-mission"
              : vegetable === "tomato"
                ? "red-mission"
                : "green-mission"
            : screen === 12
              ? "ingredients-mission"
              : screen === 7 || (screen === 14 && !paint)
                ? challenge.voice
                : paint
                  ? "cream-mission"
                  : undefined;
  const cue: Voice = activeProcess
    ? complete
      ? activeProcess === "rice"
        ? "triangle-done"
        : "praise-1"
      : instruction(activeProcess, recipe.progress[activeProcess])
    : (quest ?? SCREEN_VOICE[screen]);
  const phase = activeProcess
    ? activeProcess + ":" + Math.floor(recipe.progress[activeProcess])
    : paint
      ? "paint"
      : "place";
  useEffect(() => {
    if (!ready) return;
    if (portrait) {
      say("rotate-device");
      return;
    }
    if (resume) {
      say("resume");
      return;
    }
    if (gate) {
      say("parent", "hold");
      return;
    }
    const entered = lastVoice.current.screen !== screen;
    const clips: Voice[] = entered ? [SCREEN_VOICE[screen]] : [];
    if (entered && quest) clips.push(quest);
    if (quest === "pack-rice" && entered) clips.push("put-two");
    if (activeProcess && (!entered || cue !== quest)) clips.push(cue);
    if (clips.length && (entered || Date.now() - countTime.current > 400))
      say(...clips);
    lastVoice.current = { screen, phase };
    if (entered && (screen === 8 || screen === 15)) play("finish");
    // Narration follows a new instruction, not every intermediate gesture frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, screen, phase, portrait, resume, gate, complete]);
  useEffect(() => {
    if (!ready) return;
    void preloadMedia(screenMedia(screen));
    const next = NEXT[screen] ?? (screen === 1 ? 2 : 1);
    const timer = setTimeout(
      () =>
        void preloadMedia([
          ...screenMedia(next),
          ...(screen === 1 ? screenMedia(11) : []),
        ]),
      500,
    );
    return () => clearTimeout(timer);
  }, [ready, screen]);
  useEffect(() => {
    if (
      (screen === 7 || (screen === 14 && !paint)) &&
      challenge.done &&
      missionCelebrated.current !== recipe.id
    ) {
      missionCelebrated.current = recipe.id;
      setStars(true);
      play("finish");
      feedback("clear");
      const timer = setTimeout(() => setStars(false), 1800);
      return () => clearTimeout(timer);
    }
  }, [screen, challenge.done, recipe.id, paint, play, feedback]);
  const isSaved =
    savedId === recipe.id || works.some((w) => w.id === recipe.id);
  const editable = (r: Recipe) =>
    works.some((w) => w.id === r.id) ? { ...r, id: id() } : r;
  const change = (next: Recipe, record = true) => {
    if (record) {
      history.current = recipe;
      setCanUndo(true);
    }
    updateRecipe(editable(next));
    setSavedId("");
    if (next.items.length > recipe.items.length) {
      const food = next.items[next.items.length - 1].food,
        count = next.items.filter((p) => p.food === food).length;
      feedback(countVoice(count));
      if (next.items.length === MAX_PIECES)
        setNotice("いっぱい！ うごかして ならべよう");
    } else if (next.items.length === recipe.items.length && !paint)
      feedback("praise-2");
  };
  const undo = () => {
    if (history.current) {
      updateRecipe(history.current);
      history.current = null;
      setCanUndo(false);
      setSavedId("");
      play("pop");
      feedback("undo");
    } else feedback("tap-here");
  };
  const start = (mode: Mode, fresh = false) => {
    if (fresh || recipe.mode !== mode || recipe.id === "initial" || isSaved) {
      updateRecipe(newRecipe(mode));
      history.current = null;
      setCanUndo(false);
      setSavedId("");
    }
    setBites({});
    setLaunching(mode);
    setTimeout(() => {
      setLaunching(null);
      go(mode === "bento" ? 2 : 11);
    }, 200);
  };
  const advance = (p: Process, n: number) => {
    const before = current.current.recipe,
      next = progress(editable(before), p, n),
      was = before.progress[p],
      value = next.progress[p];
    updateRecipe(next);
    setSavedId("");
    if (p === "egg" && was < 1 && value > was) {
      countTime.current = Date.now();
      say(value < 1 ? "count-1" : "count-2", value < 1 ? "crack" : "mix");
      setReaction(value < 1 ? "1こ！" : "2こ！");
    } else if (
      p === "batter" &&
      value <= 3 &&
      Math.floor(value) > Math.floor(was)
    ) {
      countTime.current = Date.now();
      say(("count-" + value) as Voice, instruction(p, value));
      setReaction(value + "こ！");
    } else if (value >= STAGES[p].length && was < value) {
      play("finish");
      feedback(
        p === "rice"
          ? "triangle-done"
          : p === "chicken" || p === "bake"
            ? "color-brown"
            : "praise-1",
      );
    } else if (Math.floor(value) !== Math.floor(was)) setReaction("じょうず！");
    else if (Date.now() - countTime.current > 1800) {
      countTime.current = Date.now();
      feedback("praise-2");
    }
  };
  const choose = (
    key: "rice" | "egg" | "chicken" | "cake" | "carrotShape",
    value: string,
  ) => {
    updateRecipe({ ...editable(recipe), [key]: value });
    setSavedId("");
    play("pop");
    feedback(
      key === "carrotShape"
        ? value === "flower"
          ? "shape-flower"
          : value === "star"
            ? "shape-star"
            : "shape-heart"
        : key === "cake"
          ? value === "strawberry"
            ? "color-pink"
            : value === "chocolate"
              ? "color-brown"
              : "color-white"
          : "praise-3",
    );
  };
  const cook = (food: Food) => {
    if (["broccoli", "carrot", "tomato"].includes(food))
      setVegetable(food as Process);
    go(COOK_SCREEN[food] ?? 6);
  };
  const next = () => go(NEXT[screen] ?? 2);
  const finishDish = () => {
    if (!recipe.items.length) {
      feedback("place-first");
      return;
    }
    go(recipe.mode === "bento" ? 8 : 15);
  };
  const save = async () => {
    if (!recipe.items.length) {
      feedback("place-first");
      return;
    }
    if (saveLock.current || isSaved) {
      feedback("saved");
      return;
    }
    saveLock.current = true;
    setSaving(true);
    try {
      const work = await saveArtwork(recipe);
      setWorks((w) => [work, ...w.filter((x) => x.id !== work.id)]);
      setSavedId(recipe.id);
      play("save");
      feedback("saved");
      void navigator.storage?.persist?.().catch(() => {});
    } catch {
      setNotice("ほぞんできませんでした。もういちど おしてね。");
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  };
  const eat = (piece: string) => {
    const count = Math.min(2, (bites[piece] ?? 0) + 1),
      nextBites = { ...bites, [piece]: count };
    setBites(nextBites);
    play("eat");
    feedback(count === 1 ? "chew" : "yummy");
    if (recipe.items.every((p) => (nextBites[p.id] ?? 0) >= 2))
      setTimeout(() => go(10), 700);
  };
  const removeWork = async (work: Artwork) => {
    try {
      await deleteArtwork(work.id);
      setWorks((w) => w.filter((x) => x.id !== work.id));
      setDeleted(work);
      setDetail(null);
      setDeleteAllowed(false);
      play("pop");
    } catch {
      setNotice("けせませんでした。もういちど ためしてね。");
    }
  };
  const restore = async () => {
    if (!deleted) return;
    try {
      await putArtwork(deleted);
      await refreshAlbum();
      setDeleted(null);
      play("save");
    } catch {
      setNotice("もどせませんでした。もういちど ためしてね。");
    }
  };
  const replay = () => {
    awake();
    if (portrait) {
      say("rotate-device");
      return;
    }
    say(
      SCREEN_VOICE[screen],
      cue,
      ...(quest === "pack-rice" ? ["put-two" as Voice] : []),
    );
  };
  const options =
    screen === 3 ? RICE : screen === 4 ? EGGS : screen === 5 ? CHICKEN : [];
  const dish = dishBox(recipe);
  const dishStyle = { aspectRatio: `${dish.width} / ${dish.height}` };
  let content: ReactNode = null;
  if (screen === 1)
    content = (
      <>
        <Chef small />
        <div className={s.homeHeading}>
          <ArtImage name="title-cloud" className={s.titleCloud} />
          <p>
            <span className={s.brandName}>あきら</span>くんと
            <span className={s.brandCooking}>
              {[..."おりょうり"].map((letter, i) => (
                <i key={i}>{letter}</i>
              ))}
            </span>
          </p>
          <h1>なにを つくる？</h1>
        </div>
        <div className={s.homeChoices}>
          {(["bento", "cake"] as const).map((mode) => (
            <button
              key={mode}
              className={[
                s.homeCard,
                mode === "bento" ? s.homeBento : s.homeCake,
                launching === mode ? s.launch : "",
              ].join(" ")}
              onClick={() => start(mode)}
            >
              <CroppedArt name={"home-" + mode} className={s.homeFood} />
              <span>
                {mode === "bento" ? "おべんとう" : "ケーキ"}
                <ArrowRight />
              </span>
              {mode === "bento" && <EntryHand />}
            </button>
          ))}
        </div>
        <Action className={s.albumHome} color="purple" onClick={() => go(16)}>
          <Album />
          アルバム
        </Action>
        <button
          className={[s.round, s.settingsHome].join(" ")}
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
        <div className={s.menuDish} style={dishStyle}>
          <DishBase recipe={recipe} />
        <div className={s.menuTiles}>
          {BENTO.map((food, i) => (
            <button
              className={[
                s.foodTile,
                s.menuFood,
                recipe.ready.includes(food) ? s.made : "",
              ].join(" ")}
              key={food}
              onClick={() => cook(food)}
            >
              <FoodArt food={food} variant={variant(recipe, food)} />
              <span>{label(food)}</span>
              {recipe.ready.includes(food) ? (
                <Check className={s.readyBadge} />
              ) : (
                i === 0 && <EntryHand />
              )}
            </button>
          ))}
        </div>
        </div>
        <p className={s.menuPrompt}>なにから つくる？</p>
        <div className={s.footer}>
          <Action
            color="green"
            locked={!recipe.ready.length}
            onClick={() =>
              recipe.ready.length ? go(7) : feedback("cook-first")
            }
          >
            つめよう
            <ArrowRight />
          </Action>
        </div>
      </>
    );
  else if (activeProcess)
    content = (
      <>
        <StepPictures
          process={activeProcess}
          value={recipe.progress[activeProcess]}
        />
        {complete && <Confetti />}
        <div className={s.missionBubble}>
          <span className={s.themeIcon}>
            {screen === 3
              ? "△"
              : screen === 4 || screen === 12
                ? "1 2"
                : screen === 6 && vegetable === "carrot"
                  ? "✿"
                  : "●"}
          </span>
          <span>{quest ? phrase(quest) : ""}</span>
        </div>
        <div className={[s.workArea, complete ? s.completed : ""].join(" ")} data-cooking-hero data-complete={complete}>
          <CookingGesture
            key={activeProcess}
            process={activeProcess}
            recipe={recipe}
            onProgress={advance}
            play={play}
          />
          <ProgressDots
            value={
              (recipe.progress[activeProcess] / STAGES[activeProcess].length) *
              4
            }
            max={4}
          />
        </div>
        {!complete && options.length > 0 && (
          <div className={s.foodRow}>
            {options.map(([value, text]) => (
              <button
                className={[
                  s.foodTile,
                  recipe[
                    screen === 3 ? "rice" : screen === 4 ? "egg" : "chicken"
                  ] === value
                    ? s.chosen
                    : "",
                ].join(" ")}
                key={value}
                aria-pressed={
                  recipe[
                    screen === 3 ? "rice" : screen === 4 ? "egg" : "chicken"
                  ] === value
                }
                onClick={() =>
                  choose(
                    screen === 3 ? "rice" : screen === 4 ? "egg" : "chicken",
                    value,
                  )
                }
              >
                <FoodArt
                  food={
                    screen === 3
                      ? "onigiri"
                      : screen === 4
                        ? "tamago"
                        : "karaage"
                  }
                  variant={value}
                  smiling={false}
                />
                <span>{text}</span>
              </button>
            ))}
          </div>
        )}
        {!complete && screen === 6 && (
          <div className={s.foodRow}>
            {(["broccoli", "tomato", "carrot"] as const).map((food) => (
              <button
                key={food}
                className={[
                  s.foodTile,
                  vegetable === food ? s.chosen : "",
                ].join(" ")}
                onClick={() => {
                  setVegetable(food);
                  play("pop");
                  feedback(
                    food === "tomato"
                      ? "color-red"
                      : food === "broccoli"
                        ? "color-green"
                        : "shape-flower",
                  );
                }}
              >
                <FoodArt food={food} variant={recipe.carrotShape} />
                <span>{label(food)}</span>
                {recipe.ready.includes(food) && (
                  <Check className={s.readyBadge} />
                )}
              </button>
            ))}
            {vegetable === "carrot" &&
              ["flower", "star", "heart"].map((shape) => (
                <button
                  key={shape}
                  className={[
                    s.foodTile,
                    recipe.carrotShape === shape ? s.chosen : "",
                  ].join(" ")}
                  onClick={() => choose("carrotShape", shape)}
                >
                  <FoodArt food="carrot" variant={shape} />
                  <span>
                    {shape === "flower"
                      ? "おはな"
                      : shape === "star"
                        ? "ほし"
                        : "はーと"}
                  </span>
                </button>
              ))}
          </div>
        )}
        {!complete && screen === 12 && recipe.progress.batter < 3 && (
          <div className={s.ingredientCount}>
            {["ingredient-flour", "ingredient-egg", "ingredient-milk"].map(
              (name, i) => (
                <span
                  className={recipe.progress.batter > i ? s.doneIngredient : ""}
                  key={name}
                >
                  <ArtImage name={name} />
                  <b>{i + 1}</b>
                </span>
              ),
            )}
          </div>
        )}
        {complete && (
          <div className={s.footer}>
            <Action onClick={next}>
              つぎへ
              <ArrowRight />
            </Action>
            <EntryHand />
          </div>
        )}
        {!complete && idle && (
          <button className={s.cookingSkip} onClick={next}>
            あとで あそぶ
            <ArrowRight />
          </button>
        )}
        {complete && screen < 7 && (
          <button className={s.secondary} onClick={() => go(2)}>
            <Home />
            メニューへ
          </button>
        )}
      </>
    );
  else if (screen === 7 || screen === 14)
    content = (
      <>
        <div className={s.missionBubble}>
          {paint ? (
            <>
              <FoodArt food="cream" />
              <span>しろく ぬろう</span>
            </>
          ) : (
            <>
              <FoodArt food={challenge.food as Food} />
              <span>
                {challenge.voice === "pack-rice"
                  ? "さんかくを 2こ"
                  : challenge.voice === "strawberry-mission"
                    ? "いちごを ちょうど 3こ"
                    : "おかずを 2こ"}
                <small>
                  {challenge.count} / {challenge.target}
                  {challenge.done && <Star fill="#ffca33" />}
                </small>
              </span>
            </>
          )}
        </div>
        <Arrangement
          recipe={recipe}
          foods={
            screen === 7
              ? BENTO.filter((food) => recipe.ready.includes(food))
              : TOPPINGS
          }
          onChange={change}
          play={play}
          paint={paint}
          onFeedback={feedback}
        />
        <div className={s.footer}>
          {paint ? (
            <span className={s.shortCue}>くるくる ぬってね</span>
          ) : (
            <Action
              color="green"
              locked={!recipe.items.length}
              onClick={finishDish}
            >
              できた！
              <Check />
            </Action>
          )}
        </div>
        <button className={s.secondary} aria-disabled={!canUndo} onClick={undo}>
          <RotateCcw />
          もどす
        </button>
        {paint && idle && (
          <button
            className={s.skipCorner}
            onClick={() => {
              updateRecipe({
                ...recipe,
                progress: { ...recipe.progress, cream: 1 },
              });
              feedback("praise-2");
            }}
          >
            あとで ぬる
          </button>
        )}
      </>
    );
  else if (screen === 8 || screen === 15)
    content = (
      <>
        <Confetti />
        <div className={s.finishedDish} style={dishStyle}>
          <DishArt recipe={recipe} />
        </div>
        <div className={s.footer}>
          <Action
            onClick={() => {
              setBites({});
              go(9);
            }}
          >
            たべてみる
            <ArrowRight />
          </Action>
          <EntryHand />
        </div>
        <button
          className={s.secondary}
          onClick={() => start(recipe.mode, true)}
        >
          <RotateCcw />
          もういちど
        </button>
      </>
    );
  else if (screen === 9)
    content = (
      <>
        <div className={s.tasteDish} style={dishStyle}>
          <DishBase recipe={recipe} />
          {recipe.items
            .filter((p) => (bites[p.id] ?? 0) < 2)
            .map((p) => (
              <button
                key={p.id}
                data-eat={p.id}
                className={[
                  s.piece,
                  recipe.mode === "cake" ? s.topping : "",
                ].join(" ")}
                style={
                  {
                    ...pieceStyle(recipe, p),
                    "--turn": p.rotation + "deg",
                    clipPath: bites[p.id]
                      ? "polygon(0 0,70% 0,70% 35%,100% 35%,100% 100%,0 100%)"
                      : undefined,
                  } as CSSProperties
                }
                aria-label={label(p.food) + "を たべる"}
                onClick={() => eat(p.id)}
              >
                <FoodArt food={p.food} variant={p.variant} />
              </button>
            ))}
          <HandHint motion="squeeze" />
        </div>
        <div className={s.footer}>
          <Action onClick={() => go(10)}>
            <Album />
            アルバムへ
          </Action>
        </div>
      </>
    );
  else if (screen === 10)
    content = (
      <>
        <div className={[s.finishedDish, isSaved ? s.savedFly : ""].join(" ")} style={dishStyle}>
          <DishArt recipe={recipe} />
        </div>
        {isSaved && (
          <div className={s.savedBook}>
            <Album />
            <Check />
            <p>ほぞん できた！</p>
          </div>
        )}
        <div className={s.footer}>
          <Action
            onClick={() => (isSaved ? go(16) : void save())}
            color={isSaved ? "green" : "pink"}
          >
            {saving ? (
              "ほぞんちゅう"
            ) : isSaved ? (
              <>
                <Album />
                アルバムへ
              </>
            ) : (
              <>
                <Album />
                ほぞんする
              </>
            )}
          </Action>
          <EntryHand />
        </div>
        {isSaved && (
          <button className={s.secondary} onClick={() => go(1)}>
            <Home />
            ホーム
          </button>
        )}
      </>
    );
  else if (screen === 11)
    content = (
      <>
        <div className={s.cakeMenuDish} style={dishStyle}>
          <DishArt recipe={{ ...recipe, items: [], strokes: [] }} />
        </div>
        <div className={s.flavors}>
          {(["vanilla", "chocolate", "strawberry"] as const).map((flavor) => (
            <button
              className={[
                s.flavor,
                recipe.cake === flavor ? s.chosen : "",
              ].join(" ")}
              aria-pressed={recipe.cake === flavor}
              key={flavor}
              onClick={() => choose("cake", flavor)}
            >
              <ArtImage
                name={flavor === "vanilla" ? "cake-base" : "cake-" + flavor}
              />
              <span>
                {flavor === "vanilla"
                  ? "バニラ"
                  : flavor === "chocolate"
                    ? "チョコ"
                    : "いちご"}
              </span>
              {recipe.cake === flavor && <Check />}
            </button>
          ))}
        </div>
        <div className={s.footer}>
          <Action onClick={() => go(12)}>
            つくろう
            <ArrowRight />
          </Action>
          <EntryHand />
        </div>
      </>
    );
  else if (screen === 16)
    content = (
      <>
        {works.length ? (
          <div className={s.albumGrid}>
            {works.map((work) => (
              <button
                className={s.workCard}
                key={work.id}
                onClick={() => {
                  setDetail(work);
                  setDeleteAllowed(false);
                  play("pop");
                  say("praise-1");
                }}
              >
                <WorkImage work={work} />
                <span>
                  {new Date(work.createdAt).toLocaleDateString("ja-JP")}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className={s.emptyAlbum}>
            <Chef small />
            <ArtImage name="bento-box" />
            <p>さいしょの おりょうりを つくろう</p>
            <Action onClick={() => go(1)}>
              つくる
              <ArrowRight />
            </Action>
            <EntryHand />
          </div>
        )}
        {works.length > 0 && (
          <>
            <EntryHand className={s.albumHand} />
            <button className={s.secondary} onClick={() => go(1)}>
              <Home />
              ホーム
            </button>
          </>
        )}
        {deleted && (
          <button className={s.restore} onClick={() => void restore()}>
            <RotateCcw />
            けした さくひんを もどす
          </button>
        )}
      </>
    );
  else if (screen === 17)
    content = (
      <div className={s.settingsPanel}>
        {(
          [
            ["sound", "こうかおん"],
            ["bgm", "おんがく"],
            ["narration", "こえの あんない"],
          ] as const
        ).map(([key, text]) => (
          <div className={s.settingRow} key={key}>
            <span>{text}</span>
            <button
              role="switch"
              aria-checked={settings[key]}
              aria-label={text}
              className={settings[key] ? s.toggleOn : s.toggleOff}
              onClick={() => {
                setSettings((value) => ({ ...value, [key]: !value[key] }));
                play("tap");
              }}
            >
              <span />
              {settings[key] ? "オン" : "オフ"}
            </button>
          </div>
        ))}
        <label className={s.settingRow}>
          <span>おとの おおきさ</span>
          <input
            type="range"
            min="0"
            max="1"
            step=".05"
            aria-label="おとの おおきさ"
            value={settings.volume}
            onChange={(e) =>
              setSettings((value) => ({
                ...value,
                volume: Number(e.target.value),
              }))
            }
            onPointerUp={() => {
              play("pop");
              say("praise-2");
            }}
          />
        </label>
        <div className={s.parentInfo}>
          <h2>おうちの かたへ</h2>
          <p>作品と設定は、この端末のブラウザ内に保存します。</p>
          <p>ブラウザのデータを消すと、作品も消えます。</p>
          <p>実際の料理は、大人と一緒に行ってください。</p>
          <small>{offline}</small>
        </div>
        <EntryHand className={s.settingsHand} />
      </div>
    );
  return (
    <main
      className={s.app}
      onPointerDownCapture={(event) => {
        audio.current?.unlock();
        awake();
        if (event.pointerType === "mouse") ignoreTouchClickUntil.current = 0;
        if (event.pointerType !== "touch" || touchButton.current) return;
        const button = (event.target as Element).closest<HTMLButtonElement>(
          "button",
        );
        if (
          !button ||
          button.disabled ||
          button.matches(
            "[data-process],[data-piece],[data-food-drag],[data-hold]",
          )
        )
          return;
        touchButton.current = {
          element: button,
          pointer: event.pointerId,
          x: event.clientX,
          y: event.clientY,
        };
      }}
      onPointerUpCapture={(event) => {
        awake();
        // WebKit can emit a trusted compatibility click with detail=0 after
        // touch release, even when the screen changed under the finger.
        // All touch-owned controls already commit in their pointer-up handler.
        if (event.pointerType === "touch")
          ignoreTouchClickUntil.current = Date.now() + 700;
        const tap = touchButton.current;
        if (!tap || tap.pointer !== event.pointerId) return;
        touchButton.current = null;
        const rect = tap.element.getBoundingClientRect();
        if (
          !tap.element.isConnected ||
          tap.element.disabled ||
          Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 24 ||
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          return;
        ignoreTouchClickUntil.current = Date.now() + 700;
        event.preventDefault();
        tap.element.click();
      }}
      onPointerCancelCapture={(event) => {
        if (touchButton.current?.pointer === event.pointerId)
          touchButton.current = null;
      }}
      onClickCapture={(event) => {
        if (
          event.nativeEvent.isTrusted &&
          Date.now() < ignoreTouchClickUntil.current
        ) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onKeyDownCapture={() => {
        ignoreTouchClickUntil.current = 0;
        audio.current?.unlock();
        awake();
      }}
    >
      <div className={s.viewport} ref={viewport}>
        <div
          className={[
            s.stage,
            screen === 1 ? s.homeStage : "",
            screen === 7 || screen === 14 ? s.arrangementStage : "",
          ].join(" ")}
          style={{ transform: "scale(" + scale + ")" }}
          data-screen={screen}
          data-kind={recipe.mode}
          aria-busy={!ready || (screen === 16 && albumBusy)}
          inert={portrait || gate !== null || resume || detail !== null}
        >
          <ArtImage
            name={screen === 1 ? "home-backdrop" : "kitchen"}
            className={s.backdrop}
            sizes="100vw"
            fetchPriority="high"
          />
          {screen !== 1 && (
            <>
              <h1 className={s.screenTitle}>
                {paint ? "クリームを ぬろう！" : TITLES[screen]}
              </h1>
              <button
                className={[s.round, s.back].join(" ")}
                aria-label="もどる"
                onClick={() =>
                  go(screen === 9 && recipe.mode === "cake" ? 15 : BACK[screen])
                }
              >
                <ArrowLeft />
              </button>
            </>
          )}
          <button
            className={[s.round, s.speaker, speaking ? s.speaking : ""].join(
              " ",
            )}
            aria-label="もういちど きく"
            data-speaking={speaking}
            onClick={replay}
          >
            <Volume2 />
          </button>
          {screen > 1 && screen < 16 && (
            <div className={s.chefWindow}>
              <Chef
                small={false}
                pose={
                  screen === 3 ? "squeeze" : screen === 9 ? "taste" : "wave"
                }
                celebrate={screen === 8 || screen === 15 || !!reaction}
                reaction={reaction || "できたね！"}
              />
            </div>
          )}
          {content}
          {stars && <Confetti />}
          {notice && (
            <div className={s.notice} role="status">
              <span>{notice}</span>
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
      <RotateOverlay />
      {resume && !portrait && (
        <div
          className={s.overlay}
          role="dialog"
          aria-modal="true"
          aria-label="つづきから あそぶ？"
        >
          <div className={s.resume}>
            <Chef small />
            <h2>つづきから あそぶ？</h2>
            <Action
              onClick={() => {
                setResume(false);
                play("tap");
              }}
            >
              <Play />
              つづきから
            </Action>
            <button
              className={s.resumeRestart}
              onClick={() => {
                updateRecipe(newRecipe(recipe.mode));
                setResume(false);
                go(1);
              }}
            >
              <RotateCcw />
              さいしょから
            </button>
          </div>
        </div>
      )}
      {detail && !portrait && (
        <div
          className={[s.overlay, s.workDialog].join(" ")}
          role="dialog"
          aria-modal="true"
          aria-label="さくひん"
          onKeyDown={(e) => {
            if (e.key === "Escape") setDetail(null);
          }}
        >
          <WorkImage work={detail} />
          <p>{new Date(detail.createdAt).toLocaleDateString("ja-JP")}</p>
          <button
            className={s.close}
            aria-label="とじる"
            onClick={() => setDetail(null)}
          >
            <X />
          </button>
          {deleteAllowed ? (
            <button
              className={s.delete}
              onClick={() => void removeWork(detail)}
            >
              <Trash2 />
              この さくひんを けす
            </button>
          ) : (
            <button
              className={s.parentButton}
              onClick={() => setGate("delete")}
            >
              <LockKeyhole />
              おうちの かたへ
            </button>
          )}
        </div>
      )}
      {gate && !portrait && (
        <ParentGate
          onClose={() => setGate(null)}
          onOpen={() => {
            if (gate === "settings") go(17, true);
            else setDeleteAllowed(true);
            setGate(null);
            play("pop");
          }}
        />
      )}
    </main>
  );
}

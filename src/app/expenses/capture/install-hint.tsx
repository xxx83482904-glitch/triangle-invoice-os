"use client";

import { useEffect, useRef, useState } from "react";
import { Share, Smartphone, X } from "lucide-react";

const STORAGE_INSTALL = "triangle:expense-capture:install-hint";
function stored(key: string) { try { return window.localStorage.getItem(key) || ""; } catch { return ""; } }
function store(key: string, value: string) { try { window.localStorage.setItem(key, value); } catch { /* private mode */ } }

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

export function InstallHint() {
  const [mode, setMode] = useState<"" | "ios" | "prompt">(""), prompt = useRef<InstallPrompt | null>(null);
  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone;
    if (standalone || stored(STORAGE_INSTALL) === "dismissed") return;
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
    const capture = (event: Event) => { event.preventDefault(); prompt.current = event as InstallPrompt; setMode("prompt"); };
    window.addEventListener("beforeinstallprompt", capture);
    const timer = ios ? window.setTimeout(() => setMode("ios"), 0) : undefined;
    return () => { window.removeEventListener("beforeinstallprompt", capture); if (timer) window.clearTimeout(timer); };
  }, []);
  if (!mode) return null;
  const dismiss = () => { store(STORAGE_INSTALL, "dismissed"); setMode(""); };
  return <section aria-label="ホーム画面に追加" className="cap-surface flex items-start gap-3.5 px-5 py-4">
    <Smartphone className="mt-0.5 size-5 shrink-0 text-muted-foreground" strokeWidth={1.5} />
    <div className="min-w-0 flex-1 space-y-2">
      <p className="text-[14px] tracking-[0.04em]">ホーム画面に追加すると、アイコンからすぐ撮影できます</p>
      {mode === "ios" ? <p className="text-[12.5px] tracking-[0.04em] text-muted-foreground">Safariの <Share className="inline size-3.5 align-[-2px]" strokeWidth={1.6} /> 共有 →「ホーム画面に追加」</p>
        : <button type="button" className="cap-press h-11 rounded-full bg-foreground px-5 text-[13px] tracking-[0.1em] text-background" onClick={async () => { await prompt.current?.prompt(); dismiss(); }}>ホーム画面に追加</button>}
    </div>
    <button type="button" aria-label="閉じる" className="-m-2 flex size-12 items-center justify-center text-muted-foreground" onClick={dismiss}><X className="size-4" strokeWidth={1.6} /></button>
  </section>;
}

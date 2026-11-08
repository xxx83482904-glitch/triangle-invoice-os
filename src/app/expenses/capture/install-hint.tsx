"use client";

import { useEffect, useRef, useState } from "react";
import { Share, Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";

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
  return <section aria-label="ホーム画面に追加" className="flex items-start gap-3 rounded-[20px] border bg-sky-50 p-4 text-[15px] text-sky-950 dark:bg-sky-950/40 dark:text-sky-100">
    <Smartphone className="mt-0.5 size-5 shrink-0" />
    <div className="min-w-0 flex-1 space-y-2">
      <p className="font-medium">ホーム画面に追加すると、アプリのようにすぐ撮影できます</p>
      {mode === "ios" ? <p className="text-xs">Safariの <Share className="inline size-3.5 align-[-2px]" /> 共有ボタン →「ホーム画面に追加」</p>
        : <Button type="button" className="h-12 rounded-xl px-5 text-base" onClick={async () => { await prompt.current?.prompt(); dismiss(); }}>ホーム画面に追加</Button>}
    </div>
    <button type="button" aria-label="閉じる" className="-m-2 flex size-12 items-center justify-center" onClick={dismiss}><X className="size-5" /></button>
  </section>;
}

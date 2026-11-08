"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Check, CreditCard, ImagePlus, Loader2, Wallet, X } from "lucide-react";
import type { PayKind } from "./model";

// Burst capture: the camera stays open, every press of the shutter adds one receipt and starts reading it in the
// background, and "完了" opens them all for review. Falls back to the phone's camera app when live video isn't allowed.

const MAX_EDGE = 2000;
type Shot = { key: string; preview: string; state: "preparing" | "reading" | "ready" | "sending" };

// Once the live camera has been refused in this visit, go straight to the camera app instead of asking again.
let refused = false;
export const liveCameraAvailable = () => !refused && typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && window.isSecureContext;

export function ShutterScreen({ kind, cardLabel, shots, onShot, onSwitchKind, onDone, onClose, onFallback, onLibrary }: {
  kind: PayKind; cardLabel?: string; shots: Shot[]; onShot: (file: File) => void; onSwitchKind?: () => void;
  onDone: () => void; onClose: () => void; onFallback: () => void; onLibrary: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null), stream = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<"starting" | "live" | "blocked">("starting");
  const [flash, setFlash] = useState(false), [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!liveCameraAvailable()) { queueMicrotask(() => setStatus("blocked")); return; }
    navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } })
      .then(async (media) => {
        if (cancelled) { media.getTracks().forEach((track) => track.stop()); return; }
        stream.current = media;
        if (video.current) { video.current.srcObject = media; await video.current.play().catch(() => undefined); }
        setStatus("live");
      })
      .catch(() => { refused = true; if (!cancelled) setStatus("blocked"); });
    return () => { cancelled = true; stream.current?.getTracks().forEach((track) => track.stop()); stream.current = null; };
  }, []);

  const shoot = useCallback(async () => {
    const element = video.current;
    if (!element || status !== "live" || busy || element.readyState < 2 || !element.videoWidth) return;
    setBusy(true); setFlash(true); navigator.vibrate?.(15);
    window.setTimeout(() => setFlash(false), 140);
    try {
      const scale = Math.min(1, MAX_EDGE / Math.max(element.videoWidth, element.videoHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(element.videoWidth * scale); canvas.height = Math.round(element.videoHeight * scale);
      canvas.getContext("2d")?.drawImage(element, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
      if (blob) onShot(new File([blob], `receipt-${Date.now()}.jpg`, { type: "image/jpeg", lastModified: Date.now() }));
    } finally { setBusy(false); }
  }, [busy, onShot, status]);

  const count = shots.length, last = shots[shots.length - 1];
  const kindChip = cardLabel ? <button type="button" onClick={onSwitchKind} disabled={!onSwitchKind}
    className={`flex min-h-11 items-center gap-2 rounded-full px-3.5 text-sm font-bold ${kind === "card" ? "bg-white text-slate-950" : "bg-white/15 text-white"}`}>
    {kind === "card" ? <CreditCard className="size-4" /> : <Wallet className="size-4" />}{kind === "card" ? "会社カード" : "立替"}<span className="font-normal opacity-70">切替</span></button> : null;

  return <div className="fixed inset-0 z-40 flex flex-col bg-black text-white">
    <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)]">
      <button type="button" aria-label="撮影をやめる" onClick={onClose} className="flex size-14 items-center justify-center rounded-2xl active:bg-white/10"><X className="size-7" /></button>
      <p className="text-base font-bold" role="status">{count ? `${count}枚 撮影済み` : "領収書を撮影"}</p>
      <div className="flex min-w-14 justify-end">{kindChip}</div>
    </div>

    <div className="relative min-h-0 flex-1 overflow-hidden">
      <video ref={video} playsInline muted autoPlay className="absolute inset-0 size-full object-cover" aria-label="カメラの映像" />
      {status === "live" ? <>
        <div className="pointer-events-none absolute inset-x-6 bottom-10 top-6 rounded-3xl border-2 border-white/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.25)]" />
        <p className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-sm text-white/90">1枚ずつ枠に合わせて、続けて撮れます</p>
      </> : null}
      {status === "starting" ? <div className="absolute inset-0 flex items-center justify-center"><Loader2 className="size-10 animate-spin text-white/70" /></div> : null}
      {status === "blocked" ? <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8 text-center">
        <p className="text-lg font-bold">この画面ではカメラを使えません</p>
        <p className="text-[15px] text-white/75">ブラウザのカメラの許可がオフになっている可能性があります。カメラアプリで1枚ずつ撮るか、撮った写真から選べます。</p>
        <button type="button" onClick={onFallback} className="flex h-16 w-full items-center justify-center gap-2.5 rounded-[20px] bg-white text-lg font-bold text-slate-950"><Camera className="size-6" />カメラアプリで撮る</button>
        <button type="button" onClick={onLibrary} className="flex h-14 w-full items-center justify-center gap-2.5 rounded-[20px] border border-white/40 text-base"><ImagePlus className="size-5" />写真から選ぶ（複数可）</button>
      </div> : null}
      {flash ? <div className="pointer-events-none absolute inset-0 bg-white/70" /> : null}
    </div>

    {count ? <div className="flex gap-2 overflow-x-auto bg-black px-4 pt-3" aria-label="撮影した領収書">{shots.map((shot, index) => <span key={shot.key} className="relative size-14 shrink-0 overflow-hidden rounded-xl border border-white/30">
      {/* eslint-disable-next-line @next/next/no-img-element -- local preview of a photo just taken */}
      <img src={shot.preview} alt={`${index + 1}枚目`} className="size-full object-cover" />
      <span className="absolute bottom-0.5 right-0.5 flex size-5 items-center justify-center rounded-full bg-black/70">
        {shot.state === "ready" ? <Check className="size-3 text-emerald-300" strokeWidth={3} /> : <Loader2 className="size-3 animate-spin" />}</span>
    </span>)}</div> : null}

    <div className="grid grid-cols-3 items-center bg-black px-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-4">
      <span className="flex items-center">{last ? <span className="relative size-14 overflow-hidden rounded-xl border-2 border-white">
        {/* eslint-disable-next-line @next/next/no-img-element -- local preview of a photo just taken */}
        <img src={last.preview} alt="" className="size-full object-cover" />
        <span className="absolute -right-1 -top-1 flex size-6 items-center justify-center rounded-full bg-sky-500 text-xs font-bold">{count}</span></span> : null}</span>
      <span className="flex justify-center"><button type="button" aria-label="撮影する" onClick={() => void shoot()} disabled={status !== "live" || busy}
        className="flex size-[84px] items-center justify-center rounded-full border-[5px] border-white disabled:opacity-40"><span className="size-[66px] rounded-full bg-white active:scale-90 active:bg-white/80" /></button></span>
      <span className="flex justify-end"><button type="button" onClick={onDone} disabled={!count}
        className="flex h-14 min-w-[92px] items-center justify-center rounded-2xl bg-white px-4 text-lg font-bold text-slate-950 disabled:opacity-0">完了</button></span>
    </div>
  </div>;
}

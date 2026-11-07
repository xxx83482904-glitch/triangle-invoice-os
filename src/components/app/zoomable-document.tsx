"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronLeft, ChevronRight, LoaderCircle, Maximize, MoveHorizontal, RotateCw, ZoomIn, ZoomOut } from "lucide-react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { clampZoom, fitScale, nextZoomStep, ZOOM_MAX, ZOOM_MIN } from "@/lib/document-zoom";

type Size = { width: number; height: number };
type Fit = "width" | "page" | null;
const GAP = 12, PAD = 12;
// Large pages at high zoom would otherwise allocate huge canvases; past this the page is drawn softer, not bigger.
const MAX_CANVAS_PIXELS = 16_000_000;

let pdfjsLoader: Promise<typeof import("pdfjs-dist")> | null = null;
function loadPdfjs() {
  pdfjsLoader ??= import("pdfjs-dist").then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
    return pdfjs;
  });
  return pdfjsLoader;
}

// A PDF or image viewer with its own zoom, pan and paging, so it behaves the same on every browser and on phones.
// Zoom: buttons, Ctrl/⌘ + wheel or trackpad pinch, two-finger pinch on touch, double-click. Pan: drag with the mouse or scroll.
export function ZoomableDocument({ src, type, title, className, onFailed }: { src: string; type: string; title: string; className?: string; onFailed?: (reason: string) => void }) {
  const pdf = type === "application/pdf";
  const scroller = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<Size[]>([]);
  const [rotation, setRotation] = useState(0);
  const [scale, setScale] = useState(1), [fit, setFit] = useState<Fit>(pdf ? "width" : "page");
  const [page, setPage] = useState(1), [error, setError] = useState("");
  const pendingAnchor = useRef<{ x: number; y: number } | null>(null);
  const scaleRef = useRef(scale), renderedScale = useRef(scale);
  const failed = useRef(onFailed);
  useEffect(() => { failed.current = onFailed; }, [onFailed]);

  // Load: page sizes at 100% for PDFs, natural size for images.
  useEffect(() => {
    // Callers key this component by src, so a new document always starts from empty state.
    let active = true, loaded: PDFDocumentProxy | null = null;
    async function load() {
      try {
        if (!pdf) {
          const image = new Image();
          await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("画像を表示できませんでした。")); image.src = src; });
          if (active) setSizes([{ width: image.naturalWidth, height: image.naturalHeight }]);
          return;
        }
        const pdfjs = await loadPdfjs();
        const data = new Uint8Array(await (await fetch(src)).arrayBuffer());
        loaded = await pdfjs.getDocument({ data, cMapUrl: "/pdfjs/cmaps/", cMapPacked: true, standardFontDataUrl: "/pdfjs/standard_fonts/", wasmUrl: "/pdfjs/wasm/", isEvalSupported: false }).promise;
        const pages = await Promise.all(Array.from({ length: loaded.numPages }, async (_, index) => {
          const viewport = (await loaded!.getPage(index + 1)).getViewport({ scale: 1 });
          return { width: viewport.width, height: viewport.height };
        }));
        if (!active) return;
        setDoc(loaded); setSizes(pages);
      } catch (cause) {
        if (!active) return;
        const reason = cause instanceof Error && cause.name === "PasswordException" ? "パスワード付きのPDFは表示できません。原本を開いてください。" : "原本を表示できませんでした。原本を開くかダウンロードしてください。";
        setError(reason); failed.current?.(reason);
      }
    }
    void load();
    return () => { active = false; void loaded?.destroy(); };
  }, [src, pdf]);

  const rotated = useCallback((size: Size) => rotation % 180 ? { width: size.height, height: size.width } : size, [rotation]);

  // Keep a fit mode applied as the frame resizes or the document rotates.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element || !sizes.length || !fit) return;
    const apply = () => setScale(fitScale(fit, sizes.map(rotated), { width: element.clientWidth - PAD * 2, height: element.clientHeight - PAD * 2 }));
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(element);
    return () => observer.disconnect();
  }, [fit, sizes, rotated]);

  // Keep the point under the cursor or fingers still while zooming (several wheel events may land before one render).
  useLayoutEffect(() => {
    const element = scroller.current, anchor = pendingAnchor.current, ratio = scale / renderedScale.current;
    renderedScale.current = scale; scaleRef.current = scale; pendingAnchor.current = null;
    if (!element || !anchor || ratio === 1) return;
    element.scrollLeft = (element.scrollLeft + anchor.x) * ratio - anchor.x;
    element.scrollTop = (element.scrollTop + anchor.y) * ratio - anchor.y;
  }, [scale]);

  const zoomTo = useCallback((next: number, anchor?: { x: number; y: number }) => {
    const element = scroller.current, target = clampZoom(next);
    if (element) pendingAnchor.current = { x: anchor?.x ?? element.clientWidth / 2, y: anchor?.y ?? element.clientHeight / 2 };
    scaleRef.current = target;
    setScale(target); setFit(null);
  }, []);

  // Wheel and pinch need non-passive listeners to stop the browser zooming the whole page.
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    let pinch: { distance: number; scale: number } | null = null;
    const point = (x: number, y: number) => { const box = element.getBoundingClientRect(); return { x: x - box.left, y: y - box.top }; };
    const touches = (event: TouchEvent) => {
      const [a, b] = [event.touches[0], event.touches[1]];
      return { distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), center: point((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2) };
    };
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      zoomTo(scaleRef.current * Math.exp(-event.deltaY * 0.0025 * (event.deltaMode === 1 ? 16 : 1)), point(event.clientX, event.clientY));
    };
    const touchStart = (event: TouchEvent) => { if (event.touches.length === 2) pinch = { distance: touches(event).distance, scale: scaleRef.current }; };
    const touchMove = (event: TouchEvent) => {
      if (!pinch || event.touches.length !== 2) return;
      event.preventDefault();
      const { distance, center } = touches(event);
      zoomTo(pinch.scale * distance / pinch.distance, center);
    };
    const touchEnd = (event: TouchEvent) => { if (event.touches.length < 2) pinch = null; };
    element.addEventListener("wheel", wheel, { passive: false });
    element.addEventListener("touchstart", touchStart, { passive: true });
    element.addEventListener("touchmove", touchMove, { passive: false });
    element.addEventListener("touchend", touchEnd);
    element.addEventListener("touchcancel", touchEnd);
    return () => {
      element.removeEventListener("wheel", wheel); element.removeEventListener("touchstart", touchStart); element.removeEventListener("touchmove", touchMove);
      element.removeEventListener("touchend", touchEnd); element.removeEventListener("touchcancel", touchEnd);
    };
  }, [zoomTo]);

  // Mouse drag pans; touch keeps the browser's own one-finger scrolling.
  const drag = useRef<{ x: number; y: number; left: number; top: number; id: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  function pointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse" || event.button !== 0 || !scroller.current) return;
    drag.current = { x: event.clientX, y: event.clientY, left: scroller.current.scrollLeft, top: scroller.current.scrollTop, id: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId); setDragging(true);
  }
  function pointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (!start || start.id !== event.pointerId || !scroller.current) return;
    scroller.current.scrollLeft = start.left - (event.clientX - start.x);
    scroller.current.scrollTop = start.top - (event.clientY - start.y);
  }
  function pointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null; setDragging(false);
  }

  const boxes = sizes.map(rotated);
  const offsets = boxes.reduce<number[]>((list, box, index) => [...list, index ? list[index - 1] + boxes[index - 1].height * scale + GAP : PAD], []);
  function trackPage() {
    const element = scroller.current;
    if (!element || boxes.length < 2) return;
    const middle = element.scrollTop + element.clientHeight / 3;
    let current = 1;
    offsets.forEach((top, index) => { if (top <= middle) current = index + 1; });
    setPage(current);
  }
  function goTo(target: number) {
    const element = scroller.current, index = Math.min(Math.max(target, 1), boxes.length) - 1;
    if (!element || index < 0) return;
    element.scrollTo({ top: offsets[index] - PAD, behavior: "smooth" }); setPage(index + 1);
  }
  function keyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "+" || event.key === "=") { event.preventDefault(); zoomTo(nextZoomStep(scale, 1)); }
    else if (event.key === "-") { event.preventDefault(); zoomTo(nextZoomStep(scale, -1)); }
    else if (event.key === "0") { event.preventDefault(); setFit("width"); }
    else if (event.key === "PageDown" && boxes.length > 1) { event.preventDefault(); goTo(page + 1); }
    else if (event.key === "PageUp" && boxes.length > 1) { event.preventDefault(); goTo(page - 1); }
  }
  function doubleClick(event: React.MouseEvent<HTMLDivElement>) {
    const box = scroller.current?.getBoundingClientRect();
    if (!box) return;
    if (fit === "width" || scale < 1.5) zoomTo(Math.max(2, scale * 2), { x: event.clientX - box.left, y: event.clientY - box.top });
    else setFit(pdf ? "width" : "page");
  }

  const tool = "size-11 lg:size-8";
  const ready = sizes.length > 0;
  return <div className={cn("@container flex min-w-0 flex-col overflow-hidden rounded border bg-muted", className)}>
    <div role="toolbar" aria-label={`${title}の表示操作`} className="flex flex-wrap items-center gap-1 relative z-10 border-b bg-background px-2 py-1 text-xs">
      {boxes.length > 1 ? <><Button type="button" variant="ghost" size="icon" className={tool} aria-label="前のページ" title="前のページ（PageUp）" disabled={page <= 1} onClick={() => goTo(page - 1)}><ChevronLeft className="size-4" /></Button>
        <span className="min-w-12 text-center tabular-nums" aria-live="polite">{page} / {boxes.length}</span>
        <Button type="button" variant="ghost" size="icon" className={tool} aria-label="次のページ" title="次のページ（PageDown）" disabled={page >= boxes.length} onClick={() => goTo(page + 1)}><ChevronRight className="size-4" /></Button>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden /></> : null}
      <Button type="button" variant="ghost" size="icon" className={tool} aria-label="縮小" title="縮小（-）" disabled={!ready || scale <= ZOOM_MIN} onClick={() => zoomTo(nextZoomStep(scale, -1))}><ZoomOut className="size-4" /></Button>
      <Button type="button" variant="ghost" className="h-11 min-w-14 px-1 tabular-nums lg:h-8" title="100%で表示" disabled={!ready} onClick={() => zoomTo(1)}>{Math.round(scale * 100)}%</Button>
      <Button type="button" variant="ghost" size="icon" className={tool} aria-label="拡大" title="拡大（+）" disabled={!ready || scale >= ZOOM_MAX} onClick={() => zoomTo(nextZoomStep(scale, 1))}><ZoomIn className="size-4" /></Button>
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      <Button type="button" variant="ghost" size="icon" className={tool} aria-label="幅に合わせる" title="幅に合わせる（0）" aria-pressed={fit === "width"} disabled={!ready} onClick={() => setFit("width")}><MoveHorizontal className="size-4" /></Button>
      <Button type="button" variant="ghost" size="icon" className={tool} aria-label="全体を表示" title="全体を表示" aria-pressed={fit === "page"} disabled={!ready} onClick={() => setFit("page")}><Maximize className="size-4" /></Button>
      <Button type="button" variant="ghost" size="icon" className={tool} aria-label="右に回転" title="右に回転" disabled={!ready} onClick={() => setRotation((value) => (value + 90) % 360)}><RotateCw className="size-4" /></Button>
      <span className="ml-auto hidden text-muted-foreground @2xl:inline">Ctrl+ホイールで拡大・ドラッグで移動</span>
    </div>
    <div ref={scroller} tabIndex={0} role="region" aria-label={title} onScroll={trackPage} onKeyDown={keyDown} onDoubleClick={doubleClick}
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}
      className={cn("relative min-h-0 flex-1 overflow-auto overscroll-contain outline-none select-none focus-visible:ring-2 focus-visible:ring-ring", dragging ? "cursor-grabbing" : "cursor-grab")} style={{ touchAction: "pan-x pan-y" }}>
      {error ? <p role="alert" className="p-4 text-sm text-destructive">{error}</p>
        : !ready ? <p role="status" className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />原本を読み込み中…</p>
        : <div className="flex w-max min-w-full flex-col items-center" style={{ padding: PAD, gap: GAP }}>
          {boxes.map((box, index) => <div key={index} className="relative shrink-0 bg-white shadow-sm" style={{ width: box.width * scale, height: box.height * scale }}>
            {pdf && doc ? <PdfPage doc={doc} number={index + 1} scale={scale} rotation={rotation} root={scroller} label={`${title} ${index + 1}ページ`} />
              // eslint-disable-next-line @next/next/no-img-element
              : <img src={src} alt={title} draggable={false} className="absolute top-1/2 left-1/2 max-w-none" style={{ width: sizes[0].width * scale, height: sizes[0].height * scale, transform: `translate(-50%, -50%) rotate(${rotation}deg)` }} />}
          </div>)}
        </div>}
    </div>
  </div>;
}

// Draws one page once it is near the viewport, and again (after a short pause) when the zoom settles.
function PdfPage({ doc, number, scale, rotation, root, label }: { doc: PDFDocumentProxy; number: number; scale: number; rotation: number; root: React.RefObject<HTMLDivElement | null>; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(number <= 2);
  useEffect(() => {
    const element = canvas.current;
    if (!element || near) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry?.isIntersecting) { setNear(true); observer.disconnect(); } }, { root: root.current, rootMargin: "100% 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [near, root]);
  useEffect(() => {
    if (!near) return;
    let task: RenderTask | null = null, active = true;
    const timer = setTimeout(async () => {
      const element = canvas.current;
      if (!element) return;
      const pdfPage = await doc.getPage(number);
      if (!active) return;
      const base = pdfPage.getViewport({ scale, rotation: (pdfPage.rotate + rotation) % 360 });
      const density = Math.min(window.devicePixelRatio || 1, Math.sqrt(MAX_CANVAS_PIXELS / (base.width * base.height)));
      const viewport = pdfPage.getViewport({ scale: scale * density, rotation: (pdfPage.rotate + rotation) % 360 });
      // Draw off-screen, then swap, so the previous rendering stays visible (stretched) until the sharper one is ready.
      const buffer = document.createElement("canvas");
      buffer.width = Math.floor(viewport.width); buffer.height = Math.floor(viewport.height);
      task = pdfPage.render({ canvas: buffer, viewport });
      try { await task.promise; } catch { return; }
      if (!active) return;
      element.width = buffer.width; element.height = buffer.height;
      element.getContext("2d")?.drawImage(buffer, 0, 0);
    }, 120);
    return () => { active = false; clearTimeout(timer); task?.cancel(); };
  }, [doc, number, scale, rotation, near]);
  return <canvas ref={canvas} role="img" aria-label={label} className="absolute inset-0 h-full w-full" />;
}

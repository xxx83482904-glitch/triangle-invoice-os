"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// An embedded PDF takes focus when it loads and the browser then scrolls the whole page to it.
// Mounting it only once it is on screen leaves the page where the reader put it.
// Below md the holder is not rendered, so it never intersects and phones never load the PDF.
export function OnScreenPdfFrame({ title, src, className, onError }: { title: string; src: string; className?: string; onError?: () => void }) {
  const holder = useRef<HTMLDivElement>(null);
  const [onScreen, setOnScreen] = useState(false);
  useEffect(() => {
    const element = holder.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      setOnScreen(true);
      observer.disconnect();
    }, { threshold: 0.5 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <div ref={holder} className={cn("hidden overflow-hidden md:block", className)}>
    {onScreen ? <iframe title={title} src={src} onError={onError} className="h-full w-full" /> : null}
  </div>;
}

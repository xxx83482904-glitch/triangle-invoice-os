"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Hand, LockKeyhole, RotateCw, Tablet, X } from "lucide-react";
import { ArtImage } from "./media-assets";
import { stageGroups } from "./cooking-guidance";
import type { Process } from "./cooking-model";
import s from "./kitchen.module.css";
export function Action({
  children,
  onClick,
  locked = false,
  color = "pink",
  className = "",
}: {
  children: ReactNode;
  onClick: () => void;
  locked?: boolean;
  color?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={[s.action, s[color], className].join(" ")}
      aria-disabled={locked || undefined}
      onClick={onClick}
    >
      {locked ? <LockKeyhole /> : null}
      {children}
    </button>
  );
}
export function StepPictures({
  process,
  value,
}: {
  process: Process;
  value: number;
}) {
  const { icons, active } = stageGroups(process, value);
  return (
    <ol className={s.steps} aria-label="つくりかた">
      {icons.map((name, i) => (
        <li key={i} aria-current={i === active ? "step" : undefined}>
          <b>{i < active ? <Check /> : i + 1}</b>
          <ArtImage name={name} />
        </li>
      ))}
    </ol>
  );
}
export function Confetti() {
  return (
    <div className={s.confetti} aria-hidden="true">
      {Array.from({ length: 24 }, (_, i) => (
        <i
          key={i}
          style={{
            left: 3 + i * 4 + "%",
            background: ["#ffca33", "#159de9", "#f65182", "#32b66c", "#ff823c"][
              i % 5
            ],
            animationDelay: (i % 6) * 0.08 + "s",
            rotate: i * 23 + "deg",
          }}
        />
      ))}
    </div>
  );
}
export function ParentGate({
  onOpen,
  onClose,
}: {
  onOpen: () => void;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState(0);
  const frame = useRef(0),
    start = useRef(0),
    button = useRef<HTMLButtonElement>(null);
  const cancel = () => {
    cancelAnimationFrame(frame.current);
    start.current = 0;
    setAmount(0);
  };
  const begin = () => {
    if (start.current) return;
    start.current = performance.now();
    const tick = () => {
      const value = (performance.now() - start.current) / 3000;
      setAmount(Math.min(1, value));
      if (value >= 1) {
        start.current = 0;
        onOpen();
      } else frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  };
  useEffect(() => {
    button.current?.focus();
    return () => cancelAnimationFrame(frame.current);
  }, []);
  return (
    <div
      className={s.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="おうちの かたへ"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
        if (e.key === "Tab") {
          e.preventDefault();
          const list =
            e.currentTarget.querySelectorAll<HTMLButtonElement>("button");
          (document.activeElement === list[0] ? list[1] : list[0])?.focus();
        }
      }}
    >
      <div className={s.gate}>
        <button className={s.close} onClick={onClose} aria-label="とじる">
          <X />
        </button>
        <h2>おうちの かたへ</h2>
        <p>かぎを 3びょう ながおし</p>
        <button
          ref={button}
          className={s.hold}
          data-hold
          style={{
            background:
              "conic-gradient(#ffca33 " + amount * 360 + "deg,#edf5fa 0)",
          }}
          aria-label="3びょう ながおし"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            begin();
          }}
          onPointerUp={cancel}
          onPointerCancel={cancel}
          onLostPointerCapture={cancel}
          onKeyDown={(e) => {
            if (e.key === " " || e.key === "Enter") {
              e.preventDefault();
              begin();
            }
          }}
          onKeyUp={cancel}
          onBlur={cancel}
        >
          <LockKeyhole />
          <span>{Math.min(3, Math.floor(amount * 3))} / 3</span>
        </button>
      </div>
    </div>
  );
}
export function RotateOverlay() {
  return (
    <div className={s.rotateOverlay} role="status">
      <div className={s.turnTablet}>
        <Tablet />
        <RotateCw />
      </div>
      <p>よこに してね</p>
      <span>おおきな がめんで あそぼう</span>
    </div>
  );
}
export function EntryHand({ className = "" }: { className?: string }) {
  return (
    <span className={[s.entryHand, className].join(" ")} aria-hidden="true">
      <Hand fill="#fff3db" />
    </span>
  );
}

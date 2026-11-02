"use client";

import type { ReactNode } from "react";

export type TabOption<T extends string = string> = readonly [value: T, label: ReactNode, disabled?: boolean];

export function OptionTabs<T extends string>({ label, caption, value, options, name, disabled, onChange }: {
  label: string; caption?: string; value: T; options: readonly TabOption<T>[]; name?: string; disabled?: boolean; onChange: (value: T) => void;
}) {
  return <div className="option-tabs">
    {caption ? <span className="option-tabs-caption">{caption}</span> : null}
    <div role="group" aria-label={label} className="workspace-segmented">
      {options.map(([option, text, off]) => <button type="button" key={option} aria-pressed={value === option} disabled={disabled || off} onClick={() => onChange(option)}>{text}</button>)}
    </div>
    {name ? <input type="hidden" name={name} value={value} /> : null}
  </div>;
}

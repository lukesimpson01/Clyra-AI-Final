// Small form controls shared by the Shorts inspector. Each one reports a value
// and nothing else; the caller decides which schema field it writes.

import type { ReactNode } from "react";

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="sh-field">
      <span className="sh-label">{label}</span>
      {children}
      {hint ? <p className="sh-hint">{hint}</p> : null}
    </div>
  );
}

export function TextInput({ value, onChange, placeholder, readOnly }: { value: string; onChange: (value: string) => void; placeholder?: string; readOnly?: boolean }) {
  return <input className="sh-input" value={value} placeholder={placeholder} readOnly={readOnly} onChange={(event) => onChange(event.target.value)} />;
}

export function TextArea({ value, onChange, rows = 3 }: { value: string; onChange: (value: string) => void; rows?: number }) {
  return <textarea className="sh-textarea" rows={rows} value={value} onChange={(event) => onChange(event.target.value)} />;
}

export function Segmented({ value, options, onChange }: { value: string; options: Array<[string, string]>; onChange: (value: string) => void }) {
  return (
    <div className="sh-segmented" role="group" style={{ flexWrap: "wrap" }}>
      {options.map(([optionValue, label]) => (
        <button key={optionValue} type="button" aria-pressed={value === optionValue} onClick={() => onChange(optionValue)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function Slider({ min, max, step = 1, value, onChange, format }: { min: number; max: number; step?: number; value: number; onChange: (value: number) => void; format?: (value: number) => string }) {
  return (
    <div className="sh-row" style={{ gap: 10 }}>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} aria-label={format ? format(value) : String(value)} style={{ flex: 1, accentColor: "var(--sh-blue)" }} />
      <span className="sh-muted" style={{ fontSize: 12, minWidth: 48, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{format ? format(value) : value}</span>
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="sh-switch" onClick={() => onChange(!checked)} />;
}

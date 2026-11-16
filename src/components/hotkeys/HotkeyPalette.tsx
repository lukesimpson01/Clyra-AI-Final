import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getElectronDesktop, type HotkeyEntry } from "../../lib/electron-runtime";
import "./hotkeys.css";

const IS_MAC = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

/** `Alt+Command+N` → the symbols a person reads: ⌥⌘N. */
export function formatAccelerator(accelerator: string): string[] {
  if (!accelerator) return [];
  if (!/[+]/.test(accelerator) && /\s/.test(accelerator)) return [accelerator];
  const names: Record<string, string> = IS_MAC
    ? { CommandOrControl: "⌘", Command: "⌘", Cmd: "⌘", Control: "⌃", Ctrl: "⌃", Alt: "⌥", Option: "⌥", Shift: "⇧", Super: "⌘", Escape: "Esc", Return: "↩", Enter: "↩", Backspace: "⌫", Delete: "⌦", Up: "↑", Down: "↓", Left: "←", Right: "→", Space: "Space", Tab: "⇥" }
    : { CommandOrControl: "Ctrl", Command: "Win", Cmd: "Win", Control: "Ctrl", Ctrl: "Ctrl", Alt: "Alt", Option: "Alt", Shift: "Shift", Super: "Win", Escape: "Esc", Return: "Enter", Enter: "Enter", Space: "Space" };
  const order = ["Control", "Ctrl", "Alt", "Option", "Shift", "Command", "Cmd", "CommandOrControl", "Super"];
  const parts = accelerator.split("+");
  const mods = parts.filter((part) => order.includes(part)).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const keys = parts.filter((part) => !order.includes(part));
  return [...mods, ...keys].map((part) => names[part] ?? part.toUpperCase());
}

const CODE_KEYS: Record<string, string> = {
  Slash: "/", Comma: ",", Period: ".", Semicolon: ";", Quote: "'", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Minus: "-", Equal: "=", Backquote: "`",
  Space: "Space", Escape: "Escape", Enter: "Return", NumpadEnter: "Return", Tab: "Tab", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
  Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown",
};

/** A key press as an Electron accelerator, or null while only modifiers are held. */
export function toAccelerator(event: KeyboardEvent): string | null {
  const mods: string[] = [];
  if (event.metaKey) mods.push(IS_MAC ? "Command" : "Super");
  if (event.ctrlKey) mods.push("Control");
  if (event.altKey) mods.push("Alt");
  if (event.shiftKey) mods.push("Shift");
  let key = CODE_KEYS[event.code];
  if (!key && /^Key[A-Z]$/.test(event.code)) key = event.code.slice(3);
  if (!key && /^Digit\d$/.test(event.code)) key = event.code.slice(5);
  if (!key && /^F\d{1,2}$/.test(event.code)) key = event.code;
  if (!key) return null;
  if (!mods.length && !/^F\d/.test(key)) return null; // a bare letter would steal typing everywhere
  return [...mods, key].join("+");
}

type Draft = { id: string; error?: string };

/** The palette of every hotkey: opens smoothly, and lets each one be re-recorded by pressing on it and then the new keys. */
export function HotkeyPalette() {
  const desktop = getElectronDesktop()?.hotkeys;
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<HotkeyEntry[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [recording, setRecording] = useState<Draft | null>(null);
  const recordingRef = useRef<Draft | null>(null);
  recordingRef.current = recording;

  const refresh = useCallback(async () => {
    const result = await desktop?.list().catch(() => null);
    if (result?.ok) { setEntries(result.hotkeys); setGroups(result.groups); }
  }, [desktop]);

  useEffect(() => {
    const toggle = () => setOpen((value) => !value);
    window.addEventListener("clyra:hotkeys-open", toggle);
    const off = desktop?.onOpen(toggle);
    return () => { window.removeEventListener("clyra:hotkeys-open", toggle); off?.(); };
  }, [desktop]);

  useEffect(() => { if (open) { void refresh(); setQuery(""); } else { setRecording(null); } }, [open, refresh]);

  const stopRecording = useCallback(() => { setRecording(null); void desktop?.suspend(false); }, [desktop]);
  const startRecording = useCallback((id: string) => { setRecording({ id }); void desktop?.suspend(true); }, [desktop]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      const active = recordingRef.current;
      if (!active) { if (event.key === "Escape") setOpen(false); return; }
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") { stopRecording(); return; }
      if (event.key === "Backspace" || event.key === "Delete") {
        void desktop?.set(active.id, "").then((result) => { if (result?.ok) { setEntries(result.hotkeys ?? []); stopRecording(); } });
        return;
      }
      const accelerator = toAccelerator(event);
      if (!accelerator) return;
      void desktop?.set(active.id, accelerator).then((result) => {
        if (result?.ok) { setEntries(result.hotkeys ?? []); stopRecording(); } else setRecording({ id: active.id, error: result?.error || "That combination can't be used." });
      });
    };
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("keydown", onKey, true); };
  }, [open, desktop, stopRecording]);

  useEffect(() => () => { void desktop?.suspend(false); }, [desktop]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((entry) => !q || entry.label.toLowerCase().includes(q) || entry.group.toLowerCase().includes(q) || entry.accelerator.toLowerCase().includes(q));
  }, [entries, query]);

  if (!desktop) return null;
  return (
    <AnimatePresence>
      {open ? (
        <motion.div className="clyra-hk" role="dialog" aria-modal="true" aria-label="Hotkeys" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0.01 : 0.18 }}
          onMouseDown={(event) => { if (event.target === event.currentTarget) { if (recording) stopRecording(); setOpen(false); } }}>
          <motion.div className="clyra-hk__panel" initial={reduced ? false : { opacity: 0, y: 14, scale: 0.975 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={reduced ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.985 }} transition={{ type: "spring", stiffness: 380, damping: 34, mass: 0.9 }}>
            <header className="clyra-hk__head">
              <h2>Hotkeys</h2>
              <input className="clyra-hk__search" placeholder="Search" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search hotkeys" autoFocus />
              <button type="button" className="clyra-hk__close" onClick={() => setOpen(false)} aria-label="Close">Esc</button>
            </header>
            <p className="clyra-hk__hint">Press a hotkey to change it, then press the new keys. Backspace turns it off, Esc cancels.</p>
            <div className="clyra-hk__body">
              {groups.map((group) => {
                const rows = shown.filter((entry) => entry.group === group);
                if (!rows.length) return null;
                return (
                  <section key={group} className="clyra-hk__group">
                    <h3>{group}</h3>
                    {rows.map((entry) => {
                      const isRecording = recording?.id === entry.id;
                      const keys = formatAccelerator(entry.accelerator);
                      const changed = entry.editable && entry.accelerator !== entry.default;
                      return (
                        <div key={entry.id} className={`clyra-hk__row${isRecording ? " is-recording" : ""}${entry.active ? "" : " is-off"}`}>
                          <div className="clyra-hk__label">
                            <span>{entry.label}</span>
                            {isRecording && recording?.error ? <small className="clyra-hk__error">{recording.error}</small> : entry.note ? <small>{entry.note}</small> : !entry.active ? <small>Taken by another app</small> : null}
                          </div>
                          {changed && !isRecording ? <button type="button" className="clyra-hk__reset" onClick={() => void desktop?.reset(entry.id).then((r) => r?.ok && setEntries(r.hotkeys ?? []))}>Reset</button> : null}
                          <button type="button" className="clyra-hk__keys" disabled={!entry.editable} onClick={() => (isRecording ? stopRecording() : startRecording(entry.id))} aria-label={`${entry.label}: ${keys.join(" ") || "off"}. Press to change`}>
                            {isRecording ? <span className="clyra-hk__press">Press the new keys…</span> : keys.length ? keys.map((key, index) => <kbd key={`${key}-${index}`}>{key}</kbd>) : <span className="clyra-hk__off">Off</span>}
                          </button>
                        </div>
                      );
                    })}
                  </section>
                );
              })}
              {!shown.length ? <p className="clyra-hk__empty">No hotkeys match “{query}”.</p> : null}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

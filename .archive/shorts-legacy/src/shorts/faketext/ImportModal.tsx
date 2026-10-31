import { useMemo, useState } from "react";
import { FileDown, X } from "lucide-react";

type Parsed = { side: "left" | "right"; text: string };

/** "Jake: hello" / "You: hey bro" transcript syntax. Any line whose speaker is "you" becomes the user side; everything else is the contact. */
function parseTranscript(raw: string): Parsed[] {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const out: Parsed[] = [];
  for (const line of lines) {
    const match = line.match(/^([^:]{1,40}):\s*(.+)$/);
    if (!match) continue;
    const speaker = match[1].trim().toLowerCase();
    const text = match[2].trim();
    if (!text) continue;
    out.push({ side: speaker === "you" ? "right" : "left", text: text.slice(0, 500) });
  }
  return out;
}

function parseJson(raw: string): Parsed[] | null {
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return null;
    const out: Parsed[] = [];
    for (const entry of value) {
      if (!entry || typeof entry !== "object") continue;
      const record = entry as Record<string, unknown>;
      const text = String(record.text ?? "").trim();
      if (!text) continue;
      const side = record.side === "right" || String(record.sender || "").toLowerCase() === "you" ? "right" : "left";
      out.push({ side, text: text.slice(0, 500) });
    }
    return out.length ? out : null;
  } catch {
    return null;
  }
}

function parseCsv(raw: string): Parsed[] | null {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 1) return null;
  const header = lines[0].toLowerCase().split(",").map((cell) => cell.trim());
  const senderIndex = header.findIndex((cell) => cell === "sender" || cell === "side" || cell === "speaker");
  const textIndex = header.findIndex((cell) => cell === "text" || cell === "message");
  if (senderIndex < 0 || textIndex < 0) return null;
  const out: Parsed[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    const sender = (cells[senderIndex] || "").trim().toLowerCase();
    const text = cells.slice(textIndex).join(",").trim().replace(/^"|"$/g, "");
    if (!text) continue;
    out.push({ side: sender === "you" || sender === "right" ? "right" : "left", text: text.slice(0, 500) });
  }
  return out.length ? out : null;
}

function parseAny(raw: string): { parsed: Parsed[]; format: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { parsed: [], format: "" };
  const json = trimmed.startsWith("[") ? parseJson(trimmed) : null;
  if (json) return { parsed: json, format: "JSON" };
  const csv = trimmed.includes(",") && /sender|side|speaker/i.test(trimmed.split(/\r?\n/)[0] || "") ? parseCsv(trimmed) : null;
  if (csv) return { parsed: csv, format: "CSV" };
  return { parsed: parseTranscript(trimmed), format: "Transcript" };
}

export function ImportModal({ onClose, onApply }: { onClose: () => void; onApply: (messages: Parsed[]) => void }) {
  const [raw, setRaw] = useState("");
  const { parsed, format } = useMemo(() => parseAny(raw), [raw]);

  return (
    <div className="ft-modal-overlay" onClick={onClose}>
      <div className="ft-modal" onClick={(event) => event.stopPropagation()}>
        <div className="ft-modal-header">
          <FileDown size={17} strokeWidth={2} color="var(--ft-blue)" />
          <span className="ft-modal-title">Import</span>
          <button type="button" className="ft-icon-btn" onClick={onClose} aria-label="Close"><X size={16} strokeWidth={2} /></button>
        </div>
        <div className="ft-modal-body">
          <p style={{ margin: "0 0 10px", fontSize: 12.5, color: "var(--ft-ink-2)", lineHeight: 1.5 }}>
            Paste a transcript (<code>Jake: hello</code> / <code>You: hey bro</code>), a JSON array of <code>{"{ side, text }"}</code>, or CSV with <code>sender,text</code> columns. Format is detected automatically.
          </p>
          <textarea
            className="ft-textarea"
            rows={10}
            placeholder={"Jake: hello\nYou: hey bro\nJake: nothing much\nYou: what is going on?"}
            value={raw}
            onChange={(event) => setRaw(event.target.value.slice(0, 20_000))}
            style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12.5 }}
          />
          <div style={{ marginTop: 10, fontSize: 12, color: "var(--ft-ink-3)" }}>
            {raw.trim() ? `${format || "No match"} · ${parsed.length} message${parsed.length === 1 ? "" : "s"} detected` : "Nothing pasted yet"}
          </div>
        </div>
        <div className="ft-modal-footer">
          <button type="button" className="ft-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="ft-btn ft-btn--primary" disabled={!parsed.length} onClick={() => onApply(parsed)}>
            Add {parsed.length || ""} message{parsed.length === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </div>
  );
}

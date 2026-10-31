import { useState } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import { shortsApi } from "../api";

const TONES = ["drama", "funny", "scary", "wholesome", "relationship", "confession", "mystery"];

type GeneratedMessage = { side: "left" | "right"; text: string; reaction?: string };

export function AIWriterModal({ contactName, onClose, onApply }: {
  contactName: string;
  onClose: () => void;
  onApply: (contactName: string, messages: GeneratedMessage[]) => void;
}) {
  const [idea, setIdea] = useState("");
  const [tone, setTone] = useState("drama");
  const [count, setCount] = useState(8);
  const [relationship, setRelationship] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noKey, setNoKey] = useState(false);

  const generate = async () => {
    if (!idea.trim()) {
      setError("Describe the story first.");
      return;
    }
    setBusy(true);
    setError(null);
    setNoKey(false);
    try {
      const result = await shortsApi.generate({ kind: "fake-text", prompt: idea.trim(), tone, count, relationship: relationship.trim() || undefined });
      const script = result.script as { kind: "fake-text"; participants: string[]; messages: GeneratedMessage[] };
      const messages = (script.messages || []).map((message) => ({ side: message.side, text: message.text, reaction: message.reaction }));
      const leftSender = script.messages.find((message) => message.side === "left") as (GeneratedMessage & { sender?: string }) | undefined;
      const name = (leftSender as any)?.sender || script.participants?.[0] || contactName;
      onApply(name, messages);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not write the conversation.";
      setError(message);
      setNoKey(/DeepSeek key/i.test(message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ft-modal-overlay" onClick={onClose}>
      <div className="ft-modal" onClick={(event) => event.stopPropagation()}>
        <div className="ft-modal-header">
          <Sparkles size={17} strokeWidth={2} color="var(--ft-blue)" />
          <span className="ft-modal-title">AI Writer</span>
          <button type="button" className="ft-icon-btn" onClick={onClose} aria-label="Close"><X size={16} strokeWidth={2} /></button>
        </div>
        <div className="ft-modal-body">
          <div className="ft-section">
            <div className="ft-field-label">Story idea</div>
            <textarea className="ft-textarea" rows={3} placeholder="Girl finds out boyfriend is cheating" value={idea} onChange={(event) => setIdea(event.target.value.slice(0, 1200))} />
          </div>
          <div className="ft-control-grid ft-section">
            <div>
              <div className="ft-field-label">Tone</div>
              <select className="ft-select" value={tone} onChange={(event) => setTone(event.target.value)}>
                {TONES.map((value) => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <div className="ft-field-label">Number of messages</div>
              <div className="ft-slider-row">
                <input type="range" min={4} max={24} value={count} onChange={(event) => setCount(Number(event.target.value))} />
                <span className="ft-slider-value">{count}</span>
              </div>
            </div>
          </div>
          <div className="ft-section">
            <div className="ft-field-label">Relationship between characters</div>
            <input className="ft-input" placeholder="Roommates, siblings, coworkers…" value={relationship} onChange={(event) => setRelationship(event.target.value.slice(0, 200))} />
          </div>
          {error ? (
            <div className="ft-notice error">
              {error}
              {noKey ? <div style={{ marginTop: 4 }}>You can still write the conversation by hand in the Script tab.</div> : null}
            </div>
          ) : null}
        </div>
        <div className="ft-modal-footer">
          <button type="button" className="ft-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="ft-btn ft-btn--primary" onClick={() => void generate()} disabled={busy}>
            {busy ? <Loader2 size={14} className="ft-spin" style={{ animation: "ft-spin 1s linear infinite" }} /> : <Sparkles size={14} strokeWidth={2} />}
            {busy ? "Writing…" : "Generate"}
          </button>
        </div>
      </div>
    </div>
  );
}

import { useState } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import { shortsApi } from "../api";
import type { ChoiceItem } from "../../../lib/shorts/schema";

const MODES = [["classic", "Classic"], ["funny", "Funny"], ["impossible", "Impossible"], ["relationship", "Relationship"], ["gaming", "Gaming"], ["food", "Food"], ["dark-humour", "Dark humour"]] as const;

export function AIWriterModal({ onClose, onApply }: { onClose: () => void; onApply: (questions: ChoiceItem[]) => void }) {
  const [idea, setIdea] = useState("");
  const [mode, setMode] = useState<(typeof MODES)[number][0]>("classic");
  const [count, setCount] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noKey, setNoKey] = useState(false);

  const generate = async () => {
    if (!idea.trim()) {
      setError("Describe the round of questions first.");
      return;
    }
    setBusy(true);
    setError(null);
    setNoKey(false);
    try {
      const result = await shortsApi.generate({ kind: "would-rather", prompt: idea.trim(), mode, count });
      const questions = (result.items || []).filter((item): item is ChoiceItem => item.type === "choice");
      if (!questions.length) throw new Error("No questions came back. Try rephrasing the idea.");
      onApply(questions);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not write the questions.";
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
            <div className="ft-field-label">Round idea</div>
            <textarea className="ft-textarea" rows={3} placeholder="Impossible money and fame dilemmas" value={idea} onChange={(event) => setIdea(event.target.value.slice(0, 600))} />
          </div>
          <div className="ft-control-grid ft-section">
            <div>
              <div className="ft-field-label">Mode</div>
              <select className="ft-select" value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}>
                {MODES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <div>
              <div className="ft-field-label">Number of questions</div>
              <div className="ft-slider-row">
                <input type="range" min={2} max={10} value={count} onChange={(event) => setCount(Number(event.target.value))} />
                <span className="ft-slider-value">{count}</span>
              </div>
            </div>
          </div>
          {error ? (
            <div className="ft-notice error">
              {error}
              {noKey ? <div style={{ marginTop: 4 }}>You can still write questions by hand in the Questions tab.</div> : null}
            </div>
          ) : null}
        </div>
        <div className="ft-modal-footer">
          <button type="button" className="ft-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="ft-btn ft-btn--primary" onClick={() => void generate()} disabled={busy}>
            {busy ? <Loader2 size={14} style={{ animation: "ft-spin 1s linear infinite" }} /> : <Sparkles size={14} strokeWidth={2} />}
            {busy ? "Writing…" : "Generate"}
          </button>
        </div>
      </div>
    </div>
  );
}

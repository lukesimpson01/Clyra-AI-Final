import { useState, type CSSProperties } from "react";
import { Trash2, Wand2 } from "lucide-react";
import type { ChoiceItem, ShortsProject } from "../../../lib/shorts/schema";
import { addItem, deleteItems } from "../../../lib/shorts/ops";
import { AIWriterModal } from "./AIWriterModal";

type Props = {
  project: ShortsProject;
  onUpdate: (updater: (prev: ShortsProject) => ShortsProject) => void;
  onJumpTime: (ms: number) => void;
};

export function ScriptTab({ project, onUpdate, onJumpTime }: Props) {
  const [aiWriterOpen, setAiWriterOpen] = useState(false);
  const questions = project.items.filter((item): item is ChoiceItem => item.type === "choice");

  const patch = (id: string, value: Partial<ChoiceItem>) => {
    onUpdate((prev) => ({ ...prev, items: prev.items.map((item) => (item.id === id && item.type === "choice" ? { ...item, ...value } : item)) }));
  };

  const addQuestion = () => {
    onUpdate((prev) => addItem(prev, "choice").project);
  };

  const removeQuestion = (id: string) => {
    onUpdate((prev) => deleteItems(prev, [id], true));
  };

  const applyGenerated = (generated: ChoiceItem[]) => {
    onUpdate((prev) => {
      const otherItems = prev.items.filter((item) => item.type !== "choice");
      let startMs = 0;
      const built: ChoiceItem[] = generated.map((entry) => {
        const item: ChoiceItem = { ...entry, id: `wyr-gen-${Date.now().toString(36)}-${startMs}`, startMs };
        startMs += entry.durationMs;
        return item;
      });
      return { ...prev, items: [...otherItems, ...built] };
    });
  };

  return (
    <>
      <div className="ft-panel-header">
        <span className="ft-panel-title">Questions</span>
        <div className="ft-panel-header-spacer" />
        <span className="wyr-count">{questions.length} question{questions.length === 1 ? "" : "s"}</span>
        <button type="button" className="ft-btn ft-btn--sm ft-btn--primary" onClick={() => setAiWriterOpen(true)}><Wand2 size={13} strokeWidth={2} /> AI Writer</button>
      </div>
      <div className="ft-panel-body">
        {questions.length === 0 ? <p className="ft-empty" style={{ padding: "18px 0" }}>No questions yet. Add one below, or use AI Writer.</p> : null}
        <div className="wyr-question-list">
          {questions.map((question, index) => (
            <QuestionCard
              key={question.id}
              index={index}
              question={question}
              onChange={(value) => patch(question.id, value)}
              onDelete={() => removeQuestion(question.id)}
              onJump={() => onJumpTime(question.startMs)}
            />
          ))}
        </div>
        <button type="button" className="ft-add-btn" onClick={addQuestion}>+ Add Question</button>
      </div>

      {aiWriterOpen ? (
        <AIWriterModal
          onClose={() => setAiWriterOpen(false)}
          onApply={(generated) => {
            if (questions.length > 0 && !window.confirm(`Replace the ${questions.length} existing question(s) with the generated set?`)) return;
            applyGenerated(generated);
            setAiWriterOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

function QuestionCard({ index, question, onChange, onDelete, onJump }: {
  index: number;
  question: ChoiceItem;
  onChange: (value: Partial<ChoiceItem>) => void;
  onDelete: () => void;
  onJump: () => void;
}) {
  return (
    <div className="wyr-question-card" onClick={onJump}>
      <div className="wyr-question-top">
        <span>Question {index + 1}</span>
        <span className="wyr-q-number">{String(index + 1).padStart(2, "0")}</span>
      </div>
      <div className="wyr-question-line">
        <label className="wyr-choice-field" onClick={(event) => event.stopPropagation()}>
          <span className="wyr-dot red" aria-hidden />
          <input value={question.left} placeholder="Top option" onChange={(event) => onChange({ left: event.target.value.slice(0, 90) })} aria-label="Top option" />
        </label>
        <label className="wyr-choice-field" onClick={(event) => event.stopPropagation()}>
          <span className="wyr-dot blue" aria-hidden />
          <input value={question.right} placeholder="Bottom option" onChange={(event) => onChange({ right: event.target.value.slice(0, 90) })} aria-label="Bottom option" />
        </label>
        <button type="button" className="ft-row-icon-btn wyr-question-trash" onClick={(event) => { event.stopPropagation(); onDelete(); }} aria-label={`Delete question ${index + 1}`}>
          <Trash2 size={16} strokeWidth={1.8} />
        </button>
      </div>
      <div className="wyr-question-more" onClick={(event) => event.stopPropagation()}>
        <div className="wyr-vote-slider-wrap">
          <div className="wyr-vote-labels">
            <span className="option-a"><i /> A <b>{question.leftPercent}%</b></span>
            <span className="option-b">B <b>{100 - question.leftPercent}%</b><i /></span>
          </div>
          <input
            type="range"
            min={5}
            max={95}
            value={question.leftPercent}
            style={{ "--wyr-fill": `${question.leftPercent}%` } as CSSProperties}
            onChange={(event) => onChange({ leftPercent: Number(event.target.value) })}
            aria-label="Option A votes percentage"
          />
        </div>
      </div>
      <div className="wyr-question-more" style={{ marginTop: 8 }} onClick={(event) => event.stopPropagation()}>
        <span className="wyr-vote-descriptor" style={{ marginRight: "auto" }}>Countdown before results</span>
        <div className="wyr-percent-control" style={{ width: "auto", paddingRight: 14 }}>
          <input
            type="number"
            min={2}
            max={10}
            value={question.countdownSeconds}
            onChange={(event) => onChange({ countdownSeconds: Math.max(2, Math.min(10, Number(event.target.value) || 5)) })}
            aria-label="Countdown seconds"
            style={{ width: 30 }}
          />
          <span>s</span>
        </div>
      </div>
    </div>
  );
}

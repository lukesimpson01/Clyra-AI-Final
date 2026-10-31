import { Archive, Check, Copy, MessageCircleDashed, MoreHorizontal, RotateCcw, Square, Volume2 } from "lucide-react";
import { ChatMenu } from "./Menu";
import { setActivityDetail, useActivityDetail } from "./detail";

/** Under a finished reply: Copy, Retry, More. Only actions the backend really performs. */
export function MessageActions({
  onCopy,
  onRegenerate,
  onReadAloud,
  onBranch,
  onExport,
  copied,
  isReading,
}: {
  onCopy: () => void;
  onRegenerate: () => void;
  onReadAloud: () => void;
  onBranch: () => void;
  onExport: () => void;
  copied: boolean;
  isReading: boolean;
}) {
  const detail = useActivityDetail();
  return (
    <div className="clyra-ai-actions" role="toolbar" aria-label="Response actions">
      <button type="button" className="clyra-ai-action" onClick={onCopy} data-tip={copied ? "Copied" : "Copy"} aria-label={copied ? "Response copied" : "Copy response"}>
        {copied ? <Check /> : <Copy />}
      </button>
      <button type="button" className="clyra-ai-action" onClick={onRegenerate} data-tip="Retry" aria-label="Retry response">
        <RotateCcw />
      </button>
      <ChatMenu
        label="More response actions"
        items={[
          { label: isReading ? "Stop reading" : "Read aloud", icon: isReading ? <Square /> : <Volume2 />, onSelect: onReadAloud },
          { label: "Continue in a new chat", icon: <MessageCircleDashed />, onSelect: onBranch },
          { label: "Export conversation", icon: <Archive />, onSelect: onExport },
          { kind: "separator" },
          { kind: "label", label: "Activity detail" },
          { label: "Compact", checked: detail === "compact", onSelect: () => setActivityDetail("compact") },
          { label: "Normal", checked: detail === "normal", onSelect: () => setActivityDetail("normal") },
          { label: "Detailed", checked: detail === "detailed", onSelect: () => setActivityDetail("detailed") },
        ]}
        trigger={(props) => (
          <button type="button" className="clyra-ai-action" data-tip="More" aria-label="More response actions" {...props}>
            <MoreHorizontal />
          </button>
        )}
      />
    </div>
  );
}

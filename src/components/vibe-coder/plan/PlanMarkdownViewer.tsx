import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { VibePlan } from "../../../../types/vibe-plan";

interface PlanMarkdownViewerProps {
  plan: any;
}

export function PlanMarkdownViewer({ plan }: PlanMarkdownViewerProps) {
  // Convert plan object into a markdown string for display if we don't have the raw markdown
  // Usually the LLM returns the raw plan.md, but if it's parsed, we can re-render it.
  
  const markdownContent = plan.markdown || `
### Goal
${plan.goal || plan.title || "No goal specified"}

### Proposed File Tree
${plan.proposedFileTree?.map((f: any) => `- **[${f.action?.toUpperCase()}]** \`${f.path}\`: ${f.purpose}`).join('\n') || '*No files proposed.*'}

### Task Graph
${plan.taskGraph?.map((t: any, i: number) => `${i + 1}. **${t.name}**: ${t.exactWork || t.description}`).join('\n') || '*No tasks mapped.*'}
  `;

  return (
    <div className="prose prose-invert prose-sm max-w-none">
      <ReactMarkdown remarkPlugins={[[remarkGfm, { singleTilde: false }]]}>
        {markdownContent}
      </ReactMarkdown>
    </div>
  );
}

import { motion, useReducedMotion } from "motion/react";
import { cn } from "../../lib/utils";
import type { DesignSystemSummary, DesignTemplateSummary } from "../../../lib/clyra-design/directive";
import { AGENT_EASE } from "./motion";

/**
 * The starting point for a design: one design system (the house style) and
 * one template (the structure). Both are optional. Chips reuse the welcome
 * screen's quick-action look, so a design start feels like the code start.
 */
export function DesignPicker({
  systems,
  templates,
  systemId,
  templateId,
  onSystem,
  onTemplate,
}: {
  systems: DesignSystemSummary[];
  templates: DesignTemplateSummary[];
  systemId: string | null;
  templateId: string | null;
  onSystem: (id: string | null) => void;
  onTemplate: (id: string | null) => void;
}) {
  const reduced = useReducedMotion();
  return (
    <div className="flex w-full flex-col gap-3 text-left">
      <PickerRow label="Design system" hint="The house style: colour, type, radius and tone">
        {systems.map((system, index) => (
          <Chip
            key={system.id}
            index={index}
            selected={systemId === system.id}
            title={system.description}
            reduced={Boolean(reduced)}
            onClick={() => onSystem(systemId === system.id ? null : system.id)}
          >
            {system.name}
          </Chip>
        ))}
      </PickerRow>
      <PickerRow label="Starting layout" hint="A structure to build from, not a copy">
        {templates.map((template, index) => (
          <Chip
            key={template.id}
            index={index}
            selected={templateId === template.id}
            title={template.description}
            reduced={Boolean(reduced)}
            onClick={() => onTemplate(templateId === template.id ? null : template.id)}
          >
            {template.name}
          </Chip>
        ))}
      </PickerRow>
    </div>
  );
}

function PickerRow({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <section aria-label={label}>
      <div className="mb-1.5 flex items-baseline gap-2 px-1">
        <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#9A9CA0]">{label}</h3>
        <span className="truncate text-[10.5px] text-[#B7B9BD]">{hint}</span>
      </div>
      <div className="flex flex-wrap gap-1">{children}</div>
    </section>
  );
}

function Chip({
  index,
  selected,
  title,
  reduced,
  onClick,
  children,
}: {
  index: number;
  selected: boolean;
  title: string;
  reduced: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <motion.button
      type="button"
      aria-pressed={selected}
      title={title}
      onClick={onClick}
      initial={reduced ? false : { opacity: 0, y: 3 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: reduced ? 0 : Math.min(index, 12) * 0.02, ease: AGENT_EASE }}
      className={cn(
        "cc-quick-action flex h-7 items-center rounded-full px-2.5 text-[11.5px] transition-colors duration-150",
        selected ? "bg-[var(--accent-blue)]/[0.09] text-[var(--accent-blue)]" : "text-[#85878C] hover:bg-black/[0.035] hover:text-[#4B4D51]",
      )}
    >
      {children}
    </motion.button>
  );
}

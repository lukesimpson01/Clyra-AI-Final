import LiquidGlass from "liquid-glass-react";
import { motion } from "framer-motion";
import type { ReactNode } from "react";

type LiquidGlassButtonProps = {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  size?: "md" | "sm";
};

/** Circular Liquid Glass call control (mic, end-call). Every control this
 *  renders is expected to actually work — see the note on the call-control
 *  row in VoiceCallScreen about why camera/share aren't offered here at all
 *  rather than shown disabled. */
export function LiquidGlassButton({
  icon,
  label,
  onClick,
  active,
  danger,
  size = "md",
}: LiquidGlassButtonProps) {
  const padding = size === "sm" ? "14px" : "18px";
  const iconBox = size === "sm" ? "h-5 w-5" : "h-6 w-6";
  const box = size === "sm" ? 52 : 64;
  return (
    <motion.button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      whileHover={{ scale: 1.06 }}
      whileTap={{ scale: 0.92 }}
      transition={{ type: "spring", stiffness: 420, damping: 24 }}
      className="relative"
    >
      {/* liquid-glass-react measures its own box once and lays out a couple of
          full-size tint layers as normal-flow (not absolutely positioned)
          siblings -- clipping to the button's real visual diameter here keeps
          any stale internal measurement from inflating this button's hit box
          or layout footprint. */}
      <span
        className={`relative block overflow-hidden rounded-full ${active ? "ring-2 ring-rose-400/70 ring-offset-2 ring-offset-transparent" : ""}`}
        style={{ width: box, height: box }}
      >
        <LiquidGlass
          cornerRadius={999}
          padding={padding}
          blurAmount={14}
          saturation={140}
          aberrationIntensity={danger ? 1.4 : 0.8}
          elasticity={0.18}
          mode="standard"
        >
          <span className={`flex items-center justify-center text-white/90 ${iconBox}`}>
            {icon}
          </span>
        </LiquidGlass>
      </span>
    </motion.button>
  );
}

type LiquidGlassIconGroupProps = {
  items: Array<{ icon: ReactNode; label: string; onClick: () => void }>;
};

/** A pill of Liquid Glass icon buttons sharing one glass surface, divided by hairlines. */
export function LiquidGlassIconGroup({ items }: LiquidGlassIconGroupProps) {
  const width = items.length * 36 + 12;
  return (
    // See the comment in `LiquidGlassButton` -- clip to the pill's real
    // visual size so liquid-glass-react's internal tint layers can't
    // inflate this group's layout footprint.
    <span className="relative block overflow-hidden rounded-full" style={{ width, height: 48 }}>
      <LiquidGlass cornerRadius={999} padding="6px" blurAmount={14} saturation={140} elasticity={0.14} mode="standard">
        <div className="flex items-center">
          {items.map((item, i) => (
            <motion.button
              key={item.label}
              type="button"
              aria-label={item.label}
              title={item.label}
              onClick={item.onClick}
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.9 }}
              transition={{ type: "spring", stiffness: 420, damping: 24 }}
              className="relative flex h-9 w-9 items-center justify-center text-white/90"
            >
              {i > 0 && (
                <span className="absolute left-0 top-1/2 h-4 w-px -translate-y-1/2 bg-white/25" aria-hidden />
              )}
              <span className="flex h-5 w-5 items-center justify-center">{item.icon}</span>
            </motion.button>
          ))}
        </div>
      </LiquidGlass>
    </span>
  );
}

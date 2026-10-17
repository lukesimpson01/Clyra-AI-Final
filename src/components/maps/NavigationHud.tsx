import { motion } from "motion/react";
import { Pause, Play, Square, Gauge, Volume2, VolumeX } from "lucide-react";
import { useState } from "react";
import type { NavigationStep } from "../../../lib/maps/types";
import { MANEUVER_ICON, formatArrival, formatDistance, formatDuration } from "./mapsIcons";
import { SIMULATION_SPEEDS } from "../../navigation/NavigationSimulationEngine";

interface NavigationHudProps {
  /** The manoeuvre still ahead of the driver, not the one just completed. */
  upcomingStep?: NavigationStep;
  upcomingDistanceMeters?: number;
  remainingDistanceMeters: number;
  remainingDurationSeconds: number;
  paused: boolean;
  speed: number;
  onTogglePause: () => void;
  onStop: () => void;
  onSpeedChange: (speed: number) => void;
  muted?: boolean;
  onToggleMute?: () => void;
}

/** Compact turn-by-turn HUD — deliberately small so the map stays the star. */
export function NavigationHud({
  upcomingStep,
  upcomingDistanceMeters,
  remainingDistanceMeters,
  remainingDurationSeconds,
  paused,
  speed,
  onTogglePause,
  onStop,
  onSpeedChange,
  muted,
  onToggleMute,
}: NavigationHudProps) {
  const [speedOpen, setSpeedOpen] = useState(false);
  const Icon = upcomingStep ? MANEUVER_ICON[upcomingStep.type] : MANEUVER_ICON.continue;

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -12 }}
        transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
        className="pointer-events-auto absolute left-4 top-4 z-30 w-[300px] overflow-hidden rounded-2xl border border-slate-200/90 bg-white/95 shadow-[0_12px_40px_rgba(15,23,42,.14)] backdrop-blur-xl"
      >
        <div className="flex items-center gap-3 px-4 py-3.5">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#3b82f6] text-white">
            <Icon className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1">
            {typeof upcomingDistanceMeters === "number" ? (
              <p className="text-[20px] font-bold leading-none text-slate-950">{formatDistance(upcomingDistanceMeters)}</p>
            ) : null}
            <p className="mt-1 truncate text-[13px] font-semibold text-slate-700">{upcomingStep?.instruction || "Continue"}</p>
            {upcomingStep?.roadName ? <p className="truncate text-[11.5px] text-slate-500">{upcomingStep.roadName}</p> : null}
          </div>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 12 }}
        transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
        className="pointer-events-auto absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-full border border-slate-200/90 bg-white/95 px-4 py-2.5 shadow-[0_12px_40px_rgba(15,23,42,.14)] backdrop-blur-xl"
      >
        <div className="text-center">
          <p className="text-[15px] font-bold leading-none text-slate-950">{formatDuration(remainingDurationSeconds)}</p>
          <p className="mt-0.5 text-[10.5px] leading-none text-slate-500">{formatDistance(remainingDistanceMeters)}</p>
        </div>
        <div className="h-6 w-px bg-slate-200" />
        <p className="text-[12.5px] font-semibold text-slate-600">{formatArrival(remainingDurationSeconds)}</p>
        <div className="h-6 w-px bg-slate-200" />
        <button
          type="button"
          aria-label={paused ? "Resume" : "Pause"}
          onClick={onTogglePause}
          className="grid h-8 w-8 place-items-center rounded-full text-slate-600 transition-colors hover:bg-slate-100"
        >
          {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
        </button>
        <div className="relative">
          <button
            type="button"
            aria-label="Simulation speed"
            onClick={() => setSpeedOpen((v) => !v)}
            className="flex items-center gap-1 rounded-full px-2 py-1.5 text-[11.5px] font-bold text-slate-600 transition-colors hover:bg-slate-100"
          >
            <Gauge className="h-3.5 w-3.5" /> {speed}×
          </button>
          {speedOpen ? (
            <div className="absolute bottom-full left-1/2 mb-2 -translate-x-1/2 rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
              {SIMULATION_SPEEDS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    onSpeedChange(s);
                    setSpeedOpen(false);
                  }}
                  className={
                    "block w-full whitespace-nowrap rounded-lg px-3 py-1.5 text-left text-[12px] font-semibold " +
                    (s === speed ? "bg-[#3b82f6]/10 text-[#3b82f6]" : "text-slate-600 hover:bg-slate-50")
                  }
                >
                  {s}×
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {onToggleMute ? (
          <button type="button" aria-label={muted ? "Unmute voice guidance" : "Mute voice guidance"} onClick={onToggleMute} className="grid h-8 w-8 place-items-center rounded-full text-slate-600 transition-colors hover:bg-slate-100">
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
        ) : null}
        <button
          type="button"
          aria-label="Stop navigation"
          onClick={onStop}
          className="grid h-8 w-8 place-items-center rounded-full text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500"
        >
          <Square className="h-3.5 w-3.5" />
        </button>
      </motion.div>
    </>
  );
}

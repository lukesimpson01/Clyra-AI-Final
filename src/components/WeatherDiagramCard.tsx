import { useMemo, useState, type ReactNode } from "react";
import { cn } from "../lib/utils";

export type WeatherDay = {
  date: string;
  highC: number;
  lowC: number;
  precipProb: number;
  weatherCode: number;
  condition: string;
};

export type WeatherHour = {
  time: string;
  tempC: number;
  precipProb: number;
  weatherCode: number;
};

export type WeatherPayload = {
  location: string;
  region?: string;
  country?: string;
  timezone?: string;
  observedAt?: string;
  matchedFrom?: string;
  isCurrentLocation?: boolean;
  current: {
    tempC: number;
    feelsLikeC: number;
    weatherCode: number;
    isDay: boolean;
    highC: number;
    lowC: number;
    precipProb: number;
    humidity: number;
    windKph: number;
    windDirection: number;
    condition: string;
  };
  hourly: WeatherHour[];
  daily: WeatherDay[];
};

function weatherIcon(code: number, isDay: boolean, size: "lg" | "sm" = "sm") {
  const dim = size === "lg" ? "h-14 w-14" : "h-5 w-5";
  if (code === 0) {
    return isDay ? (
      <svg viewBox="0 0 24 24" className={cn(dim, "text-amber-500")} fill="currentColor" aria-hidden>
        <circle cx="12" cy="12" r="4.2" />
        <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none">
          <path d="M12 2.8v2.2M12 19v2.2M2.8 12h2.2M19 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M5.2 18.8l1.6-1.6M17.2 6.8l1.6-1.6" />
        </g>
      </svg>
    ) : (
      <svg viewBox="0 0 24 24" className={cn(dim, "text-sky-500")} fill="currentColor" aria-hidden>
        <path d="M16.4 4.2a7.6 7.6 0 1 0 3.4 14.4 8.8 8.8 0 1 1-3.4-14.4z" />
      </svg>
    );
  }
  if (code <= 3) {
    return (
      <svg viewBox="0 0 24 24" className={cn(dim, "text-slate-400")} fill="currentColor" aria-hidden>
        <path d="M7.5 18.5h9.2a4.3 4.3 0 0 0 .4-8.6 5.6 5.6 0 0 0-10.7 1.5A3.8 3.8 0 0 0 7.5 18.5z" />
      </svg>
    );
  }
  if (code <= 48) {
    return (
      <svg viewBox="0 0 24 24" className={cn(dim, "text-slate-400")} fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
        <path d="M3 9h18M4 13h16M6 17h12" strokeLinecap="round" />
      </svg>
    );
  }
  if (code <= 67 || (code >= 80 && code <= 82)) {
    return (
      <svg viewBox="0 0 24 24" className={cn(dim, "text-sky-500")} fill="currentColor" aria-hidden>
        <path d="M7.5 15.2h9.2a4.3 4.3 0 0 0 .4-8.6 5.6 5.6 0 0 0-10.7 1.5 3.8 3.8 0 0 0 1.1 7.1z" />
        <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <path d="M9 17.4v2.2M12 18v2.4M15 17.4v2.2" />
        </g>
      </svg>
    );
  }
  if (code <= 77 || (code >= 85 && code <= 86)) {
    return (
      <svg viewBox="0 0 24 24" className={cn(dim, "text-sky-400")} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
        <path d="M12 4v16M5.5 7.5l13 9M18.5 7.5l-13 9" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={cn(dim, "text-amber-500")} fill="currentColor" aria-hidden>
      <path d="M13.2 2.5 6.8 13.2h4.2l-1.4 8.3 7.8-12.2h-4.4z" />
    </svg>
  );
}

function formatDayLabel(isoDate: string, index: number) {
  if (index === 0) return "Today";
  if (index === 1) return "Tomorrow";
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString(undefined, { weekday: "short" });
}

function formatHourLabel(isoTime: string) {
  const d = new Date(isoTime);
  if (Number.isNaN(d.getTime())) return isoTime;
  return d.toLocaleTimeString(undefined, { hour: "numeric" });
}

function StatChip({
  icon,
  value,
  label,
}: {
  icon: ReactNode;
  value: string;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1.5 rounded-full bg-slate-50 px-2.5 py-1.5">
      <span className="text-slate-400">{icon}</span>
      <span className="text-[12.5px] font-semibold text-slate-700">{value}</span>
      <span className="text-[11px] font-medium text-slate-400">{label}</span>
    </div>
  );
}

function DropletIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
      <path d="M12 2.5c2.8 3.7 6.5 8.4 6.5 12.3a6.5 6.5 0 1 1-13 0c0-3.9 3.7-8.6 6.5-12.3z" />
    </svg>
  );
}

function WindIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <path d="M3 8h11a2.6 2.6 0 1 0-2.6-2.6M3 12.5h15a2.6 2.6 0 1 1-2.6 2.6M3 16.8h8" />
    </svg>
  );
}

function ThermometerIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
      <path d="M12 2.8a2.6 2.6 0 0 0-2.6 2.6v8.3a4.3 4.3 0 1 0 5.2 0V5.4A2.6 2.6 0 0 0 12 2.8zm0 1.6a1 1 0 0 1 1 1v9l.4.26a2.7 2.7 0 1 1-2.8 0l.4-.26v-9a1 1 0 0 1 1-1z" />
    </svg>
  );
}

function HourlyChart({ hourly, unit }: { hourly: WeatherHour[]; unit: "C" | "F" }) {
  const points = hourly.slice(0, 12);
  if (points.length < 2) return null;

  const convert = (c: number) => (unit === "C" ? c : (c * 9) / 5 + 32);
  const temps = points.map((p) => convert(p.tempC));
  const min = Math.min(...temps);
  const max = Math.max(...temps);
  const span = Math.max(max - min, 1);

  const width = 100;
  const height = 34;
  const stepX = width / (points.length - 1);
  const coords = temps.map((t, i) => {
    const x = i * stepX;
    const y = height - ((t - min) / span) * (height - 8) - 4;
    return { x, y };
  });
  const linePath = coords.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${coords[coords.length - 1]!.x.toFixed(1)},${height} L0,${height} Z`;

  return (
    <div className="mt-4 rounded-2xl bg-slate-50/70 px-3 pb-2 pt-3">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-14 w-full overflow-visible" preserveAspectRatio="none" aria-hidden>
        <path d={areaPath} fill="url(#clyra-weather-hourly-gradient)" opacity={0.5} />
        <path d={linePath} fill="none" stroke="#38bdf8" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        <defs>
          <linearGradient id="clyra-weather-hourly-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7dd3fc" stopOpacity={0.55} />
            <stop offset="100%" stopColor="#7dd3fc" stopOpacity={0} />
          </linearGradient>
        </defs>
      </svg>
      <div className="mt-1.5 flex justify-between">
        {points.map((p, i) => (
          <div key={p.time + i} className="flex flex-1 flex-col items-center gap-0.5">
            <span className="text-[10.5px] font-medium text-slate-400">
              {i % 2 === 0 ? formatHourLabel(p.time) : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function WeatherDiagramCard({
  weather,
  className,
}: {
  weather: WeatherPayload;
  className?: string;
}) {
  const [unit, setUnit] = useState<"C" | "F">("C");

  const convert = (c: number) =>
    unit === "C" ? Math.round(c) : Math.round((c * 9) / 5 + 32);

  const dayLabel = useMemo(() => {
    const d = weather.observedAt ? new Date(weather.observedAt) : new Date();
    return d.toLocaleDateString(undefined, { weekday: "long" });
  }, [weather.observedAt]);

  const place = weather.isCurrentLocation
    ? weather.location
      ? `Current location · ${weather.location}`
      : "Current location"
    : [weather.location, weather.region, weather.country].filter(Boolean).join(", ");

  const days = weather.daily?.length
    ? weather.daily
    : [
        {
          date: weather.observedAt?.slice(0, 10) || new Date().toISOString().slice(0, 10),
          highC: weather.current.highC,
          lowC: weather.current.lowC,
          precipProb: weather.current.precipProb,
          weatherCode: weather.current.weatherCode,
          condition: weather.current.condition,
        },
      ];

  return (
    <div
      className={cn(
        "my-2 w-full max-w-xl overflow-hidden rounded-[22px] border border-slate-200/80 bg-white/90 px-5 py-4 shadow-[0_18px_40px_rgba(15,23,42,0.05)]",
        className,
      )}
      data-invert-ignore
    >
      <p className="text-[13px] font-medium tracking-[-0.01em] text-slate-500">
        {dayLabel} · {place}
      </p>
      {weather.matchedFrom && !weather.isCurrentLocation ? (
        <p className="mt-1 text-[11.5px] font-medium text-slate-400">
          Matched from “{weather.matchedFrom}”
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-start justify-between gap-6">
        <div className="flex items-center gap-4">
          {weatherIcon(weather.current.weatherCode, weather.current.isDay, "lg")}
          <div>
            <div className="flex items-end gap-2">
              <span className="text-[56px] font-light leading-none tracking-[-0.04em] text-slate-900">
                {convert(weather.current.tempC)}
              </span>
              <div className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-slate-400">
                <button
                  type="button"
                  onClick={() => setUnit("C")}
                  className={cn(
                    "transition-colors",
                    unit === "C" ? "text-slate-800" : "hover:text-slate-600",
                  )}
                >
                  °C
                </button>
                <span className="text-slate-300">|</span>
                <button
                  type="button"
                  onClick={() => setUnit("F")}
                  className={cn(
                    "transition-colors",
                    unit === "F" ? "text-slate-800" : "hover:text-slate-600",
                  )}
                >
                  °F
                </button>
              </div>
            </div>
            <p className="mt-1 text-[16px] font-semibold tracking-[-0.02em] text-slate-800">
              {weather.current.condition}
            </p>
            <p className="mt-1 text-[12.5px] font-medium text-slate-500">
              High {convert(weather.current.highC)}° · Low{" "}
              {convert(weather.current.lowC)}° · Precip{" "}
              {Math.round(weather.current.precipProb)}%
            </p>
          </div>
        </div>
      </div>

      <div className="mt-3.5 flex flex-wrap gap-2">
        <StatChip icon={<ThermometerIcon />} value={`${convert(weather.current.feelsLikeC)}°`} label="Feels like" />
        <StatChip icon={<DropletIcon />} value={`${Math.round(weather.current.humidity)}%`} label="Humidity" />
        <StatChip icon={<WindIcon />} value={`${Math.round(weather.current.windKph)} km/h`} label="Wind" />
      </div>

      <HourlyChart hourly={weather.hourly} unit={unit} />

      <div className="mt-5 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:thin]">
        <div className="flex min-w-max gap-3 px-0.5">
          {days.map((day, index) => (
            <div
              key={day.date}
              className="flex w-[64px] flex-col items-center gap-1.5 rounded-2xl px-1 py-1 text-center"
            >
              <span className="whitespace-nowrap text-[11px] font-medium text-slate-500">
                {formatDayLabel(day.date, index)}
              </span>
              {weatherIcon(day.weatherCode, true, "sm")}
              <span className="text-[11px] font-semibold text-sky-500">
                {Math.round(day.precipProb)}%
              </span>
              <div className="flex flex-col items-center leading-tight">
                <span className="text-[13px] font-semibold text-slate-800">
                  {convert(day.highC)}°
                </span>
                <span className="text-[12px] font-medium text-slate-400">
                  {convert(day.lowC)}°
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

import { useMemo, useState, type ReactNode } from "react";
import { cn } from "../lib/utils";
import { MapPanel } from "./LocationMapCard";

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
  /** the place came from this device's time zone, not a precise fix */
  approximate?: boolean;
  lat?: number;
  lon?: number;
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

function Tile({ icon, value, label }: { icon: ReactNode; value: string; label: string }) {
  return (
    <div className="rounded-2xl bg-slate-50/80 px-3.5 py-3">
      <div className="flex items-center gap-1.5 text-slate-400">
        {icon}
        <span className="text-[11px] font-medium uppercase tracking-[0.04em]">{label}</span>
      </div>
      <p className="mt-1.5 text-[19px] font-medium tracking-[-0.02em] text-slate-900">{value}</p>
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

function RainIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <path d="M7.5 15h9.2a4.3 4.3 0 0 0 .4-8.6 5.6 5.6 0 0 0-10.7 1.5A3.8 3.8 0 0 0 7.5 15zM9 18v2M12 18v3M15 18v2" />
    </svg>
  );
}

/** A smooth temperature curve over the next hours, with the first point marked as "now". */
function HourlyChart({ hourly, unit }: { hourly: WeatherHour[]; unit: "C" | "F" }) {
  const points = hourly.slice(0, 12);
  if (points.length < 2) return null;
  const convert = (c: number) => (unit === "C" ? c : (c * 9) / 5 + 32);
  const temps = points.map((p) => convert(p.tempC));
  const min = Math.min(...temps);
  const max = Math.max(...temps);
  const span = Math.max(max - min, 1);
  const width = 240;
  const height = 64;
  const step = width / (points.length - 1);
  const xy = temps.map((t, i) => ({ x: i * step, y: height - 14 - ((t - min) / span) * (height - 30) }));
  // a smooth path through the points (midpoint quadratic curves)
  let line = `M${xy[0].x.toFixed(1)},${xy[0].y.toFixed(1)}`;
  for (let i = 1; i < xy.length; i++) {
    const mx = (xy[i - 1].x + xy[i].x) / 2;
    const my = (xy[i - 1].y + xy[i].y) / 2;
    line += ` Q${xy[i - 1].x.toFixed(1)},${xy[i - 1].y.toFixed(1)} ${mx.toFixed(1)},${my.toFixed(1)}`;
  }
  line += ` T${xy[xy.length - 1].x.toFixed(1)},${xy[xy.length - 1].y.toFixed(1)}`;
  const area = `${line} L${width},${height} L0,${height} Z`;
  return (
    <div className="mt-5">
      <div className="relative">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-[74px] w-full overflow-visible" preserveAspectRatio="none" aria-hidden>
          <defs>
            <linearGradient id="clyra-wx-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#60a5fa" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#60a5fa" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill="url(#clyra-wx-area)" />
          <path d={line} fill="none" stroke="#3b82f6" strokeWidth="1.8" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
        {xy.map((p, i) =>
          i % 3 === 0 ? (
            <span
              key={i}
              className="absolute -translate-x-1/2 -translate-y-[calc(100%+4px)] text-[11px] font-medium text-slate-600"
              style={{ left: `${(p.x / width) * 100}%`, top: `${(p.y / height) * 100}%` }}
            >
              {Math.round(temps[i])}°
            </span>
          ) : null,
        )}
      </div>
      <div className="mt-1 flex justify-between text-[10.5px] font-medium text-slate-400">
        {points.map((p, i) => (
          <span key={p.time + i} className="w-0 flex-1 text-center">{i % 3 === 0 ? (i === 0 ? "Now" : formatHourLabel(p.time)) : ""}</span>
        ))}
      </div>
    </div>
  );
}

export function WeatherDiagramCard({ weather, className }: { weather: WeatherPayload; className?: string }) {
  const [unit, setUnit] = useState<"C" | "F">("C");
  const convert = (c: number) => (unit === "C" ? Math.round(c) : Math.round((c * 9) / 5 + 32));

  const dayLabel = useMemo(() => {
    const d = weather.observedAt ? new Date(weather.observedAt) : new Date();
    return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  }, [weather.observedAt]);

  const place = [weather.location, weather.region].filter(Boolean).join(", ") || "Current location";

  const days = weather.daily?.length
    ? weather.daily
    : [{
        date: weather.observedAt?.slice(0, 10) || new Date().toISOString().slice(0, 10),
        highC: weather.current.highC,
        lowC: weather.current.lowC,
        precipProb: weather.current.precipProb,
        weatherCode: weather.current.weatherCode,
        condition: weather.current.condition,
      }];
  const weekLow = Math.min(...days.map((d) => d.lowC));
  const weekHigh = Math.max(...days.map((d) => d.highC));
  const weekSpan = Math.max(weekHigh - weekLow, 1);
  const hasMap = Number.isFinite(weather.lat) && Number.isFinite(weather.lon);
  const night = !weather.current.isDay;

  return (
    <div
      className={cn(
        "my-2 w-full max-w-xl overflow-hidden rounded-[28px] border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_22px_50px_-20px_rgba(15,23,42,0.22)]",
        className,
      )}
      data-invert-ignore
    >
      <div className={cn("px-6 pb-5 pt-5", night ? "bg-gradient-to-b from-slate-100 to-white" : "bg-gradient-to-b from-sky-50 to-white")}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[15px] font-semibold tracking-[-0.015em] text-slate-900">
              <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-blue-600" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 21s-6.5-6.14-6.5-11A6.5 6.5 0 0 1 18.5 10c0 4.86-6.5 11-6.5 11z" />
                <circle cx="12" cy="10" r="2.2" />
              </svg>
              <span className="truncate">{place}</span>
            </p>
            <p className="mt-0.5 text-[12px] text-slate-500">
              {dayLabel}
              {weather.isCurrentLocation ? (weather.approximate ? " · Approximate location from your time zone" : " · Your location") : weather.country ? ` · ${weather.country}` : ""}
            </p>
          </div>
          <div className="flex shrink-0 rounded-full bg-white/80 p-0.5 text-[12px] font-medium shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)]" role="group" aria-label="Temperature unit">
            {(["C", "F"] as const).map((u) => (
              <button
                key={u}
                type="button"
                aria-pressed={unit === u}
                onClick={() => setUnit(u)}
                className={cn("rounded-full px-2.5 py-1 transition-colors", unit === u ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-800")}
              >
                °{u}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between gap-4">
          <div>
            <div className="flex items-start">
              <span className="text-[72px] font-light leading-[0.9] tracking-[-0.05em] text-slate-900">{convert(weather.current.tempC)}</span>
              <span className="mt-1 text-[28px] font-light text-slate-400">°</span>
            </div>
            <p className="mt-2 text-[16px] font-medium tracking-[-0.015em] text-slate-800">{weather.current.condition}</p>
            <p className="mt-0.5 text-[12.5px] text-slate-500">
              H {convert(weather.current.highC)}° · L {convert(weather.current.lowC)}°
            </p>
          </div>
          <div className="[&_svg]:h-20 [&_svg]:w-20">{weatherIcon(weather.current.weatherCode, weather.current.isDay, "lg")}</div>
        </div>
      </div>

      <div className="px-6 pb-2">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Tile icon={<ThermometerIcon />} label="Feels like" value={`${convert(weather.current.feelsLikeC)}°`} />
          <Tile icon={<DropletIcon />} label="Humidity" value={`${Math.round(weather.current.humidity)}%`} />
          <Tile icon={<WindIcon />} label="Wind" value={`${Math.round(weather.current.windKph)} km/h`} />
          <Tile icon={<RainIcon />} label="Rain" value={`${Math.round(weather.current.precipProb)}%`} />
        </div>

        <HourlyChart hourly={weather.hourly} unit={unit} />

        <ul className="mt-5 divide-y divide-slate-100">
          {days.slice(0, 7).map((day, index) => {
            const left = ((day.lowC - weekLow) / weekSpan) * 100;
            const width = Math.max(((day.highC - day.lowC) / weekSpan) * 100, 6);
            return (
              <li key={day.date} className="flex items-center gap-3 py-2.5">
                <span className="w-[72px] shrink-0 text-[13px] font-medium text-slate-700">{formatDayLabel(day.date, index)}</span>
                <span className="shrink-0">{weatherIcon(day.weatherCode, true, "sm")}</span>
                <span className="w-9 shrink-0 text-[11.5px] font-medium text-sky-600">{day.precipProb >= 10 ? `${Math.round(day.precipProb)}%` : ""}</span>
                <span className="w-8 shrink-0 text-right text-[13px] text-slate-400">{convert(day.lowC)}°</span>
                <span className="relative h-1.5 flex-1 rounded-full bg-slate-100" aria-hidden>
                  <span className="absolute inset-y-0 rounded-full bg-gradient-to-r from-sky-300 to-amber-300" style={{ left: `${left}%`, width: `${width}%` }} />
                </span>
                <span className="w-8 shrink-0 text-[13px] font-medium text-slate-800">{convert(day.highC)}°</span>
              </li>
            );
          })}
        </ul>
      </div>

      {hasMap ? (
        <div className="mt-3 border-t border-slate-100">
          <MapPanel lat={weather.lat as number} lon={weather.lon as number} title={place} height={190} zoom={0.05} />
          <p className="px-6 py-2 text-[10.5px] text-slate-400">Weather by Open-Meteo · Map © OpenStreetMap contributors</p>
        </div>
      ) : (
        <p className="px-6 pb-4 pt-2 text-[10.5px] text-slate-400">Weather by Open-Meteo</p>
      )}
    </div>
  );
}

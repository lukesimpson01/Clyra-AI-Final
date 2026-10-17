import { Cloud, CloudRain, CloudSun, Moon, Sun, Wind } from "lucide-react";
import { useEffect, useState } from "react";
import type { Coordinate } from "../../../lib/maps/types";

interface Conditions {
  weather: { tempC: number; condition: string; isDay: boolean; windKph: number; precipProb: number } | null;
  air: { aqi: number; category: string } | null;
}

const cache = new Map<string, Conditions>();

const aqiTone = (aqi: number) => (aqi <= 50 ? "bg-emerald-50 text-emerald-700" : aqi <= 100 ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700");

function WeatherIcon({ condition, isDay }: { condition: string; isDay: boolean }) {
  const c = condition.toLowerCase();
  if (/rain|drizzle|shower|thunder|snow/.test(c)) return <CloudRain className="h-4 w-4" />;
  if (/cloud|overcast|fog/.test(c)) return c.includes("partly") ? <CloudSun className="h-4 w-4" /> : <Cloud className="h-4 w-4" />;
  return isDay ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />;
}

/** Current weather and air quality at the selected point (Open-Meteo). */
export function PlaceConditions({ coordinates }: { coordinates: Coordinate }) {
  const key = `${coordinates[0].toFixed(2)},${coordinates[1].toFixed(2)}`;
  const [data, setData] = useState<Conditions | null>(() => cache.get(key) ?? null);

  useEffect(() => {
    const hit = cache.get(key);
    if (hit) {
      setData(hit);
      return;
    }
    setData(null);
    let live = true;
    fetch("/api/maps/conditions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ coordinates }) })
      .then((r) => r.json())
      .then((d) => {
        if (!live || !d?.ok) return;
        const value: Conditions = { weather: d.weather ?? null, air: d.air ?? null };
        cache.set(key, value);
        setData(value);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!data || (!data.weather && !data.air)) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Current conditions">
      {data.weather ? (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[12px] font-semibold text-slate-700">
          <WeatherIcon condition={data.weather.condition} isDay={data.weather.isDay} />
          {Math.round(data.weather.tempC)}° {data.weather.condition}
        </span>
      ) : null}
      {data.weather && data.weather.windKph >= 20 ? (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[12px] font-semibold text-slate-700">
          <Wind className="h-4 w-4" /> {Math.round(data.weather.windKph)} km/h
        </span>
      ) : null}
      {data.air ? <span className={"rounded-full px-2.5 py-1 text-[12px] font-semibold " + aqiTone(data.air.aqi)}>AQI {data.air.aqi} · {data.air.category}</span> : null}
    </div>
  );
}

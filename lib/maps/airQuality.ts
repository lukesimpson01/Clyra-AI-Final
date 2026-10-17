/** Current air quality from Open-Meteo's keyless air-quality API (US AQI scale). */
export interface AirQuality {
  aqi: number;
  category: string;
  pm25?: number;
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; value: AirQuality | null }>();

export function aqiCategory(aqi: number): string {
  if (aqi <= 50) return "Good";
  if (aqi <= 100) return "Moderate";
  if (aqi <= 150) return "Unhealthy for sensitive groups";
  if (aqi <= 200) return "Unhealthy";
  if (aqi <= 300) return "Very unhealthy";
  return "Hazardous";
}

export async function fetchAirQuality(lat: number, lon: number): Promise<AirQuality | null> {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=us_aqi,pm2_5`;
    const res = await fetch(url, { signal: controller.signal });
    const data = res.ok ? ((await res.json()) as { current?: { us_aqi?: unknown; pm2_5?: unknown } }) : null;
    const aqi = data?.current?.us_aqi;
    const value: AirQuality | null =
      typeof aqi === "number" && Number.isFinite(aqi)
        ? { aqi: Math.round(aqi), category: aqiCategory(aqi), pm25: typeof data?.current?.pm2_5 === "number" ? data.current.pm2_5 : undefined }
        : null;
    cache.set(key, { at: Date.now(), value });
    return value;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

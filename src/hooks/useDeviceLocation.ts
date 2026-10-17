export type DeviceCoords = { lat: number; lon: number };

const CACHE_KEY = "clyra_device_location";
const CACHE_TTL_MS = 10 * 60 * 1000;

function readCachedLocation(): DeviceCoords | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; lat: number; lon: number };
    if (Date.now() - parsed.at > CACHE_TTL_MS) return null;
    if (!Number.isFinite(parsed.lat) || !Number.isFinite(parsed.lon)) return null;
    return { lat: parsed.lat, lon: parsed.lon };
  } catch {
    return null;
  }
}

function writeCachedLocation(coords: DeviceCoords) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ...coords, at: Date.now() }));
  } catch {
    // sessionStorage unavailable (private mode, etc.) — safe to skip caching.
  }
}

/** Browser GPS/Wi-Fi geolocation, cached for a few minutes to avoid re-prompting on every ask. */
async function getBrowserLocation(): Promise<DeviceCoords | null> {
  const cached = readCachedLocation();
  if (cached) return cached;
  if (typeof navigator === "undefined" || !navigator.geolocation) return null;

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coords = { lat: position.coords.latitude, lon: position.coords.longitude };
        writeCachedLocation(coords);
        resolve(coords);
      },
      () => resolve(null),
      { timeout: 6000, maximumAge: CACHE_TTL_MS },
    );
  });
}

/** Server-side IP geolocation fallback, used only when browser geolocation is denied/unavailable. */
async function getIpLocation(): Promise<DeviceCoords | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch("/api/research/geo-ip", { method: "POST", signal: controller.signal });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data?.ok || typeof data.lat !== "number" || typeof data.lon !== "number") return null;
      return { lat: data.lat, lon: data.lon };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

/** Resolves the user's current device location: browser geolocation first, IP-based fallback second. */
export async function resolveDeviceLocation(): Promise<DeviceCoords | null> {
  const browserLocation = await getBrowserLocation();
  if (browserLocation) return browserLocation;
  return getIpLocation();
}

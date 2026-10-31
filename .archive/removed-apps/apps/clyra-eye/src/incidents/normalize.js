// Normalizes public incident feeds into one Incident model. Every record keeps
// its provider id, source links and timestamps; nothing here invents data.
// Each provider is validated record-by-record, so one bad record never drops a feed.

export const INCIDENT_TYPES = Object.freeze([
  'earthquake', 'wildfire', 'flood', 'storm', 'cyclone', 'volcano', 'landslide',
  'road incident', 'major crash', 'road closure', 'major public event', 'launch',
  'aviation incident', 'maritime incident', 'other verified event',
]);

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/** Only https links are kept; anything else is dropped rather than rendered. */
export function safeHttpsUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function validLatLon(lat, lon) {
  return isNumber(lat) && isNumber(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

/** Status from the age of the last update: active within 72 h, then monitoring, then ended. */
export function statusForAge(updatedAt, now) {
  const ageHours = (now - updatedAt) / 3_600_000;
  if (ageHours <= 72) return 'active';
  if (ageHours <= 24 * 14) return 'monitoring';
  return 'ended';
}

/** USGS GeoJSON feature → Incident. Returns null for malformed features. */
export function normalizeUsgsFeature(feature, { now = Date.now(), feedId = 'usgs-earthquakes' } = {}) {
  if (!isRecord(feature) || typeof feature.id !== 'string') return null;
  const { geometry, properties } = feature;
  if (!isRecord(geometry) || geometry.type !== 'Point' || !Array.isArray(geometry.coordinates)) return null;
  const [lon, lat, depth] = geometry.coordinates;
  if (!validLatLon(lat, lon) || !isRecord(properties)) return null;
  if (!isNumber(properties.mag) || properties.mag < 0 || properties.mag > 10) return null;
  if (!isNumber(properties.time) || properties.time <= 0) return null;
  const updatedAt = isNumber(properties.updated) ? properties.updated : properties.time;
  const place = typeof properties.place === 'string' && properties.place.trim() ? properties.place : 'Unnamed location';
  const links = [safeHttpsUrl(properties.url)].filter(Boolean);
  return {
    id: `${feedId}:${feature.id}`,
    title: `M ${properties.mag.toFixed(1)} earthquake · ${place}`,
    type: 'earthquake',
    severity: Math.min(10, Math.max(0, properties.mag)),
    status: statusForAge(updatedAt, now),
    coordinates: [{ lat, lon }],
    depthKm: isNumber(depth) ? depth : null,
    startTime: new Date(properties.time).toISOString(),
    updatedAt: new Date(updatedAt).toISOString(),
    description: place,
    affectedArea: null,
    sourceLinks: links.map((url) => ({ provider: 'USGS', url })),
    confidence: properties.status === 'reviewed' ? 1 : 0.8,
    providerIds: ['usgs'],
    attribution: 'Earthquake data courtesy U.S. Geological Survey',
  };
}

const EONET_CATEGORY_TYPES = Object.freeze({
  wildfires: 'wildfire',
  severeStorms: 'storm',
  volcanoes: 'volcano',
  floods: 'flood',
  landslides: 'landslide',
});

/** EONET v3 event → Incident, using the most recent point geometry. */
export function normalizeEonetEvent(event, { now = Date.now() } = {}) {
  if (!isRecord(event) || typeof event.id !== 'string' || typeof event.title !== 'string') return null;
  const geometries = (Array.isArray(event.geometry) ? event.geometry : [])
    .filter((g) => isRecord(g) && g.type === 'Point' && Array.isArray(g.coordinates) && typeof g.date === 'string')
    .map((g) => ({ g, t: Date.parse(g.date) }))
    .filter((entry) => Number.isFinite(entry.t))
    .sort((a, b) => b.t - a.t);
  const latest = geometries[0];
  if (!latest) return null;
  const [lon, lat] = latest.g.coordinates;
  if (!validLatLon(lat, lon)) return null;
  const earliest = geometries[geometries.length - 1];
  const category = Array.isArray(event.categories) && isRecord(event.categories[0]) ? event.categories[0] : null;
  const type = EONET_CATEGORY_TYPES[category?.id] || 'other verified event';
  const closed = typeof event.closed === 'string' && Number.isFinite(Date.parse(event.closed));
  const sourceLinks = [safeHttpsUrl(event.link)].filter(Boolean).map((url) => ({ provider: 'NASA EONET', url }));
  for (const source of Array.isArray(event.sources) ? event.sources : []) {
    const url = isRecord(source) ? safeHttpsUrl(source.url) : null;
    if (url) sourceLinks.push({ provider: isRecord(source) && typeof source.id === 'string' ? source.id : 'source', url });
  }
  return {
    id: `nasa-eonet:${event.id}`,
    title: event.title,
    type,
    severity: undefined,
    status: closed ? 'ended' : statusForAge(latest.t, now),
    coordinates: [{ lat, lon }],
    depthKm: null,
    startTime: new Date(earliest.t).toISOString(),
    updatedAt: new Date(latest.t).toISOString(),
    description: category?.title || 'Natural event',
    affectedArea: null,
    sourceLinks,
    confidence: 0.9,
    providerIds: ['nasa-eonet'],
    attribution: 'Natural events courtesy NASA Earth Observatory (EONET)',
  };
}

/** Great-circle distance in kilometres. */
export function distanceKm(a, b) {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Merge reports of the same event from several providers: same type, within
 * 25 km and 12 h of each other. Keeps the richest record and unions its sources.
 */
export function deduplicateIncidents(incidents) {
  const merged = [];
  for (const incident of incidents) {
    const start = Date.parse(incident.startTime ?? incident.updatedAt);
    const match = merged.find((other) => {
      if (other.type !== incident.type) return false;
      const otherStart = Date.parse(other.startTime ?? other.updatedAt);
      if (Math.abs(otherStart - start) > 12 * 3_600_000) return false;
      return distanceKm(other.coordinates[0], incident.coordinates[0]) <= 25;
    });
    if (!match) {
      merged.push({ ...incident, sourceLinks: [...incident.sourceLinks] });
      continue;
    }
    match.providerIds = [...new Set([...match.providerIds, ...incident.providerIds])];
    match.sourceLinks = [...match.sourceLinks, ...incident.sourceLinks.filter((link) => !match.sourceLinks.some((l) => l.url === link.url))];
    match.severity = Math.max(match.severity ?? 0, incident.severity ?? 0) || undefined;
    match.confidence = Math.min(1, Math.max(match.confidence, incident.confidence) + 0.05);
    if (Date.parse(incident.updatedAt) > Date.parse(match.updatedAt)) match.updatedAt = incident.updatedAt;
  }
  return merged;
}

/** Rank by severity, then recency, then distance from an origin when one is given. */
export function rankIncidents(incidents, origin = null) {
  return [...incidents].sort((a, b) => {
    const sev = (b.severity ?? 0) - (a.severity ?? 0);
    if (sev !== 0) return sev;
    const recent = Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    if (recent !== 0) return recent;
    if (!origin) return 0;
    return distanceKm(a.coordinates[0], origin) - distanceKm(b.coordinates[0], origin);
  });
}

/** Incidents within a radius of an origin, with distance attached. */
export function incidentsWithin(incidents, origin, radiusKm) {
  return incidents
    .map((incident) => ({ incident, distanceKm: distanceKm(incident.coordinates[0], origin) }))
    .filter((entry) => entry.distanceKm <= radiusKm)
    .map((entry) => ({ ...entry.incident, distanceKm: Math.round(entry.distanceKm * 10) / 10 }));
}

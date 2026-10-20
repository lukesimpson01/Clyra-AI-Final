import * as Cesium from 'cesium';

/** Colour by incident type. Colour carries the type; it never implies live status. */
export function incidentColor(type) {
  switch (type) {
    case 'earthquake': return Cesium.Color.fromCssColorString('#e5484d');
    case 'wildfire': return Cesium.Color.fromCssColorString('#ea580c');
    case 'storm':
    case 'cyclone': return Cesium.Color.fromCssColorString('#7c3aed');
    case 'volcano': return Cesium.Color.fromCssColorString('#b91c1c');
    case 'flood': return Cesium.Color.fromCssColorString('#0891b2');
    case 'landslide': return Cesium.Color.fromCssColorString('#92400e');
    default: return Cesium.Color.fromCssColorString('#64748b');
  }
}

/** Marker size scales with severity when the source provides one; otherwise a fixed size. */
export function incidentMarkerPixels(severity) {
  if (typeof severity !== 'number' || !Number.isFinite(severity)) return 9;
  return Math.min(18, 7 + Math.max(0, severity));
}

/** The incidents layer: keyless public incidents as globe markers, refreshed while enabled. */
export function createIncidentsLayer({ source } = {}) {
  if (typeof source?.getSnapshot !== 'function') throw new TypeError('Incidents require a snapshot source');
  let viewer = null;
  let dataSource = null;
  let request = null;
  let enabled = false;
  let state = { count: 0, lastUpdate: null, lastError: null, stale: false, providers: [] };

  return {
    id: 'incidents',
    name: 'Incidents',
    icon: '⚠',
    source: 'USGS · NASA EONET',
    updateInterval: 120000,

    init(v) {
      if (viewer) throw new Error('Incidents layer is already initialized');
      viewer = v;
      dataSource = new Cesium.CustomDataSource('incidents');
      dataSource.show = false;
      viewer.dataSources.add(dataSource);
      enabled = false;
    },

    enable() {
      enabled = true;
      if (dataSource) dataSource.show = true;
    },

    disable() {
      request?.abort();
      request = null;
      enabled = false;
      if (dataSource) dataSource.show = false;
    },

    /** Refreshes the markers. Aborted or superseded requests never touch the map. */
    async update() {
      if (!enabled || !dataSource) return false;
      request?.abort();
      const current = new AbortController();
      request = current;
      try {
        const snapshot = await source.getSnapshot({ signal: current.signal });
        if (current.signal.aborted || request !== current || !enabled) return false;
        dataSource.entities.removeAll();
        for (const incident of snapshot.incidents) {
          const [point] = incident.coordinates;
          dataSource.entities.add({
            id: `incident:${incident.id}`,
            position: Cesium.Cartesian3.fromDegrees(point.lon, point.lat),
            point: {
              pixelSize: incidentMarkerPixels(incident.severity),
              color: incidentColor(incident.type).withAlpha(0.9),
              outlineColor: Cesium.Color.WHITE.withAlpha(0.8),
              outlineWidth: 1,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            description: incident.description,
            properties: {
              incidentId: incident.id,
              type: incident.type,
              title: incident.title,
              status: incident.status,
              updatedAt: incident.updatedAt,
              sources: incident.sourceLinks,
            },
          });
        }
        state = {
          count: snapshot.incidents.length,
          lastUpdate: snapshot.fetchedAt,
          lastError: null,
          stale: snapshot.stale,
          providers: snapshot.providers,
        };
        return true;
      } catch (error) {
        if (current.signal.aborted || request !== current || !enabled) return false;
        state = { ...state, lastError: error?.message || 'Incident source unavailable' };
        return false;
      } finally {
        if (request === current) request = null;
      }
    },

    /** Structured state for the AI tool layer and Provider Settings. */
    getState() {
      return { enabled, ...state };
    },

    destroy(v = viewer) {
      request?.abort();
      request = null;
      enabled = false;
      if (dataSource && v) {
        v.dataSources.remove(dataSource, true);
      }
      dataSource = null;
      viewer = null;
    },
  };
}

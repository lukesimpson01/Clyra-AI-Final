const OSM_TILE_URL = 'https://tile.openstreetmap.org';
const OSM_TILE_USER_AGENT =
  'Clyra Maps/1.0 (+https://github.com/openai/clyra-maps)';
const MAX_ZOOM = 16;

function validTile(z, x, y) {
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y))
    return false;
  if (z < 0 || z > MAX_ZOOM) return false;
  const edge = 2 ** z;
  return x >= 0 && y >= 0 && x < edge && y < edge;
}

/**
 * Browser image requests cannot supply an identifying User-Agent, which the
 * public OSM raster service requires. Serve only bounded, cacheable raster
 * tile requests through Clyra's local provider so the upstream can identify
 * the application and the map never silently devolves into a blank globe.
 */
export function osmTilesProxy({ fetchImpl = fetch } = {}) {
  const installMiddleware = (server) => {
    server.middlewares.use('/api/osm-tiles', async (req, res) => {
      const match = /^\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(req.url || '');
      if (req.method !== 'GET' || !match) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not_found' }));
        return;
      }
      const [z, x, y] = match.slice(1).map(Number);
      if (!validTile(z, x, y)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_tile' }));
        return;
      }
      try {
        const upstream = await fetchImpl(`${OSM_TILE_URL}/${z}/${x}/${y}.png`, {
          headers: {
            Accept: 'image/png,image/*;q=0.8,*/*;q=0.1',
            'User-Agent': OSM_TILE_USER_AGENT,
          },
        });
        if (!upstream.ok) throw new Error(`OSM tile status ${upstream.status}`);
        const contentType = upstream.headers.get('content-type') || '';
        if (!contentType.startsWith('image/'))
          throw new Error('OSM tile response was not an image');
        const body = Buffer.from(await upstream.arrayBuffer());
        res.writeHead(200, {
          'Content-Type': contentType,
          // The browser cache is the first-line cache for this immutable tile
          // coordinate. It prevents a camera settle from repeatedly calling
          // the public service, while a normal page refresh still receives
          // current map data soon enough for navigation use.
          'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
        });
        res.end(body);
      } catch (error) {
        console.warn('[osm-tiles-proxy]', error?.message || error);
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'osm_tile_unavailable' }));
      }
    });
  };
  return {
    name: 'osm-tiles-proxy',
    configureServer: installMiddleware,
    configurePreviewServer: installMiddleware,
  };
}

export { MAX_ZOOM as OSM_TILE_MAX_ZOOM, validTile as validOsmTile };

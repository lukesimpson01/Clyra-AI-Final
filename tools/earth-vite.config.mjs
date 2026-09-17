/**
 * Non-visual host configuration for the upstream God's Eye View document.
 *
 * God's Eye View correctly refuses to be framed by arbitrary pages. Clyra
 * embeds it only from its own loopback application, so the development host
 * keeps every upstream plugin and setting and narrows frame ancestors to those
 * local origins. This file deliberately lives outside the vendored source: an
 * upstream sync leaves the product UI and its source tree pristine.
 */
import upstreamConfig from '../vendor/gods-eye-view/vite.config.js';

function clyraFrameAncestors() {
  const extra = String(process.env.CLYRA_EARTH_FRAME_ANCESTORS || '')
    .split(/[\s,]+/)
    .filter(Boolean);
  const origins = new Set(["'self'", 'file:']);
  for (const port of [process.env.PORT || '3000', '3000', '5173', '5174']) {
    origins.add(`http://localhost:${port}`);
    origins.add(`http://127.0.0.1:${port}`);
  }
  for (const origin of extra) origins.add(origin);
  return [...origins].join(' ');
}

export default async function earthViteConfig(env) {
  const resolved = typeof upstreamConfig === 'function'
    ? await upstreamConfig(env)
    : upstreamConfig;
  return {
    ...resolved,
    server: {
      ...(resolved.server || {}),
      host: '127.0.0.1',
      port: Number(process.env.CLYRA_EARTH_PORT) || 5176,
      strictPort: true,
      headers: {
        ...(resolved.server?.headers || {}),
        'Content-Security-Policy': `frame-ancestors ${clyraFrameAncestors()}`,
      },
    },
  };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

// Local receivers (RTL-SDR, local ADS-B decoders) are removed from Clyra Eye.
// These checks keep that removal in place.
test('the local receiver proxy module is gone', () => {
  assert.equal(existsSync(new URL('../../server/providers/local-receivers.js', import.meta.url)), false);
});

test('the Vite plugin list no longer mounts the local receiver route', () => {
  const plugins = readFileSync(new URL('../../server/providers/local.js', import.meta.url), 'utf8');
  assert.doesNotMatch(plugins, /localReceiversProxy/);
  assert.doesNotMatch(plugins, /local-receivers/);
});

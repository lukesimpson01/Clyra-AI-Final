// TeleGeography's bundled cable GeoJSON is CC BY-NC-SA 3.0 and must not ship
// in Clyra's commercial distribution. The payload has been removed during the
// vendor audit. Keep the layer's contract intact, but return an honest empty
// collection instead of attempting to fetch (or silently redistribute) it.
const emptyCollection = Object.freeze({ type: 'FeatureCollection', features: [] });

/** Supply an empty, commercial-safe cable source. */
export function createBundledCableSource() {
  return {
    label: 'TeleGeography unavailable in commercial build',
    async fetch(signal) {
      signal?.throwIfAborted();
      return {
        cables: emptyCollection,
        landingPoints: emptyCollection,
        unavailable: 'TeleGeography CC BY-NC-SA data is not distributed with Clyra',
      };
    },
  };
}

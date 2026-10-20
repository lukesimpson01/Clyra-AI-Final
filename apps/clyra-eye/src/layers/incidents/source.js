// Incident source for the globe: refreshes the keyless providers through the
// shared registry, merges duplicate reports, and ranks the result. It never
// fabricates an incident: a failed provider keeps its last good data, marked stale.
import { createIncidentRegistry } from '../../incidents/providers.js';
import { deduplicateIncidents, rankIncidents } from '../../incidents/normalize.js';

export function createIncidentSource({ registry = createIncidentRegistry({ fetchImpl: globalThis.fetch.bind(globalThis) }) } = {}) {
  return {
    registry,
    /**
     * Snapshot of the current incidents. Providers are refreshed in parallel;
     * one provider failing never empties the result.
     */
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const outcomes = await Promise.all([
        registry.refresh('usgs', { window: 'day' }),
        registry.refresh('eonet'),
      ]);
      signal?.throwIfAborted();
      const incidents = outcomes.flatMap((outcome) => (outcome.ok ? outcome.data : []));
      const stale = outcomes.some((outcome) => outcome.ok && outcome.stale);
      const failed = outcomes.every((outcome) => !outcome.ok);
      if (failed) throw new Error('No incident provider is available');
      return {
        incidents: rankIncidents(deduplicateIncidents(incidents)),
        stale,
        providers: registry.capabilities(),
        fetchedAt: Date.now(),
      };
    },
  };
}

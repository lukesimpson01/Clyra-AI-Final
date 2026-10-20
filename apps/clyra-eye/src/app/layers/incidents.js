import { createIncidentsLayer } from '../../layers/incidents/index.js';

/** Wire the global incidents layer into the application catalog. */
export function createApplicationIncidents(options) {
  return createIncidentsLayer(options);
}

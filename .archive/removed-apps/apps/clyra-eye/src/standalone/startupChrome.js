import { startApplicationChrome } from '../app/startupChrome.js';
import { initKeySetup } from '../keySetup.js';
import { clyraEyeStartupReadiness } from '../app/startupReadiness.js';
export function startStandaloneChrome(options) {
  return startApplicationChrome({
    initializeSettings: initKeySetup,
    readiness: clyraEyeStartupReadiness,
    ...options,
  });
}

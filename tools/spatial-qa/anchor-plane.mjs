/* Prints the surface anchor the editor would create for a click: node anchor-plane.mjs solution.json refSeconds x01 y01 */
import fs from 'node:fs';
import { surfaceAnchor } from '../../apps/shorts/openfilm/packages/openfilm/studio/ui/src/frame/spatial-geometry.js';
const sol = JSON.parse(fs.readFileSync(process.argv[2])), t = Number(process.argv[3]), x = Number(process.argv[4]), y = Number(process.argv[5]);
const a = surfaceAnchor(sol, Math.round(t * 1e6), [x * sol.width, y * sol.height]);
console.log(JSON.stringify({ position: a.position, normal: a.normal, right: a.right, down: a.down, support: a.support, planeError: a.planeError, type: a.type }));

/**
 * Entry document for 2D projects.
 *
 * Statically imports Phaser and nothing else — a 3D project loads boot3d.ts
 * and never downloads this bundle.
 */
import { startRuntime } from "./boot";
import { World2D } from "./world2d";

startRuntime({
  mode: "2d",
  createWorld: async (canvas, emit) => {
    const world = new World2D(canvas, emit);
    await world.whenReady();
    return world;
  },
});

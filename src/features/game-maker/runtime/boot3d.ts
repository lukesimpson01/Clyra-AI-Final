/**
 * Entry document for 3D and voxel projects.
 *
 * Statically imports PlayCanvas and nothing else, because a sandboxed
 * opaque-origin frame can only load its parse-time module graph (see
 * boot.ts). A 2D project loads boot2d.ts instead and never downloads this.
 */
import { startRuntime } from "./boot";
import { World3D } from "./world3d";

startRuntime({ mode: "3d", createWorld: (canvas, emit) => new World3D(canvas, emit) });

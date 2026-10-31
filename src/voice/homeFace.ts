/**
 * Shared gaze handle for the chat-home orb (the `ClyraFace` rendered in the
 * welcome screen). App-level controls (the workspace tab switcher hover, the
 * composer focus) drive the face's gaze through this singleton, the same way
 * `orbAnchor` shares the orb's on-screen position with the voice call.
 */

export interface HomeFaceHandle {
  /** Follow the cursor. `nx`/`ny` are normalized to -1..1 relative to the
   *  orb's centre (0,0 = centre, +x = right, +y = down). */
  track: (nx: number, ny: number) => void;
  /** Fixed pose: "forward" = centred, "down" = eyes cast toward the composer. */
  setLook: (mode: "forward" | "down") => void;
}

let face: HomeFaceHandle | null = null;

export function registerHomeFace(handle: HomeFaceHandle | null) {
  face = handle;
}

export function getHomeFace(): HomeFaceHandle | null {
  return face;
}

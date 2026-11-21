/**
 * Shared scale for the time-sliced builders (city blocks, buildings and trees). On a fast machine each builder may
 * spend its full slice per frame; when frames run long the slices shrink, so slower computers stream scenery in more
 * slowly instead of stalling.
 */
let average = 16.7, scale = 1;

/** Feed the measured frame interval in milliseconds once per frame. */
export function noteFrame(ms: number) {
  if (!(ms > 0) || ms > 250) return; // tab switches and pauses are not load
  average += (ms - average) * 0.08;
  // Full slices up to about 60 fps, a quarter of them at 30 fps and slower.
  scale = Math.min(1, Math.max(0.25, (34 - average) / 16));
}

/** A builder's slice in milliseconds, scaled to how the machine is coping. */
export function sliceMs(full: number) { return full * scale; }

/** For the performance overlay and tests. */
export function frameLoad() { return { average, scale }; }

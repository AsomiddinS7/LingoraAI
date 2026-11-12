// Turns 21 MediaPipe hand landmarks into a pose feature vector that does not depend on where
// the hand is in the frame or how far it is from the camera.
export interface Landmark {
  x: number;
  y: number;
  z: number;
}

export const LANDMARKS = 21;
export const FEATURE_DIM = LANDMARKS * 3;

/**
 * - translate so the wrist (0) is the origin
 * - scale by palm size (wrist -> middle finger MCP, landmark 9)
 * - mirror left hands so both hands map to the same feature space
 * Orientation is kept: in sign languages the palm orientation is part of the sign.
 */
export function landmarksToFeatures(lm: Landmark[], handedness: string): number[] {
  if (lm.length < LANDMARKS) throw new Error(`expected ${LANDMARKS} landmarks, got ${lm.length}`);
  const w = lm[0];
  const palm = Math.hypot(lm[9].x - w.x, lm[9].y - w.y, lm[9].z - w.z) || 1e-6;
  const flip = handedness === 'Left' ? -1 : 1;
  const out = new Array<number>(FEATURE_DIM);
  for (let i = 0; i < LANDMARKS; i++) {
    out[i * 3] = ((lm[i].x - w.x) / palm) * flip;
    out[i * 3 + 1] = (lm[i].y - w.y) / palm;
    out[i * 3 + 2] = (lm[i].z - w.z) / palm;
  }
  return out;
}

import type { Landmark } from './features';

export interface RecoveryRegion { x: number; y: number; size: number; target: Landmark; scale: number }

/** Pixel-square crop around an actually visible pose wrist, including palm extension. */
export function wristRecoveryRegion(pose: Landmark[], slot: 0 | 1, width: number, height: number): RecoveryRegion | null {
  const wrist = pose[5+slot], elbow = pose[3+slot];
  if (!wrist || !elbow || wrist.x < 0 || wrist.x > 1 || wrist.y < 0 || wrist.y > 1) return null;
  const scale = Math.hypot((pose[1].x-pose[2].x)*width, (pose[1].y-pose[2].y)*height);
  if (scale < 20) return null;
  const size = Math.min(Math.min(width,height)*.65, Math.max(Math.min(width,height)*.18, scale));
  const centerX = (wrist.x + .15*(wrist.x-elbow.x))*width;
  const centerY = (wrist.y + .15*(wrist.y-elbow.y))*height;
  return { x: Math.max(0, Math.min(width-size, centerX-size/2)),
    y: Math.max(0, Math.min(height-size, centerY-size/2)), size, target: wrist, scale };
}

export function restoreCropLandmarks(points: Landmark[], region: RecoveryRegion, width: number, height: number): Landmark[] | null {
  if (points.length !== 21 || points.some(p => ![p.x,p.y,p.z].every(Number.isFinite))) return null;
  return points.map(p => ({ x:(region.x+p.x*region.size)/width, y:(region.y+p.y*region.size)/height, z:p.z*region.size/width }));
}

export function acceptRecoveredHand(points: Landmark[], region: RecoveryRegion, existing: Landmark[][], width: number, height: number) {
  const distance = (a: Landmark,b: Landmark) => Math.hypot((a.x-b.x)*width,(a.y-b.y)*height);
  if (distance(points[0],region.target) > region.size*.6) return false;
  // A crop must not turn another view of the already detected hand into a second hand.
  if (existing.some(hand => distance(hand[0],points[0]) < region.scale*.18)) return false;
  const palm = distance(points[0],points[9]);
  return palm >= 4 && palm <= region.size*.8;
}

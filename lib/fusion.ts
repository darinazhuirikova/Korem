/**
 * YOLO + PIDNet geometric fusion layer.
 *
 * Maps each YOLO bounding box onto the PIDNet segmentation mask using the same
 * camera FOV (linear projection). Assigns a fused priority that combines YOLO
 * class importance with surface-context from PIDNet.
 *
 * Coordinate mapping:
 *   YOLO boxes are normalized [0,1] relative to the 640×640 input frame.
 *   PIDNet mask is 256×128 pixels over the same FOV.
 *   Projection: col = x * PIDNET_W,  row = y * PIDNET_H  (clamped).
 *
 * Staleness: if the mask timestamp is older than STALE_MS (3 s = 2× the PIDNet
 * cycle interval), we no longer trust surface labels and fall back to YOLO-only
 * priority. This prevents stale context from incorrectly suppressing new alerts.
 *
 * Priority rules:
 *   HIGH   — foot-point pixel ∈ DANGER_CLASSES ∪ PEOPLE_CLASSES (road / vehicle / person in road)
 *   MEDIUM — YOLO classId ∈ HIGH_PRIORITY_CLASSES but surface is safe / stale
 *   LOW    — neither condition met
 *
 * All exported functions are pure (no side-effects) to support unit testing.
 */

import { Detection } from './yolo';
import { PIDNET_W, PIDNET_H, DANGER_CLASSES, PEOPLE_CLASSES } from '../constants/cityscapesLabels';
import { HIGH_PRIORITY_CLASSES } from '../constants/cocoLabels';

export type FusedPriority = 'HIGH' | 'MEDIUM' | 'LOW';

export type FusedDetection<T extends Detection = Detection> = T & {
  fusedPriority: FusedPriority;
  /** Cityscapes class index at the foot-point pixel, or null when mask is absent/stale. */
  pidnetClass: number | null;
  /** True when the mask is older than STALE_MS or null. */
  stale: boolean;
};

// 3 s — chosen as 2× the PIDNet inference cycle (1500 ms)
const STALE_MS = 3_000;

/**
 * Project each detection's foot-point onto the PIDNet mask and compute priority.
 *
 * @param mask           Flat Int32Array [PIDNET_H × PIDNET_W], index = y*PIDNET_W + x
 * @param maskTimestamp  Date.now() at which the mask was produced
 * @param dets           Array of detections (TrackedDetection satisfies this via structural typing)
 */
export function fusePidnetYolo<T extends Detection>(
  mask: Int32Array | null,
  maskTimestamp: number,
  dets: T[],
): FusedDetection<T>[] {
  const stale = mask === null || (Date.now() - maskTimestamp) > STALE_MS;

  return dets.map((det) => {
    // Sample near the base of the bounding box (85% down ≈ object feet / wheels)
    const footX = (det.x1 + det.x2) / 2;
    const footY  = det.y1 * 0.15 + det.y2 * 0.85;

    let pidnetClass: number | null = null;
    if (mask && !stale) {
      const col = Math.min(Math.floor(footX * PIDNET_W), PIDNET_W - 1);
      const row = Math.min(Math.floor(footY  * PIDNET_H), PIDNET_H - 1);
      pidnetClass = mask[row * PIDNET_W + col];
    }

    let fusedPriority: FusedPriority = 'LOW';
    if (!stale && pidnetClass !== null &&
        (DANGER_CLASSES.has(pidnetClass) || PEOPLE_CLASSES.has(pidnetClass))) {
      // Object is confirmed to be on a dangerous surface (road, vehicle zone, or
      // another person/rider already in the road)
      fusedPriority = 'HIGH';
    } else if (HIGH_PRIORITY_CLASSES.has(det.classId)) {
      // YOLO class is high-priority but surface context is safe or unavailable
      fusedPriority = 'MEDIUM';
    }

    return { ...det, fusedPriority, pidnetClass, stale } as FusedDetection<T>;
  });
}

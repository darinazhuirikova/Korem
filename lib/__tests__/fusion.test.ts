/**
 * Unit tests for lib/fusion.ts
 *
 * Run with:  npx jest lib/__tests__/fusion.test.ts
 * (Requires jest + ts-jest configured, e.g. via expo's jest preset.)
 */

import { fusePidnetYolo, FusedPriority } from '../fusion';
import { PIDNET_W, PIDNET_H } from '../../constants/cityscapesLabels';

const ROAD_CLASS     = 0;  // Cityscapes road
const SIDEWALK_CLASS = 1;  // Cityscapes sidewalk
const PERSON_CITY    = 11; // Cityscapes person

function makeMask(fillClass: number): Int32Array {
  return new Int32Array(PIDNET_W * PIDNET_H).fill(fillClass);
}

const personDet = {
  classId: 0,       // COCO person — in HIGH_PRIORITY_CLASSES
  label: 'человек',
  labelEn: 'person',
  confidence: 0.85,
  x1: 0.3, y1: 0.2, x2: 0.7, y2: 0.9,
};

const unknownDet = {
  classId: 50,      // COCO broccoli — not in HIGH_PRIORITY_CLASSES
  label: 'брокколи',
  labelEn: 'broccoli',
  confidence: 0.7,
  x1: 0.1, y1: 0.1, x2: 0.4, y2: 0.4,
};

describe('fusePidnetYolo', () => {
  it('HIGH: foot-point on road (DANGER_CLASS 0)', () => {
    const result = fusePidnetYolo(makeMask(ROAD_CLASS), Date.now(), [personDet]);
    expect(result).toHaveLength(1);
    expect(result[0].fusedPriority).toBe<FusedPriority>('HIGH');
    expect(result[0].pidnetClass).toBe(ROAD_CLASS);
    expect(result[0].stale).toBe(false);
  });

  it('HIGH: foot-point on Cityscapes person zone (PEOPLE_CLASS 11)', () => {
    const result = fusePidnetYolo(makeMask(PERSON_CITY), Date.now(), [personDet]);
    expect(result[0].fusedPriority).toBe<FusedPriority>('HIGH');
  });

  it('MEDIUM: high-priority YOLO class but foot on sidewalk (safe surface)', () => {
    const result = fusePidnetYolo(makeMask(SIDEWALK_CLASS), Date.now(), [personDet]);
    expect(result[0].fusedPriority).toBe<FusedPriority>('MEDIUM');
    expect(result[0].pidnetClass).toBe(SIDEWALK_CLASS);
  });

  it('LOW: non-priority class on safe surface', () => {
    const result = fusePidnetYolo(makeMask(SIDEWALK_CLASS), Date.now(), [unknownDet]);
    expect(result[0].fusedPriority).toBe<FusedPriority>('LOW');
  });

  it('stale mask (> 3000 ms): stale=true, pidnetClass=null, falls back to YOLO class priority', () => {
    const oldTs = Date.now() - 4_000;
    const result = fusePidnetYolo(makeMask(ROAD_CLASS), oldTs, [personDet]);
    expect(result[0].stale).toBe(true);
    expect(result[0].pidnetClass).toBeNull();
    // No surface info → classId 0 (person) is still HIGH_PRIORITY → MEDIUM
    expect(result[0].fusedPriority).toBe<FusedPriority>('MEDIUM');
  });

  it('stale mask: non-priority class → LOW', () => {
    const oldTs = Date.now() - 4_000;
    const result = fusePidnetYolo(makeMask(ROAD_CLASS), oldTs, [unknownDet]);
    expect(result[0].stale).toBe(true);
    expect(result[0].fusedPriority).toBe<FusedPriority>('LOW');
  });

  it('null mask: treated as stale', () => {
    const result = fusePidnetYolo(null, Date.now(), [personDet]);
    expect(result[0].stale).toBe(true);
    expect(result[0].pidnetClass).toBeNull();
    expect(result[0].fusedPriority).toBe<FusedPriority>('MEDIUM');
  });

  it('empty detections → empty result', () => {
    expect(fusePidnetYolo(makeMask(ROAD_CLASS), Date.now(), [])).toHaveLength(0);
  });

  it('preserves extra detection fields (TrackedDetection passthrough)', () => {
    const tracked = { ...personDet, trackId: 42, isMoving: true };
    const result = fusePidnetYolo(makeMask(ROAD_CLASS), Date.now(), [tracked]);
    expect(result[0].trackId).toBe(42);
    expect(result[0].isMoving).toBe(true);
  });

  it('foot-point coordinate mapping: bottom-center of box hits expected pixel', () => {
    // det: x1=0.5 y1=0.0 x2=1.0 y2=0.5
    // foot = ( (0.5+1.0)/2, 0.0*0.15 + 0.5*0.85 ) = (0.75, 0.425)
    // col = floor(0.75 * 256) = 192
    // row = floor(0.425 * 128) = 54
    const det = { ...personDet, x1: 0.5, y1: 0.0, x2: 1.0, y2: 0.5 };
    const mask = makeMask(SIDEWALK_CLASS);
    const col = Math.min(Math.floor(0.75 * PIDNET_W), PIDNET_W - 1); // 192
    const row = Math.min(Math.floor(0.425 * PIDNET_H), PIDNET_H - 1); // 54
    mask[row * PIDNET_W + col] = ROAD_CLASS;
    const result = fusePidnetYolo(mask, Date.now(), [det]);
    expect(result[0].pidnetClass).toBe(ROAD_CLASS);
    expect(result[0].fusedPriority).toBe<FusedPriority>('HIGH');
  });
});

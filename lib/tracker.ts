import { Detection } from './yolo';

export type TrackedDetection = Detection & {
  trackId: number;
  velocityX: number;
  velocityY: number;
  isMoving: boolean;
};

type Track = {
  id: number;
  cx: number;
  cy: number;
  velocityX: number;
  velocityY: number;
  disappeared: number;
};

const MAX_DISAPPEARED = 5;
const VELOCITY_THRESHOLD = 0.04;
const MAX_ASSOC_DIST = 0.3;

let _nextId = 0;
let _tracks: (Track & Pick<Detection, 'classId' | 'label' | 'labelEn'>)[] = [];

function dist(ax: number, ay: number, bx: number, by: number) {
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
}

export function updateTracks(detections: Detection[]): TrackedDetection[] {
  const centroids = detections.map(d => ({ cx: (d.x1 + d.x2) / 2, cy: (d.y1 + d.y2) / 2 }));

  if (_tracks.length === 0) {
    _tracks = detections.map((d, i) => ({
      id: _nextId++,
      cx: centroids[i].cx,
      cy: centroids[i].cy,
      velocityX: 0,
      velocityY: 0,
      disappeared: 0,
      classId: d.classId,
      label: d.label,
      labelEn: d.labelEn,
    }));
    return detections.map((d, i) => ({
      ...d,
      trackId: _tracks[i].id,
      velocityX: 0,
      velocityY: 0,
      isMoving: false,
    }));
  }

  const usedDets = new Set<number>();
  const result: TrackedDetection[] = [];

  for (const track of _tracks) {
    let bestDist = MAX_ASSOC_DIST;
    let bestIdx = -1;
    for (let i = 0; i < centroids.length; i++) {
      if (usedDets.has(i)) continue;
      const d = dist(track.cx, track.cy, centroids[i].cx, centroids[i].cy);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }

    if (bestIdx >= 0) {
      const vx = centroids[bestIdx].cx - track.cx;
      const vy = centroids[bestIdx].cy - track.cy;
      track.cx = centroids[bestIdx].cx;
      track.cy = centroids[bestIdx].cy;
      track.velocityX = vx;
      track.velocityY = vy;
      track.disappeared = 0;
      usedDets.add(bestIdx);
      result.push({
        ...detections[bestIdx],
        trackId: track.id,
        velocityX: vx,
        velocityY: vy,
        isMoving: Math.sqrt(vx * vx + vy * vy) > VELOCITY_THRESHOLD,
      });
    } else {
      track.disappeared++;
    }
  }

  for (let i = 0; i < detections.length; i++) {
    if (usedDets.has(i)) continue;
    const t = {
      id: _nextId++,
      cx: centroids[i].cx,
      cy: centroids[i].cy,
      velocityX: 0,
      velocityY: 0,
      disappeared: 0,
      classId: detections[i].classId,
      label: detections[i].label,
      labelEn: detections[i].labelEn,
    };
    _tracks.push(t);
    result.push({ ...detections[i], trackId: t.id, velocityX: 0, velocityY: 0, isMoving: false });
  }

  _tracks = _tracks.filter(t => t.disappeared <= MAX_DISAPPEARED);
  return result;
}

export function resetTracker() {
  _tracks = [];
  _nextId = 0;
}

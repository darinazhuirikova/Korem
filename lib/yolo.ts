/**
 * YOLOv8n on-device inference via react-native-fast-tflite.
 *
 * Two models supported:
 *   yolov8n.tflite       — COCO-80 classes, output [1,84,8400]
 *   yolov8n_city.tflite  — COCO-80 + sidewalk/road/crosswalk/curb, output [1,88,8400]
 *
 * Setup: python scripts/setup_yolo.py
 * City model: python scripts/train_city_yolo.py
 */

import { loadTensorflowModel, TensorflowModel } from 'react-native-fast-tflite';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { Buffer } from 'buffer';
import JPEG from 'jpeg-js';
import { Perf } from './perf';
import {
  COCO_LABELS,
  NUM_CLASSES,
  CITY_CLASSES,
  ALL_LABELS,
  INPUT_SIZE,
  CONF_THRESHOLD,
  IOU_THRESHOLD,
} from '../constants/cocoLabels';

export type Detection = {
  classId: number;
  label: string;       // Russian label
  labelEn: string;     // English label
  confidence: number;  // 0–1
  x1: number;          // normalized [0,1] relative to frame
  y1: number;
  x2: number;
  y2: number;
};

let _model: TensorflowModel | null = null;
let _numClasses = NUM_CLASSES; // updated when city model loads
let _loadError = false;

/** Call once at app start. Prefers city model if available, falls back to COCO. */
export async function initYolo(): Promise<boolean> {
  if (_model) return true;
  if (_loadError) return false;
  const t = Perf.start();
  try {
    // Try city model first (COCO-80 + sidewalk/road/crosswalk/curb)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    _model = await loadTensorflowModel(require('../assets/models/yolov8n_city.tflite'));
    _numClasses = NUM_CLASSES + CITY_CLASSES.length;
    Perf.end('yolo_load', t);
    return true;
  } catch {
    // Fall back to standard COCO-80 model
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      _model = await loadTensorflowModel(require('../assets/models/yolov8n.tflite'));
      _numClasses = NUM_CLASSES;
      Perf.end('yolo_load', t);
      return true;
    } catch {
      _loadError = true;
      return false;
    }
  }
}

export function isYoloReady(): boolean {
  return _model !== null;
}

/** Resize + JPEG-decode → Float32Array [1×640×640×3] NHWC */
async function preprocess(photoUri: string): Promise<Float32Array> {
  const resized = await manipulateAsync(
    photoUri,
    [{ resize: { width: INPUT_SIZE, height: INPUT_SIZE } }],
    { base64: true, format: SaveFormat.JPEG, compress: 0.92 }
  );

  const buf = Buffer.from(resized.base64!, 'base64');
  const { data, width, height } = JPEG.decode(buf, { useTArray: true });
  const pixels = INPUT_SIZE * INPUT_SIZE;
  const tensor = new Float32Array(pixels * 3);
  let src = 0, dst = 0;
  for (let i = 0; i < pixels; i++) {
    tensor[dst++] = data[src] / 255.0;       // R
    tensor[dst++] = data[src + 1] / 255.0;   // G
    tensor[dst++] = data[src + 2] / 255.0;   // B
    src += 4;                                  // skip A
  }
  return tensor;
}

/** IoU of two boxes in [x1,y1,x2,y2] format */
function iou(a: number[], b: number[]): number {
  const ix1 = Math.max(a[0], b[0]);
  const iy1 = Math.max(a[1], b[1]);
  const ix2 = Math.min(a[2], b[2]);
  const iy2 = Math.min(a[3], b[3]);
  const inter = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
  if (inter === 0) return 0;
  const areaA = (a[2] - a[0]) * (a[3] - a[1]);
  const areaB = (b[2] - b[0]) * (b[3] - b[1]);
  return inter / (areaA + areaB - inter);
}

/**
 * Non-Maximum Suppression (greedy, class-agnostic).
 * Returns indices of kept detections.
 */
function nms(boxes: number[][], scores: number[], iouThresh: number): number[] {
  const order = scores
    .map((s, i) => ({ s, i }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.i);

  const kept: number[] = [];
  const suppressed = new Uint8Array(scores.length);

  for (const i of order) {
    if (suppressed[i]) continue;
    kept.push(i);
    for (const j of order) {
      if (suppressed[j] || j === i) continue;
      if (iou(boxes[i], boxes[j]) > iouThresh) suppressed[j] = 1;
    }
  }
  return kept;
}

/**
 * Decode raw YOLOv8 TFLite output [1, 84, 8400] → Detection[].
 * Row layout: rows 0-3 = cx,cy,w,h; rows 4-83 = class scores.
 */
function decodeOutput(raw: Float32Array): Detection[] {
  const N = 8400;
  const boxes: number[][] = [];
  const scores: number[] = [];
  const classIds: number[] = [];

  for (let d = 0; d < N; d++) {
    // Find best class
    let bestClass = 0;
    let bestScore = raw[4 * N + d]; // class 0
    for (let c = 1; c < _numClasses; c++) {
      const s = raw[(4 + c) * N + d];
      if (s > bestScore) { bestScore = s; bestClass = c; }
    }
    if (bestScore < CONF_THRESHOLD) continue;

    // Box coords (center format, normalized [0,1])
    const cx = raw[0 * N + d];
    const cy = raw[1 * N + d];
    const bw = raw[2 * N + d];
    const bh = raw[3 * N + d];

    const x1 = Math.max(0, cx - bw / 2);
    const y1 = Math.max(0, cy - bh / 2);
    const x2 = Math.min(1, cx + bw / 2);
    const y2 = Math.min(1, cy + bh / 2);

    boxes.push([x1, y1, x2, y2]);
    scores.push(bestScore);
    classIds.push(bestClass);
  }

  const kept = nms(boxes, scores, IOU_THRESHOLD);

  return kept.map((i) => {
    const cls = ALL_LABELS[classIds[i]];
    return {
      classId: classIds[i],
      label: cls?.ru ?? `class_${classIds[i]}`,
      labelEn: cls?.en ?? `class_${classIds[i]}`,
      confidence: scores[i],
      x1: boxes[i][0],
      y1: boxes[i][1],
      x2: boxes[i][2],
      y2: boxes[i][3],
    };
  });
}

/** Run YOLO on a photo URI. Returns empty array if model not loaded. */
export async function detectObjects(photoUri: string): Promise<Detection[]> {
  if (!_model) return [];
  const tPre = Perf.start();
  const tensor = await preprocess(photoUri);
  Perf.end('yolo_preprocess', tPre);

  const tInfer = Perf.start();
  const [raw] = _model.runSync([tensor]);
  Perf.end('yolo_infer', tInfer);

  const tNms = Perf.start();
  const result = decodeOutput(raw as Float32Array);
  Perf.end('yolo_nms', tNms);

  return result;
}

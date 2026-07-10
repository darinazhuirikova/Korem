/**
 * PIDNet-S on-device semantic segmentation via react-native-fast-tflite.
 *
 * Model:   assets/models/pidnet_s.tflite
 * Source:  https://github.com/XuJiacong/PIDNet  (CVPR 2023)
 * Input:   [1, PIDNET_H, PIDNET_W, 3]  float32  NHWC  ImageNet-normalized
 * Output:  [1, PIDNET_H, PIDNET_W]     int32    per-pixel Cityscapes class 0-18
 *          OR [1, PIDNET_H, PIDNET_W, 19] float32 logits (handled transparently)
 *
 * Setup: python scripts/convert_pidnet.py
 */

import { loadTensorflowModel, TensorflowModel } from 'react-native-fast-tflite';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { Buffer } from 'buffer';
import JPEG from 'jpeg-js';
import { Perf } from './perf';
import {
  CITYSCAPES_LABELS,
  NUM_CITY_CLASSES,
  DANGER_CLASSES,
  PEOPLE_CLASSES,
  SAFE_CLASSES,
  ROAD_THRESHOLD,
  PEOPLE_THRESHOLD,
  DANGER_THRESHOLD,
  PIDNET_W,
  PIDNET_H,
} from '../constants/cityscapesLabels';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ZoneInfo = {
  classId: number;
  label: string;                               // Russian
  labelEn: string;
  color: [number, number, number, number];     // RGBA 0-255
  fraction: number;                            // dominant class fraction in zone
};

/** 3×3 grid of zones — row 0 = far, row 2 = feet */
export type SegGrid = [[ZoneInfo, ZoneInfo, ZoneInfo],
                       [ZoneInfo, ZoneInfo, ZoneInfo],
                       [ZoneInfo, ZoneInfo, ZoneInfo]];

export type SegResult = {
  grid: SegGrid;
  mask: Int32Array;   // flat [PIDNET_H × PIDNET_W], index = y*PIDNET_W + x
  hazards: string[];  // TTS-ready phrases (language-aware)
  busRegion: { x1: number; y1: number; x2: number; y2: number } | null;
};

// ── Model state ───────────────────────────────────────────────────────────────

let _model: TensorflowModel | null = null;
let _loadError = false;

// ImageNet normalization (required by PIDNet — different from YOLO's /255 only)
const MEAN = [0.485, 0.456, 0.406];
const STD  = [0.229, 0.224, 0.225];

// ── Init ──────────────────────────────────────────────────────────────────────

/** Call once at app start. Returns true if model loaded successfully. */
export async function initPidnet(): Promise<boolean> {
  if (_model) return true;
  if (_loadError) return false;
  const t = Perf.start();
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    _model = await loadTensorflowModel(require('../assets/models/pidnet_s.tflite'));
    Perf.end('pidnet_load', t);
    return true;
  } catch (e) {
    console.warn('[PIDNet] load failed:', e);
    _loadError = true;
    return false;
  }
}

export function isPidnetReady(): boolean {
  return _model !== null;
}

// ── Preprocessing ─────────────────────────────────────────────────────────────

/** Resize to PIDNET_W×PIDNET_H, JPEG-decode, apply ImageNet normalization.
 *  Returns Float32Array [1 × PIDNET_H × PIDNET_W × 3] NHWC. */
async function preprocess(photoUri: string): Promise<Float32Array> {
  const resized = await manipulateAsync(
    photoUri,
    [{ resize: { width: PIDNET_W, height: PIDNET_H } }],
    { base64: true, format: SaveFormat.JPEG, compress: 0.9 }
  );

  const buf = Buffer.from(resized.base64!, 'base64');
  const { data } = JPEG.decode(buf, { useTArray: true });

  const pixels = PIDNET_H * PIDNET_W;
  const tensor = new Float32Array(pixels * 3);
  let src = 0, dst = 0;
  for (let i = 0; i < pixels; i++) {
    tensor[dst++] = (data[src]     / 255 - MEAN[0]) / STD[0]; // R
    tensor[dst++] = (data[src + 1] / 255 - MEAN[1]) / STD[1]; // G
    tensor[dst++] = (data[src + 2] / 255 - MEAN[2]) / STD[2]; // B
    src += 4; // skip A channel
  }
  return tensor;
}

// ── Mask post-processing ──────────────────────────────────────────────────────

/** Normalize raw TFLite output to Int32Array [PIDNET_H × PIDNET_W] class indices. */
function toMask(raw: Float32Array | Int32Array): Int32Array {
  const totalPx = PIDNET_H * PIDNET_W;

  if (raw instanceof Int32Array) {
    // Already argmaxed by the model
    return raw.length >= totalPx ? raw.slice(0, totalPx) : raw;
  }

  const f32 = raw as Float32Array;
  const mask = new Int32Array(totalPx);

  if (f32.length === totalPx) {
    // Float argmax output (e.g. cast to float32 by converter)
    for (let i = 0; i < totalPx; i++) mask[i] = Math.round(f32[i]);
  } else if (f32.length === totalPx * NUM_CITY_CLASSES) {
    // Logits [H × W × C] NHWC (onnx2tf default output layout)
    for (let i = 0; i < totalPx; i++) {
      const base = i * NUM_CITY_CLASSES;
      let bestCls = 0, bestVal = f32[base];
      for (let c = 1; c < NUM_CITY_CLASSES; c++) {
        if (f32[base + c] > bestVal) { bestVal = f32[base + c]; bestCls = c; }
      }
      mask[i] = bestCls;
    }
  }
  // else: unrecognized shape — mask stays all zeros (road)
  return mask;
}

/** Dominant class info for one rectangular region of the mask. */
function analyzeZone(
  mask: Int32Array,
  y0: number, y1: number,
  x0: number, x1: number,
): ZoneInfo {
  const counts = new Int32Array(NUM_CITY_CLASSES);
  let total = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const c = mask[y * PIDNET_W + x];
      if (c >= 0 && c < NUM_CITY_CLASSES) { counts[c]++; total++; }
    }
  }
  let best = 0;
  for (let c = 1; c < NUM_CITY_CLASSES; c++) {
    if (counts[c] > counts[best]) best = c;
  }
  const lbl = CITYSCAPES_LABELS[best];
  return {
    classId: best,
    label:   lbl.ru,
    labelEn: lbl.en,
    color:   lbl.color,
    fraction: total > 0 ? counts[best] / total : 0,
  };
}

/** Build a 3×3 grid dividing the mask into equal tiles. */
function buildGrid(mask: Int32Array): SegGrid {
  const rH = Math.floor(PIDNET_H / 3);
  const cW = Math.floor(PIDNET_W / 3);
  return [0, 1, 2].map(r =>
    [0, 1, 2].map(c => analyzeZone(mask, r * rH, (r + 1) * rH, c * cW, (c + 1) * cW))
  ) as SegGrid;
}

/**
 * Find bounding box of bus pixels (class 15) in the mask.
 * Returns normalized [0,1] coords, or null if no significant bus region.
 */
function findBusRegion(mask: Int32Array): SegResult['busRegion'] {
  const BUS_CLASS = 15;
  let minY = PIDNET_H, maxY = 0, minX = PIDNET_W, maxX = 0, count = 0;
  for (let y = 0; y < PIDNET_H; y++) {
    for (let x = 0; x < PIDNET_W; x++) {
      if (mask[y * PIDNET_W + x] === BUS_CLASS) {
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        count++;
      }
    }
  }
  if (count < 40) return null; // too few pixels → noise
  return {
    x1: minX / PIDNET_W, y1: minY / PIDNET_H,
    x2: maxX / PIDNET_W, y2: maxY / PIDNET_H,
  };
}

/** Generate navigation TTS phrases from the 3×3 grid. */
function buildHazards(grid: SegGrid, lang: string): string[] {
  const msgs: string[] = [];
  const isRu = lang !== 'en';

  const feet   = grid[2][1]; // bottom-center: what user steps on
  const left   = grid[2][0];
  const right  = grid[2][2];
  const ahead  = grid[1][1]; // middle-center: what's ahead at medium distance

  // Critical: road directly underfoot
  if (DANGER_CLASSES.has(feet.classId) && feet.fraction > ROAD_THRESHOLD) {
    if (feet.classId === 0) {
      msgs.push(isRu ? 'Осторожно, дорога' : 'Caution, road');
    } else {
      const name = isRu ? feet.label : feet.labelEn;
      msgs.push(isRu ? `${name} на пути` : `${name} in path`);
    }
  }

  // People directly in path
  if (PEOPLE_CLASSES.has(feet.classId) && feet.fraction > PEOPLE_THRESHOLD) {
    msgs.push(isRu ? 'Человек на пути' : 'Person in path');
  }

  // Medium-distance: vehicle or person approaching
  if (
    (DANGER_CLASSES.has(ahead.classId) || PEOPLE_CLASSES.has(ahead.classId)) &&
    ahead.fraction > DANGER_THRESHOLD &&
    msgs.length === 0
  ) {
    const name = isRu ? ahead.label : ahead.labelEn;
    msgs.push(isRu ? `Впереди ${name}` : `${name} ahead`);
  }

  // Side roads (when user is currently safe on sidewalk/terrain)
  if (msgs.length === 0 && SAFE_CLASSES.has(feet.classId)) {
    const lDanger = DANGER_CLASSES.has(left.classId)  && left.fraction  > 0.4;
    const rDanger = DANGER_CLASSES.has(right.classId) && right.fraction > 0.4;
    if (lDanger && !rDanger)  msgs.push(isRu ? 'Дорога слева'              : 'Road on left');
    if (rDanger && !lDanger)  msgs.push(isRu ? 'Дорога справа'             : 'Road on right');
    if (lDanger &&  rDanger)  msgs.push(isRu ? 'Дорога с обеих сторон'     : 'Roads on both sides');
  }

  return msgs;
}

// ── Main inference ────────────────────────────────────────────────────────────

/**
 * Run PIDNet-S segmentation on a photo URI.
 * Returns null if model is not loaded (fallback to Vision API in camera.tsx).
 */
export async function runSegmentation(
  photoUri: string,
  lang = 'ru',
): Promise<SegResult | null> {
  if (!_model) return null;

  const tCycle = Perf.start();

  const tPre = Perf.start();
  const tensor = await preprocess(photoUri);
  Perf.end('pidnet_preprocess', tPre);

  const tInfer = Perf.start();
  const [rawOutput] = _model.runSync([tensor]);
  Perf.end('pidnet_infer', tInfer);

  const tPost = Perf.start();
  const mask      = toMask(rawOutput as Float32Array | Int32Array);
  const grid      = buildGrid(mask);
  const hazards   = buildHazards(grid, lang);
  const busRegion = findBusRegion(mask);
  Perf.end('pidnet_postprocess', tPost);

  Perf.end('pidnet_cycle', tCycle);

  return { grid, mask, hazards, busRegion };
}

# KÖREM — Implementation Status

Maps article features to source files. Updated 2026-07-10.

---

## Phase 1 — Offline STT (Whisper on-device) ✅

| Feature | File | Status |
|---------|------|--------|
| Cloud → local fallback routing | `lib/stt.ts` | ✅ Implemented |
| Degraded-mode TTS announcement (`onFallback`) | `lib/stt.ts:148` | ✅ Implemented |
| Model download with progress | `lib/stt.ts`, `app/speech_settings.tsx` | ✅ Implemented |
| `WHISPER_NOT_DOWNLOADED` error handling | `app/(tabs)/index.tsx`, `navigation.tsx` | ✅ Implemented |
| Build procedure | `README.md` | ✅ Documented |

**Notes:** ggml-base.bin (~142 MB) is downloaded at runtime by the user via
Speech Settings. It is NOT included in the repo (see `.gitignore`).

---

## Phase 2 — ORS Wheelchair Routing ✅

| Feature | File | Status |
|---------|------|--------|
| `getDirectionsORS()` client | `lib/directions.ts:104` | ✅ Implemented |
| ORS → Google fallback | `lib/directions.ts:146` (`getDirectionsWithFallback`) | ✅ Implemented |
| GeoJSON → RouteResult normalisation | `lib/directions.ts:104` | ✅ Implemented |
| ORS polyline encoding | `lib/directions.ts:48` (`encodePolyline`) | ✅ Implemented |
| Source announcement via TTS | `app/(tabs)/navigation.tsx:322` | ✅ Implemented |

**Notes:** Requires `EXPO_PUBLIC_ORS_KEY` in `.env`. Without it the app silently
uses Google Directions. ORS only activates in "Accessible" route mode.

---

## Phase 3 — YOLO + PIDNet Geometric Fusion ✅

| Feature | File | Status |
|---------|------|--------|
| `fusePidnetYolo()` pure function | `lib/fusion.ts` | ✅ Implemented |
| Coordinate projection (col=x×PIDNET_W, row=y×PIDNET_H) | `lib/fusion.ts:58` | ✅ Implemented |
| Staleness threshold (3 000 ms) | `lib/fusion.ts:32` | ✅ Implemented |
| Priority: HIGH / MEDIUM / LOW | `lib/fusion.ts:62` | ✅ Implemented |
| PIDNet mask stored per-frame | `app/(tabs)/camera.tsx` (`maskRef`) | ✅ Implemented |
| Fusion called in YOLO loop | `app/(tabs)/camera.tsx` (yoloLoop) | ✅ Implemented |
| Debug overlay (🐛 button → fused priority colours) | `app/(tabs)/camera.tsx` | ✅ Implemented |
| Unit tests | `lib/__tests__/fusion.test.ts` | ✅ Written (8 cases) |

**Notes:** To run tests: `npx jest lib/__tests__/fusion.test.ts`
(requires `jest` and `ts-jest` configured — Expo's default jest preset works).

---

## Phase 4 — Navigation × Vision Coupling ✅

| Feature | File | Status |
|---------|------|--------|
| `VisionBus` singleton event bus | `lib/visionBus.ts` | ✅ Implemented |
| camera.tsx emits HIGH-priority alerts (4 s rate-limit) | `app/(tabs)/camera.tsx` | ✅ Implemented |
| navigation.tsx subscribes during active route | `app/(tabs)/navigation.tsx` | ✅ Implemented |
| TTS priority: obstacle > maneuver > progress | `navigation.tsx` (`isSpeakingRef`) | ✅ Implemented |
| Near-waypoint suppression (< 30 m) | `navigation.tsx` VisionBus handler | ✅ Implemented |

---

## Phase 5 — Error Handling & Robustness ✅

| Feature | File | Status |
|---------|------|--------|
| `withTimeout(promise, ms)` | `lib/errorHandler.ts` | ✅ Implemented |
| `withRetry(fn, attempts, delay)` exponential back-off | `lib/errorHandler.ts` | ✅ Implemented |
| `shouldAnnounceError(cls)` rate-limiter (30 s) | `lib/errorHandler.ts` | ✅ Implemented |
| OCR: 10 s timeout + 1 retry | `lib/ocr.ts` | ✅ Applied |
| NLU: 5 s timeout | `lib/nlu.ts` | ✅ Applied |
| Directions geocoding: 8 s timeout + 1 retry | `lib/directions.ts` | ✅ Applied |
| Directions route: 10 s timeout + 1 retry | `lib/directions.ts` | ✅ Applied |
| GPS loss detection (30 s silence → TTS) | `app/(tabs)/navigation.tsx` | ✅ Implemented |
| `WHISPER_NOT_DOWNLOADED` handling | All 4 STT callers | ✅ Implemented |
| Camera permission denied: UI fallback | `app/(tabs)/camera.tsx` | ✅ (existing) |

---

## Phase 6 — Training Scaffold ⚠️

| Feature | File | Status |
|---------|------|--------|
| Dataset specification | `training/DATASET_SPEC.md` | ✅ Written |
| Training script | `training/train_yolo_hazard.py` | ✅ Scaffold |
| TFLite export script | `training/export_hazard_model.py` | ✅ Scaffold |
| Validation script | `training/validate_hazard_model.py` | ✅ Scaffold |
| **Hazard dataset collected** | — | ❌ **NOT DONE** |
| **Hazard model trained** | — | ❌ **NOT DONE** |

> **PIPELINE READY — MODEL NOT TRAINED.**
> The scripts are correct and complete. They require ~200+ annotated images per
> hazard class (stairs, curb, manhole, pole, construction, wet floor, sign board).
> See `training/DATASET_SPEC.md` for annotation guidelines.

---

## Models committed to repo

| File | Size | Source |
|------|------|--------|
| `assets/models/yolov8n.tflite` | 12.9 MB | `scripts/setup_yolo.py` |
| `assets/models/pidnet_s.tflite` | 15.3 MB | `scripts/convert_pidnet.py` |

`yolov8n_city.tflite` (hazard model) is NOT present — training required.

---

## Not implemented / out of scope

- iOS build (no Mac available — EAS cloud build possible with Apple account)
- Real-time video stream mode (uses camera snapshot polling instead)
- Kazakh TTS (expo-speech has no `kk-KZ` voice on most Android devices)

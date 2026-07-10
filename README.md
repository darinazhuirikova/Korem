# KÖREM — AI-Assisted Navigation for Visually Impaired Users

React Native (Expo SDK 53) app with on-device YOLO + PIDNet obstacle detection,
offline Whisper STT, wheelchair-friendly routing, and trilingual (ru/en/kk) TTS.

---

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | ≥ 20 |
| npm | ≥ 10 |
| Expo CLI | `npm i -g expo-cli eas-cli` |
| Android Studio (for emulator) | latest |
| Python | ≥ 3.10 (for model scripts only) |

---

## Environment variables

Copy `.env.example` to `.env` and fill in the keys:

```
EXPO_PUBLIC_GOOGLE_KEY=...      # Google Directions + Geocoding + Vision APIs
EXPO_PUBLIC_MAPS_KEY=...        # Google Maps JS API (WebView map)
EXPO_PUBLIC_OPENAI_KEY=...      # GPT-4o-mini (NLU) + Whisper-1 cloud STT
EXPO_PUBLIC_WHISPER_URL=...     # Self-hosted Whisper proxy URL
EXPO_PUBLIC_ORS_KEY=...         # OpenRouteService (wheelchair routing, optional)
```

> **Never commit `.env`** — it is listed in `.gitignore`.
> ORS key is optional; without it, accessible routing falls back to Google Directions.

---

## Quick start (Expo Go / web)

```bash
npm install
npx expo start
```

Scan the QR code with Expo Go (iOS/Android). Note: TFLite models do not run in
Expo Go — you need a dev client build for full functionality.

---

## Dev client build (required for YOLO + PIDNet + Whisper)

The app uses native modules (`react-native-fast-tflite`, `whisper.rn`) that require
a custom native build.

```bash
# 1. Install deps
npm install

# 2. Generate ML models (run once)
pip install ultralytics tf-keras
python scripts/setup_yolo.py          # → assets/models/yolov8n.tflite
python scripts/convert_pidnet.py      # → assets/models/pidnet_s.tflite

# 3. Build dev client for Android (runs locally via USB)
npx expo run:android

# OR build via EAS (cloud, no Android Studio needed)
eas build --profile development --platform android
```

After the build installs on device, start the Metro bundler:

```bash
npx expo start --dev-client
```

---

## APK build (sideload / testing)

```bash
eas build --profile preview --platform android
```

The resulting `.apk` can be downloaded from expo.dev and installed on any
Android device (allow unknown sources).

---

## Production AAB (Play Store)

```bash
eas build --profile production --platform android
```

---

## Training custom hazard model (optional)

See [training/DATASET_SPEC.md](training/DATASET_SPEC.md) for dataset requirements.

```bash
# After collecting + annotating images per DATASET_SPEC.md:
python training/train_yolo_hazard.py
python training/export_hazard_model.py
python training/validate_hazard_model.py
```

> **Note:** No hazard dataset has been collected yet. The training pipeline is a
> scaffold — see `IMPLEMENTATION_STATUS.md` for current status.

---

## Key architecture

```
app/(tabs)/
  camera.tsx      ← YOLO 500ms + PIDNet 1500ms + fusion + VisionBus emit
  navigation.tsx  ← GPS routing + VisionBus subscriber + TTS priority queue
  index.tsx       ← Voice command hub (NLU)

lib/
  yolo.ts         ← YOLOv8n TFLite inference (COCO-80)
  pidnet.ts       ← PIDNet-S TFLite segmentation (Cityscapes-19)
  fusion.ts       ← YOLO × PIDNet geometric fusion (phase 3)
  visionBus.ts    ← Singleton alert bus: camera → navigation (phase 4)
  stt.ts          ← Cloud Whisper-1 → local whisper-base fallback
  directions.ts   ← ORS wheelchair routing → Google Directions fallback
  errorHandler.ts ← withTimeout / withRetry / shouldAnnounceError (phase 5)
  nlu.ts          ← GPT-4o-mini intent classification + regex fallback
  ocr.ts          ← Google Vision TEXT_DETECTION
  perf.ts         ← Latency profiler (p50/p95, 60 s dump)

assets/models/
  yolov8n.tflite  ← 12.9 MB, float32, 640×640, COCO-80
  pidnet_s.tflite ← 15.3 MB, Cityscapes-19, 256×128 NHWC
```

---

## Offline STT

The app ships without the Whisper model (~142 MB). Users download it from
**Speech Settings → Download offline model**. After download it lives in
`<documentDirectory>/whisper/ggml-base.bin` and survives app updates.

When no network is available and the model is not yet downloaded, the app
announces the error via TTS and prompts the user to visit Speech Settings.

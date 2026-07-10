"""
Run this script ONCE to prepare YOLOv8n.tflite for the app.

Requirements:  pip install ultralytics
Output:        assets/models/yolov8n.tflite  (~6 MB)
After running: npx expo run:android
"""

import subprocess, sys, shutil
from pathlib import Path

# Only pre-install tf-keras — prevents ultralytics from hitting nvidia.com.
# All other TFLite deps (onnx2tf, ai-edge-litert) are installed automatically
# by ultralytics at export time using its own resolver.
print("Pre-installing tf-keras from PyPI...")
subprocess.check_call([
    sys.executable, '-m', 'pip', 'install', 'tf-keras', '--timeout', '120', '-q'
])

try:
    from ultralytics import YOLO
except ImportError:
    raise SystemExit("Run:  pip install ultralytics")

OUT_DIR = Path(__file__).parent.parent / "assets" / "models"
OUT_DIR.mkdir(parents=True, exist_ok=True)

print("Downloading YOLOv8n weights...")
model = YOLO("yolov8n.pt")

print("Exporting to TFLite float32 640x640...")
model.export(format="tflite", imgsz=640, half=False)

# Find exported file — look only in the saved_model directory to avoid picking up
# Android build artifacts (MLKit, etc.) from the android/ prebuild directory.
candidates = sorted(Path("yolov8n_saved_model").rglob("*float32*.tflite"))
if not candidates:
    candidates = sorted(Path("yolov8n_saved_model").rglob("*.tflite"))
if not candidates:
    raise FileNotFoundError("No .tflite file found in yolov8n_saved_model/")

src = candidates[0]
dst = OUT_DIR / "yolov8n.tflite"
shutil.copy(src, dst)
print(f"\nDone → {dst}  ({dst.stat().st_size // 1024} KB)")
print("Next: npx expo run:android")

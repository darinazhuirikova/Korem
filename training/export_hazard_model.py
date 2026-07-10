"""
Export the fine-tuned hazard YOLOv8n to TFLite float32.

⚠  SCAFFOLD ONLY — run after train_yolo_hazard.py produces best.pt.
   Output format is [1, 88, 8400] to match yolo.ts decodeOutput() layout
   (rows 0-3 = cx/cy/w/h; rows 4-87 = class scores for 84 classes = 80 COCO + 8 hazard).

Usage:
  pip install ultralytics tf-keras
  python training/export_hazard_model.py

Output: assets/models/yolov8n_city.tflite  (~13 MB float32)
"""

import subprocess, sys, shutil
from pathlib import Path

BEST_PT   = Path(__file__).parent / "runs" / "train" / "korem_hazard" / "weights" / "best.pt"
OUT_MODEL = Path(__file__).parent.parent / "assets" / "models" / "yolov8n_city.tflite"


def export():
    if not BEST_PT.exists():
        raise FileNotFoundError(
            f"Trained weights not found at {BEST_PT}.\n"
            "Run  python training/train_yolo_hazard.py  first."
        )

    # Pre-install tf-keras to avoid ultralytics hitting nvidia.com at export time
    subprocess.check_call([sys.executable, "-m", "pip", "install", "tf-keras", "-q"])

    try:
        from ultralytics import YOLO
    except ImportError:
        raise SystemExit("Install ultralytics:  pip install ultralytics")

    model = YOLO(str(BEST_PT))

    print("Exporting to TFLite float32 640×640 …")
    model.export(format="tflite", imgsz=640, half=False)

    # Find exported file in the saved_model directory
    saved_dir = BEST_PT.parent.parent / "best_saved_model"
    candidates = sorted(saved_dir.rglob("*float32*.tflite"))
    if not candidates:
        candidates = sorted(saved_dir.rglob("*.tflite"))
    if not candidates:
        raise FileNotFoundError(f"No .tflite found under {saved_dir}")

    src = candidates[0]
    OUT_MODEL.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(src, OUT_MODEL)
    print(f"\nDone → {OUT_MODEL}  ({OUT_MODEL.stat().st_size // 1024} KB)")
    print("Update lib/yolo.ts  initYolo()  to try yolov8n_city.tflite first (already does).")
    print("Next: python training/validate_hazard_model.py")


if __name__ == "__main__":
    export()

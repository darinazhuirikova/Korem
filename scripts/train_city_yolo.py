"""
Fine-tune YOLOv8n on a city navigation dataset.
Adds 4 new classes to COCO-80: sidewalk, road, crosswalk, curb.
Final model output: [1, 88, 8400]  (84 COCO + 4 city classes)

RECOMMENDED: Run on Google Colab with GPU runtime.
  https://colab.research.google.com → New notebook → Runtime → T4 GPU

Requirements:
  pip install ultralytics roboflow

Dataset options (pick one):
  A) Roboflow (easiest) — needs free account at roboflow.com
  B) Manual — put images in datasets/city/images/ with YOLO labels

Steps:
  1. pip install ultralytics roboflow
  2. Set ROBOFLOW_KEY below (or use MANUAL mode)
  3. python train_city_yolo.py
  4. Copy runs/detect/city_yolo/weights/best.tflite → assets/models/yolov8n_city.tflite
  5. npx expo run:android
"""

import os, shutil, subprocess, sys
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────
ROBOFLOW_KEY  = ""          # get free key at app.roboflow.com → Settings → API
ROBOFLOW_WS   = ""          # your workspace slug
ROBOFLOW_PROJ = "urban-street-navigation"  # project name
ROBOFLOW_VER  = 1

EPOCHS    = 100
IMG_SIZE  = 640
BATCH     = 16             # reduce to 8 if you get OOM errors

# City classes (appended after COCO-80)
CITY_CLASSES = ["sidewalk", "road", "crosswalk", "curb"]

OUT_DIR = Path(__file__).parent.parent / "assets" / "models"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# ── Dataset YAML (manual fallback) ───────────────────────────────────────────
MANUAL_YAML = Path("datasets/city/dataset.yaml")

def write_manual_yaml():
    """
    Use this if you have your own labeled images.
    Structure:
      datasets/city/images/train/*.jpg
      datasets/city/images/val/*.jpg
      datasets/city/labels/train/*.txt   (YOLO format)
      datasets/city/labels/val/*.txt
    Each .txt: class_id cx cy w h  (normalized 0-1)
    class_ids: 0=sidewalk 1=road 2=crosswalk 3=curb
    """
    MANUAL_YAML.parent.mkdir(parents=True, exist_ok=True)
    MANUAL_YAML.write_text(f"""
path: {Path('datasets/city').resolve()}
train: images/train
val:   images/val

nc: {len(CITY_CLASSES)}
names: {CITY_CLASSES}
""".strip())
    print(f"Created {MANUAL_YAML}")
    print("Add your images and labels then re-run.")

# ── Download from Roboflow ────────────────────────────────────────────────────
def download_roboflow() -> Path:
    from roboflow import Roboflow
    rf = Roboflow(api_key=ROBOFLOW_KEY)
    proj = rf.workspace(ROBOFLOW_WS).project(ROBOFLOW_PROJ)
    ds = proj.version(ROBOFLOW_VER).download("yolov8")
    return Path(ds.location) / "data.yaml"

# ── Train ─────────────────────────────────────────────────────────────────────
def train(yaml_path: Path):
    from ultralytics import YOLO

    print(f"\nTraining YOLOv8n on {yaml_path} for {EPOCHS} epochs...")
    model = YOLO("yolov8n.pt")           # start from COCO pretrained weights
    results = model.train(
        data=str(yaml_path),
        epochs=EPOCHS,
        imgsz=IMG_SIZE,
        batch=BATCH,
        name="city_yolo",
        project="runs/detect",
        patience=20,                      # early stop if no improvement
        augment=True,
        hsv_h=0.015, hsv_s=0.5, hsv_v=0.3,
        flipud=0.1,
        mosaic=1.0,
    )
    return Path(results.save_dir) / "weights" / "best.pt"

# ── Export to TFLite ──────────────────────────────────────────────────────────
def export_tflite(best_pt: Path) -> Path:
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'tf-keras', '-q'])
    from ultralytics import YOLO

    print("\nExporting to TFLite...")
    model = YOLO(str(best_pt))
    model.export(format="tflite", imgsz=IMG_SIZE, half=False)

    candidates = sorted(best_pt.parent.rglob("*.tflite"))
    if not candidates:
        raise FileNotFoundError("No .tflite after export")
    return candidates[0]

# ── Main ──────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    if ROBOFLOW_KEY:
        yaml_path = download_roboflow()
    elif MANUAL_YAML.exists():
        yaml_path = MANUAL_YAML
    else:
        write_manual_yaml()
        sys.exit(0)

    best_pt   = train(yaml_path)
    tflite    = export_tflite(best_pt)

    dst = OUT_DIR / "yolov8n_city.tflite"
    shutil.copy(tflite, dst)
    print(f"\nDone → {dst}  ({dst.stat().st_size // 1024} KB)")
    print("Next: update YOLO_MODEL_PATH in lib/yolo.ts to 'yolov8n_city.tflite'")
    print("      update CLASS_COUNT in lib/yolo.ts to match your nc value")

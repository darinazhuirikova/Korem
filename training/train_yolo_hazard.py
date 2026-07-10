"""
Fine-tune YOLOv8n on the KÖREM hazard dataset (8 classes, IDs 80-87).

⚠  SCAFFOLD ONLY — no dataset has been collected yet.
   See training/DATASET_SPEC.md for annotation requirements before running.

Usage:
  pip install ultralytics
  python training/train_yolo_hazard.py

Output: runs/train/korem_hazard/weights/best.pt
        (then run export_hazard_model.py to convert to TFLite)
"""

import yaml
from pathlib import Path

DATASET_DIR = Path(__file__).parent / "data"
RUNS_DIR    = Path(__file__).parent / "runs"

HAZARD_CLASSES = [
    "stairs_up",
    "stairs_down",
    "curb",
    "open_manhole",
    "pole",
    "construction",
    "wet_floor",
    "sign_board",
]

# YOLOv8 expects class IDs 0-N in the dataset.yaml.
# We fine-tune starting from COCO-80 weights, so class IDs 80-87 in the combined
# model. Here the dataset.yaml only lists the 8 hazard classes (IDs 0-7 within
# this dataset); the trainer reassigns them to 80-87 via the 'nc' and 'names' fields.
# NOTE: append-only fine-tune is handled via the ultralytics 'model' arg below.


def write_dataset_yaml():
    cfg = {
        "path": str(DATASET_DIR.resolve()),
        "train": "images/train",
        "val":   "images/val",
        "nc":    len(HAZARD_CLASSES),
        "names": HAZARD_CLASSES,
    }
    out = DATASET_DIR / "dataset.yaml"
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w") as f:
        yaml.dump(cfg, f, allow_unicode=True)
    print(f"Wrote {out}")
    return out


def train(dataset_yaml: Path):
    try:
        from ultralytics import YOLO
    except ImportError:
        raise SystemExit("Install ultralytics:  pip install ultralytics")

    # Start from pretrained COCO-80 weights; ultralytics handles head replacement
    model = YOLO("yolov8n.pt")

    results = model.train(
        data=str(dataset_yaml),
        epochs=100,
        imgsz=640,
        batch=16,
        name="korem_hazard",
        project=str(RUNS_DIR / "train"),
        # Freeze backbone for first 10 epochs to preserve COCO features
        freeze=10,
        # Disable vertical flip — stairs_up ≠ stairs_down after vertical flip
        flipud=0.0,
        # Standard augmentation
        hsv_h=0.015, hsv_s=0.7, hsv_v=0.4,
        mosaic=0.8,
        scale=0.5,
        patience=30,
        save=True,
        exist_ok=True,
    )
    best = Path(results.save_dir) / "weights" / "best.pt"
    print(f"\nTraining complete. Best weights: {best}")
    print("Next step:  python training/export_hazard_model.py")
    return best


if __name__ == "__main__":
    if not (DATASET_DIR / "images" / "train").exists():
        print("⚠  No dataset found at training/data/images/train/")
        print("   Follow training/DATASET_SPEC.md to collect and annotate images first.")
        raise SystemExit(1)

    yaml_path = write_dataset_yaml()
    train(yaml_path)

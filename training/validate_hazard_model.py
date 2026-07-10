"""
Validate the exported hazard TFLite model on the val split.

⚠  SCAFFOLD ONLY — run after export_hazard_model.py.

Reports per-class AP and overall mAP50 on the validation set.

Usage:
  pip install ultralytics
  python training/validate_hazard_model.py
"""

from pathlib import Path

MODEL_PATH  = Path(__file__).parent.parent / "assets" / "models" / "yolov8n_city.tflite"
DATASET_DIR = Path(__file__).parent / "data"
YAML_PATH   = DATASET_DIR / "dataset.yaml"
RUNS_DIR    = Path(__file__).parent / "runs" / "val"


def validate():
    if not MODEL_PATH.exists():
        raise FileNotFoundError(
            f"Model not found at {MODEL_PATH}.\n"
            "Run  python training/export_hazard_model.py  first."
        )
    if not YAML_PATH.exists():
        raise FileNotFoundError(
            f"Dataset YAML not found at {YAML_PATH}.\n"
            "Run  python training/train_yolo_hazard.py  once to generate it."
        )

    try:
        from ultralytics import YOLO
    except ImportError:
        raise SystemExit("Install ultralytics:  pip install ultralytics")

    model = YOLO(str(MODEL_PATH), task="detect")

    metrics = model.val(
        data=str(YAML_PATH),
        imgsz=640,
        conf=0.45,
        iou=0.45,
        split="val",
        name="korem_hazard_val",
        project=str(RUNS_DIR),
        save_json=True,
        exist_ok=True,
    )

    print("\n=== Validation results ===")
    print(f"mAP50:    {metrics.box.map50:.4f}")
    print(f"mAP50-95: {metrics.box.map:.4f}")
    print("\nPer-class AP50:")
    hazard_classes = [
        "stairs_up", "stairs_down", "curb", "open_manhole",
        "pole", "construction", "wet_floor", "sign_board",
    ]
    for name, ap in zip(hazard_classes, metrics.box.ap50):
        print(f"  {name:<20} {ap:.4f}")

    print(f"\nFull results saved to {RUNS_DIR}")


if __name__ == "__main__":
    validate()

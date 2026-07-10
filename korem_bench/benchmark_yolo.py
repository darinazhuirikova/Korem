"""
benchmark_yolo.py — точность детекции (mAP, precision, recall).

Что измеряет: mAP@0.5, mAP@0.5:0.95, precision, recall — общие и по классам.
Что НЕ измеряет: задержку на телефоне (только on-device профилирование).

ТЕКУЩИЙ ЗАПУСК: базовая YOLOv8n на COCO val 2017.
  Модель: yolov8n.pt (COCO pretrained, не дообучена)
  Датасет: COCO val 2017 (~5000 изображений, ~36k объектов, 80 классов)
  Это BASELINE — метрики до любого дообучения на навигационных данных.

Для статьи нужно дополнительно:
  - Дообучить на размеченных пешеходных сценах (stairs, curb, crosswalk)
  - Прогнать на held-out test split того же датасета

Установка:  pip install ultralytics
Запуск:     python korem_bench/benchmark_yolo.py
"""
from pathlib import Path
from ultralytics import YOLO

ROOT      = Path(__file__).parent.parent
BENCH_DIR = Path(__file__).parent
WEIGHTS   = ROOT / "yolov8n.pt"                              # COCO pretrained baseline
DATA_YAML = str(BENCH_DIR / "coco_val_only.yaml")            # только val, без скачивания train/test
SPLIT     = "val"

# Классы критичные для KÖREM — что есть в COCO-80
CRITICAL_COCO = ["person", "car", "bus", "truck", "bicycle", "motorcycle",
                 "traffic light", "stop sign"]
# Классы которых НЕТ в COCO-80 (нужен дообученный датасет):
MISSING = ["stairs", "curb", "crosswalk"]

print("=" * 60)
print("KÖREM — Benchmark YOLO (baseline, COCO val 2017)")
print(f"Модель:   {WEIGHTS.name}")
print(f"Датасет:  coco_val_only.yaml  split={SPLIT}")
print("=" * 60)
print(f"[!] Это BASELINE. Классы {MISSING} в COCO отсутствуют.")
print()

model   = YOLO(str(WEIGHTS))

metrics = model.val(data=DATA_YAML, imgsz=640, split=SPLIT, verbose=False)

print(f"\nmAP@0.5        : {metrics.box.map50:.4f}")
print(f"mAP@0.5:0.95   : {metrics.box.map:.4f}")
print(f"Precision (avg): {metrics.box.mp:.4f}")
print(f"Recall (avg)   : {metrics.box.mr:.4f}")
print("-" * 60)
print("По навигационно-критичным классам (COCO):")

idx_of = {model.names[c]: i for i, c in enumerate(metrics.box.ap_class_index)}
for name in CRITICAL_COCO:
    if name in idx_of:
        i = idx_of[name]
        print(f"  {name:15s}  P={metrics.box.p[i]:.3f}  "
              f"R={metrics.box.r[i]:.3f}  AP@0.5={metrics.box.ap50[i]:.3f}")
    else:
        print(f"  {name:15s}  нет в датасете")

print("-" * 60)
print("Классы отсутствующие в COCO (нет данных):")
for name in MISSING:
    print(f"  {name:15s}  нет данных — нужен дообученный датасет")

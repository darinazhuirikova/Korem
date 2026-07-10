"""
verify_pidnet.py — санитарная проверка assets/models/pidnet_s.tflite

Запуск (базовый):
    python scripts/verify_pidnet.py

Запуск с реальным изображением (создаёт *_seg.png рядом):
    python scripts/verify_pidnet.py path/to/photo.jpg

Устанавливает автоматически: pillow (только для визуализации).
"""
import sys, subprocess
import numpy as np
from pathlib import Path

MODEL  = Path(__file__).parent.parent / "assets" / "models" / "pidnet_s.tflite"
H, W   = 128, 256
MEAN   = np.array([0.485, 0.456, 0.406], dtype=np.float32)
STD    = np.array([0.229, 0.224, 0.225], dtype=np.float32)

NAMES  = [
    "road", "sidewalk", "building", "wall", "fence", "pole",
    "traffic light", "traffic sign", "vegetation", "terrain", "sky",
    "person", "rider", "car", "truck", "bus", "train", "motorcycle", "bicycle",
]
COLORS = [
    (128, 64,128),(244, 35,232),(70, 70, 70),(102,102,156),(190,153,153),
    (153,153,153),(250,170, 30),(220,220,  0),(107,142, 35),(152,251,152),
    ( 70,130,180),(220, 20, 60),(255,  0,  0),(  0,  0,142),(  0,  0, 70),
    (  0, 60,100),(  0, 80,100),(  0,  0,230),(119, 11, 32),
]

# ── 1. Проверка файла ─────────────────────────────────────────────────────────
print("=" * 56)
print("PIDNet-S TFLite — верификация модели")
print("=" * 56)

if not MODEL.exists():
    print(f"✗ Файл не найден: {MODEL}")
    print("  Запусти: python scripts/convert_pidnet.py")
    sys.exit(1)

size_kb = MODEL.stat().st_size // 1024
print(f"✓ Файл найден: {MODEL.name}  ({size_kb} KB)")

# ── 2. Загрузка модели ────────────────────────────────────────────────────────
try:
    from ai_edge_litert.interpreter import Interpreter
except ImportError:
    print("  Устанавливаю ai-edge-litert...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "ai-edge-litert", "-q"])
    from ai_edge_litert.interpreter import Interpreter

try:
    interp = Interpreter(str(MODEL))
    interp.allocate_tensors()
    print("✓ Модель загружена и инициализирована")
except Exception as e:
    print(f"✗ Ошибка загрузки: {e}")
    sys.exit(1)

# ── 3. Проверка форм тензоров ─────────────────────────────────────────────────
inp_d = interp.get_input_details()[0]
out_d = interp.get_output_details()[0]

print(f"\nВход:  shape={inp_d['shape'].tolist()}  dtype={inp_d['dtype'].__name__}")
print(f"Выход: shape={out_d['shape'].tolist()}  dtype={out_d['dtype'].__name__}")

exp_in  = [1, H, W, 3]
exp_out_ok = (out_d['shape'].tolist() == [1, H, W] or
              out_d['shape'].tolist() == [1, H, W, 19])

if inp_d['shape'].tolist() != exp_in:
    print(f"⚠ Неожиданная форма входа. Ожидалось {exp_in}")
else:
    print(f"✓ Форма входа верна: {exp_in}")

if not exp_out_ok:
    print(f"⚠ Неожиданная форма выхода: {out_d['shape'].tolist()}")
else:
    print(f"✓ Форма выхода верна")

# ── 4. Инференс на нулевом тензоре ───────────────────────────────────────────
dummy = np.zeros([1, H, W, 3], dtype=np.float32)
interp.set_tensor(inp_d['index'], dummy)
interp.invoke()
zero_out = interp.get_tensor(out_d['index'])
print(f"\n✓ Инференс (нулевой вход): min={zero_out.min()}  max={zero_out.max()}")

# ── 5. Инференс на случайном шуме (ImageNet-normalized диапазон) ──────────────
rng  = np.random.default_rng(42)
noise = ((rng.random((1, H, W, 3), dtype=np.float32) - MEAN) / STD).astype(np.float32)
interp.set_tensor(inp_d['index'], noise)
interp.invoke()
noise_out = interp.get_tensor(out_d['index'])

if noise_out.ndim == 4:                      # [1, H, W, 19] logits
    mask = noise_out[0].argmax(axis=-1)
else:                                         # [1, H, W] argmax
    mask = noise_out[0]

unique_cls = np.unique(mask)
in_range   = (mask.min() >= 0 and mask.max() <= 18)
print(f"✓ Инференс (случайный шум): {len(unique_cls)} уникальных классов, "
      f"диапазон [{mask.min()}, {mask.max()}]  "
      f"{'✓ в диапазоне 0-18' if in_range else '✗ ВНЕ диапазона!'}")

# ── 6. Реальное изображение (опционально) ─────────────────────────────────────
if len(sys.argv) > 1:
    img_path = Path(sys.argv[1])
    if not img_path.exists():
        print(f"\n✗ Изображение не найдено: {img_path}")
        sys.exit(1)

    try:
        from PIL import Image
    except ImportError:
        print("\n  Устанавливаю pillow...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "pillow", "-q"])
        from PIL import Image

    img     = Image.open(img_path).convert("RGB").resize((W, H))
    arr     = (np.array(img, dtype=np.float32) / 255.0 - MEAN) / STD
    tensor  = arr[np.newaxis].astype(np.float32)

    interp.set_tensor(inp_d['index'], tensor)
    interp.invoke()
    raw = interp.get_tensor(out_d['index'])
    mask = raw[0].argmax(axis=-1) if raw.ndim == 4 else raw[0]

    # Раскрашиваем маску
    rgb = np.zeros((H, W, 3), dtype=np.uint8)
    for c, color in enumerate(COLORS):
        rgb[mask == c] = color

    # Сохраняем x4 для удобного просмотра
    out_path = img_path.parent / (img_path.stem + "_seg.png")
    Image.fromarray(rgb).resize((W * 4, H * 4), Image.NEAREST).save(out_path)
    print(f"\n✓ Визуализация сохранена → {out_path}")

    # Топ-5 классов
    unique, counts = np.unique(mask.astype(int), return_counts=True)
    total = mask.size
    print("\nТоп-5 классов в кадре:")
    for cls, cnt in sorted(zip(unique.tolist(), counts.tolist()), key=lambda x: -x[1])[:5]:
        bar = "█" * int(cnt / total * 30)
        print(f"  {cls:2d}  {NAMES[cls]:18s}  {cnt/total*100:5.1f}%  {bar}")
else:
    print("\n  Подсказка: передай фото для визуализации:")
    print(f"  python scripts/verify_pidnet.py путь/к/фото.jpg")

print("\n" + "=" * 56)
ok = in_range and inp_d['shape'].tolist() == exp_in
print("ИТОГ:", "✓ Модель исправна" if ok else "✗ Есть проблемы — см. выше")
print("=" * 56)

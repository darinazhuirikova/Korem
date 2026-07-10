"""
Скачивает только val2017 изображения COCO (777 МБ) в уже существующую папку.
Пропускает train и test — они не нужны для benchmark.

Запуск: python korem_bench/download_coco_val.py
"""
import urllib.request, zipfile, shutil
from pathlib import Path

DATASETS_DIR = Path(r"C:\Users\user\Korem\webcam\datasets\coco")
VAL_ZIP      = DATASETS_DIR / "images" / "val2017.zip"
VAL_DIR      = DATASETS_DIR / "images" / "val2017"
URL          = "http://images.cocodataset.org/zips/val2017.zip"

if len(list(VAL_DIR.glob("*.jpg"))) >= 4900:
    print(f"val2017 уже есть ({len(list(VAL_DIR.glob('*.jpg')))} изображений) — ничего не делаем.")
else:
    print(f"Скачиваю {URL}")
    print("Размер: ~777 МБ — ~10-15 минут на хорошем интернете")

    def progress(block, block_size, total):
        pct = block * block_size / total * 100
        mb  = block * block_size / 1e6
        print(f"\r  {pct:5.1f}%  {mb:.0f}/{total/1e6:.0f} МБ", end="", flush=True)

    VAL_ZIP.parent.mkdir(parents=True, exist_ok=True)
    urllib.request.urlretrieve(URL, VAL_ZIP, progress)
    print()

    print("Распаковываю...")
    with zipfile.ZipFile(VAL_ZIP, "r") as z:
        z.extractall(DATASETS_DIR / "images")

    VAL_ZIP.unlink()
    count = len(list(VAL_DIR.glob("*.jpg")))
    print(f"Готово: {count} изображений в {VAL_DIR}")

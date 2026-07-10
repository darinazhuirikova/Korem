"""
benchmark_ocr.py — точность OCR (CER, WER) + задержка API.

Что измеряет: CER, WER, точность определения языка, задержку обращения
к Google Vision API (p50, p95).
Важно: измеряется задержка ТОЛЬКО сетевого запроса к API, а не полный
путь "захват кадра -> препроцессинг -> ответ -> начало озвучивания".

Требуется заранее:
  1) Тестовый набор: реальные фото вывесок + точная ручная транскрипция.
     Минимум ~200 пар. Формат manifest.csv (UTF-8), две колонки:
        image_path,ground_truth
        signs/img001.jpg,Қабылдау бөлмесі
        signs/img002.jpg,Аптека 24 часа
     ВНИМАНИЕ: без честной ручной разметки число CER не имеет смысла.
  2) Ключ Google Cloud Vision API с включённым биллингом
     (стоимость ~$1.5 за 1000 изображений).

Установка:  pip install jiwer requests
Запуск:     GOOGLE_VISION_KEY=xxxx python benchmark_ocr.py
"""
import os, csv, time, base64, statistics, requests, jiwer

KEY = os.environ["GOOGLE_VISION_KEY"]      # ключ берём из окружения, не из кода
MANIFEST = "manifest.csv"                   # TODO: ваш файл разметки
HINTS = ["ru", "en", "kk"]
URL = f"https://vision.googleapis.com/v1/images:annotate?key={KEY}"

rows = []
with open(MANIFEST, encoding="utf-8") as f:
    for row in csv.DictReader(f):
        rows.append((row["image_path"], row["ground_truth"]))

cers, wers, lats, lang_ok = [], [], [], 0
for img_path, gt in rows:
    b64 = base64.b64encode(open(img_path, "rb").read()).decode()
    body = {"requests": [{
        "image": {"content": b64},
        "features": [{"type": "TEXT_DETECTION"}],
        "imageContext": {"languageHints": HINTS},
    }]}
    t0 = time.time()
    resp = requests.post(URL, json=body, timeout=30).json()
    lats.append((time.time() - t0) * 1000)

    ann = resp["responses"][0].get("fullTextAnnotation", {})
    hyp = ann.get("text", "").strip()
    cers.append(jiwer.cer(gt, hyp))     # правильная функция CER, не wer по символам
    wers.append(jiwer.wer(gt, hyp))
    # язык доминирующего блока, если Vision его вернул:
    try:
        lang = ann["pages"][0]["property"]["detectedLanguages"][0]["languageCode"]
        lang_ok += int(lang[:2] in HINTS)
    except Exception:
        pass

n = len(rows)
print(f"N             : {n}")
print(f"CER (mean)    : {statistics.mean(cers)*100:.2f}%")
print(f"WER (mean)    : {statistics.mean(wers)*100:.2f}%")
print(f"Lang accuracy : {lang_ok/n*100:.1f}%")
print(f"Latency p50   : {statistics.median(lats):.0f} ms")
print(f"Latency p95   : {statistics.quantiles(lats, n=20)[18]:.0f} ms")

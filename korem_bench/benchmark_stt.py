"""
benchmark_stt.py — точность распознавания речи (WER) для RU/EN/KK.

Что измеряет: WER офлайн-модели (Whisper tiny, PyTorch) и облачной (whisper-1).
ЧЕСТНОЕ ОГРАНИЧЕНИЕ: PyTorch-модель "tiny" — это ПРОКСИ для вашей on-device
TFLite-сборки, а не она сама. Реальный on-device WER может отличаться.
В статье это надо указать прямо: "офлайн-WER измерен на эталонной
PyTorch-реализации Whisper tiny как приближение к развёрнутой TFLite-модели".

Требуется заранее:
  1) Тестовые выборки Common Voice для kk / ru / en
     (commonvoice.mozilla.org -> Datasets, нужна регистрация и согласие
     с лицензией). Каждая содержит validated.tsv с колонками path, sentence
     и папку clips/ с .mp3.
  2) ffmpeg в системе (нужен whisper):  apt-get install ffmpeg
  3) Для облачного пути — ключ OpenAI (опционально).

Установка:  pip install -U openai-whisper jiwer openai
Запуск:     python benchmark_stt.py
"""
import csv, os, whisper, jiwer

# TODO: укажите свои пути. limit — сколько клипов брать (для пробы поставьте 100).
SUBSETS = {
    "kk": {"tsv": "cv/kk/validated.tsv", "clips": "cv/kk/clips", "lang": "kk"},
    "ru": {"tsv": "cv/ru/validated.tsv", "clips": "cv/ru/clips", "lang": "ru"},
    "en": {"tsv": "cv/en/validated.tsv", "clips": "cv/en/clips", "lang": "en"},
}
LIMIT = 300
RUN_CLOUD = False   # True, если хотите ещё и whisper-1 API (нужен OPENAI_API_KEY)

norm = jiwer.Compose([jiwer.ToLowerCase(), jiwer.RemovePunctuation(),
                      jiwer.RemoveMultipleSpaces(), jiwer.Strip()])
model = whisper.load_model("tiny")          # офлайн-прокси

if RUN_CLOUD:
    from openai import OpenAI
    client = OpenAI()

for code, s in SUBSETS.items():
    if not os.path.exists(s["tsv"]):
        print(f"{code}: пропуск (нет {s['tsv']})"); continue
    refs, hyp_off, hyp_cloud = [], [], []
    with open(s["tsv"], encoding="utf-8") as f:
        for i, row in enumerate(csv.DictReader(f, delimiter="\t")):
            if i >= LIMIT: break
            path = os.path.join(s["clips"], row["path"])
            refs.append(row["sentence"])
            hyp_off.append(model.transcribe(path, language=s["lang"])["text"])
            if RUN_CLOUD:
                with open(path, "rb") as af:
                    hyp_cloud.append(client.audio.transcriptions.create(
                        model="whisper-1", file=af, language=s["lang"]).text)
    wer_off = jiwer.wer(norm(refs), norm(hyp_off)) * 100
    line = f"{code}: WER offline = {wer_off:.1f}% (n={len(refs)})"
    if RUN_CLOUD:
        line += f" | WER cloud = {jiwer.wer(norm(refs), norm(hyp_cloud))*100:.1f}%"
    print(line)

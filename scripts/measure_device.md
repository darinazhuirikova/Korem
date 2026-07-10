# KÖREM — Протокол измерений на устройстве

## Важно: только release-сборка

Debug-сборка работает через Metro bundler и JS интерпретатор без JIT.
На Android release-сборка даёт Hermes AOT — разница в latency составляет 3-10×.
Все числа для статьи — только с release-сборки.

```bash
# Сборка release APK
npx expo run:android --variant release

# Или через EAS Build (рекомендуется — воспроизводимо):
eas build --platform android --profile production
```

---

## Как снять Perf-метрики

Метки уже вставлены в код. Dump выводится:
- **Автоматически каждые 60 секунд** в Metro console и `adb logcat`.
- **Вручную**: можно добавить кнопку в dev-меню или долгое нажатие.

```bash
# Смотреть дамп в реальном времени (подключи телефон по USB):
adb logcat | grep -E "\[PERF\]"

# Сохранить в файл:
adb logcat | grep "\[PERF\]" > perf_results.txt
```

Ключи меток и что они измеряют:

| Ключ | Что измеряет |
|---|---|
| `yolo_load` | Загрузка модели YOLOv8n TFLite до готовности |
| `pidnet_load` | Загрузка модели PIDNet-S TFLite до готовности |
| `yolo_capture` | takePictureAsync для YOLO кадра |
| `yolo_preprocess` | Resize + JPEG decode + /255 нормализация |
| `yolo_infer` | _model.runSync — чистый инференс TFLite |
| `yolo_nms` | decodeOutput + NMS |
| `yolo_tracker` | updateTracks (centroid matching) |
| `yolo_cycle` | Полный цикл YOLO (capture→announce) |
| `pidnet_capture` | takePictureAsync для PIDNet кадра |
| `pidnet_preprocess` | Resize + JPEG decode + ImageNet normalize |
| `pidnet_infer` | _model.runSync — чистый инференс TFLite |
| `pidnet_postprocess` | toMask + buildGrid + buildHazards |
| `pidnet_cycle` | Полный цикл PIDNet (внутри runSegmentation) |
| `pidnet_loop` | Полный loop включая capture |
| `stt_cloud_rtt` | Конец записи → ответ Whisper proxy (облако) |
| `stt_path_chosen` | 0 = облако, 1 = локальный whisper-base |
| `stt_local_infer` | Чистый инференс whisper.cpp на устройстве |
| `stt_local_total` | Полный локальный путь (сеть + загрузка контекста + инференс) |
| `nlu_cloud_rtt` | Запрос → ответ GPT-4o-mini |
| `nlu_fallback` | Время regex-фоллбека NLU |
| `voice_pipeline_rtt` | Конец аудио → готово к TTS (STT + NLU) |
| `ocr_rtt` | Запрос → ответ Google Vision API |
| `directions_rtt` | Запрос → ответ Google Directions API |
| `vision_api_rtt` | Vision API fallback (когда модели не загружены) |

---

## Сценарии и количество повторений

### Сценарий 1 — Непрерывная детекция (YOLO + PIDNet)
**Цель:** latency инференса, реальный FPS, энергопотребление.

1. Открыть вкладку "Камера", режим DETECT.
2. Направить камеру на улицу с пешеходами и транспортом.
3. **5 минут** непрерывно.
4. После — снять adb logcat dump.

Ожидаемое число замеров: ~600 циклов YOLO, ~200 циклов PIDNet.

### Сценарий 2 — Голосовые команды
**Цель:** STT latency, NLU latency, полное время отклика ассистента.

1. Подготовить список из 20 команд на RU/EN/KK (по ~7 каждый).
2. Произносить каждую команду отчётливо, нажимая кнопку.
3. Фиксировать субъективное время отклика (слышишь TTS) и сравнивать с `voice_pipeline_rtt`.

Примеры команд: "настройки языка", "открой камеру", "язык казахский",
"settings", "camera", "navigation", "Тіл параметрлері".

### Сценарий 3 — OCR (чтение текста)
**Цель:** latency Google Vision API, точность языка.

1. Направить на вывески: на кириллице (RU/KK) и латинице (EN).
2. **10 снимков** в режиме OCR — ручная кнопка.
3. Снять `ocr_rtt` из dump.

### Сценарий 4 — Запуск приложения (время загрузки моделей)
**Цель:** `yolo_load`, `pidnet_load`.

1. Полностью закрыть приложение (Force Stop).
2. Запустить. Открыть вкладку Camera.
3. Дождаться появления бейджа "YOLO + PIDNet".
4. Повторить **10 раз**, записывать каждый раз из dump.

### Сценарий 5 — Построение маршрута
**Цель:** `directions_rtt`, субъективная задержка GPS.

1. Запустить Navigation, назвать несколько адресов (10 запросов).
2. Фиксировать `directions_rtt` из dump.

---

## Команды adb — Память

```bash
# Текущий PSS (Proportional Set Size) — самая репрезентативная метрика памяти:
adb shell dumpsys meminfo com.korem.app | grep -E "TOTAL PSS|Native Heap|Dalvik Heap"

# Полный отчёт:
adb shell dumpsys meminfo com.korem.app
```

**Что записывать: PSS Total (МБ)** в каждом режиме.

| Режим | Команда/действие | Записать |
|---|---|---|
| Idle (главный экран) | приложение открыто, ничего не делаем | PSS Total |
| DETECT (YOLO+PIDNet) | 30 с в режиме детекции | PSS Total |
| OCR | 30 с в режиме OCR | PSS Total |
| Navigation | маршрут построен, идём 1 мин | PSS Total |

---

## Энергопотребление — Протокол

### Метод 1: Простой (через % заряда)
1. Зарядить до 100%, отключить зарядку.
2. Запустить каждый сценарий на **20 минут**.
3. Записать % заряда до и после.
4. Пересчитать: `%/час = (снижение%) / (20/60)`.

| Сценарий | % начало | % конец | Снижение | %/час |
|---|---|---|---|---|
| Idle | | | | |
| DETECT (YOLO+PIDNet) | | | | |
| OCR continuous | | | | |
| Navigation | | | | |

### Метод 2: adb batterystats (точнее)
```bash
# Сброс статистики:
adb shell dumpsys batterystats --reset

# Запустить сценарий (20 мин)...

# Снять статистику:
adb shell dumpsys batterystats com.korem.app > battery_detect.txt

# Ключевые строки: "Estimated power use" и "CPU:"
grep -E "Estimated|CPU:|uid" battery_detect.txt
```

---

## Шаблон таблицы результатов

Заполни после измерений:

| Метрика | Режим | Median (мс) | P95 (мс) | N замеров | Условия |
|---|---|---|---|---|---|
| yolo_capture | DETECT | | | | телефон, release APK |
| yolo_preprocess | DETECT | | | | |
| yolo_infer | DETECT | | | | |
| yolo_nms | DETECT | | | | |
| yolo_cycle (full) | DETECT | | | | fps = 1000/median |
| pidnet_preprocess | DETECT | | | | |
| pidnet_infer | DETECT | | | | |
| pidnet_postprocess | DETECT | | | | |
| pidnet_cycle | DETECT | | | | |
| stt_cloud_rtt | Voice | | | | WiFi / 4G |
| nlu_cloud_rtt | Voice | | | | WiFi / 4G |
| voice_pipeline_rtt | Voice | | | | STT+NLU combined |
| ocr_rtt | OCR | | | | |
| directions_rtt | Navigation | | | | |
| yolo_load | Startup | | | | cold start ×10 |
| pidnet_load | Startup | | | | cold start ×10 |
| Memory PSS | DETECT | (МБ) | — | — | |
| Memory PSS | Idle | (МБ) | — | — | |
| Energy | DETECT | (%/час) | — | — | |
| Energy | Navigation | (%/час) | — | — | |

---

## Примечания для статьи

- Указывай устройство: модель, SoC, RAM, Android версию.
- STT/NLU latency зависит от сети — указывай тип (WiFi / 4G / 5G) и регион.
- on-device latency (YOLO, PIDNet) не зависит от сети — воспроизводимо.
- Для YOLO/PIDNet latency: p95 важнее mean (хвост = реальные задержки при нагрузке).
- Energy: метод через % заряда имеет погрешность ±5%; batterystats точнее, но требует root или USB.

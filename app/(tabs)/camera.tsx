/**
 * Camera screen — три режима:
 *   DETECT : Гибрид PIDNet-S (поверхность) + YOLOv8n (объекты) + Centroid Tracker
 *   OCR    : Автоматическое чтение текста (1 кадр/с) + ручная кнопка
 *   SCENE  : Описание сцены через GPT-4o-mini Vision (по нажатию)
 *
 * Логика детекции:
 *   YOLO цикл (500ms)  — bbox людей/авто/автобусов + centroid tracker
 *   PIDNet цикл (1500ms) — сегментация поверхности (19 классов Cityscapes)
 *   Оба запускаются независимо; TTS объединяет предупреждения.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';
import { Ionicons } from '@expo/vector-icons';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { initPidnet, runSegmentation, isPidnetReady, SegResult } from '../../lib/pidnet';
import { initYolo, detectObjects, isYoloReady, Detection } from '../../lib/yolo';
import { updateTracks, resetTracker, TrackedDetection } from '../../lib/tracker';
import { Perf } from '../../lib/perf';
import { recognizeText } from '../../lib/ocr';
import { translateText, SupportedLang } from '../../lib/translate';
import { describeScene } from '../../lib/scene';
import {
  HIGH_PRIORITY_CLASSES,
  MEDIUM_PRIORITY_CLASSES,
  CLOSE_THRESHOLD,
} from '../../constants/cocoLabels';

// ─── Vision API fallback (когда обе модели не загружены) ─────────────────────
const VISION_KEY = process.env.EXPO_PUBLIC_GOOGLE_KEY ?? '';
type VisionObj = {
  name: string; score: number;
  boundingPoly: { normalizedVertices: { x: number; y: number }[] };
};

async function visionDetect(base64: string): Promise<Detection[]> {
  try {
    const res = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${VISION_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{ image: { content: base64 }, features: [{ type: 'OBJECT_LOCALIZATION' }] }],
        }),
      }
    );
    const json = await res.json();
    const objs: VisionObj[] = json?.responses?.[0]?.localizedObjectAnnotations ?? [];
    return objs.map(o => {
      const xs = o.boundingPoly.normalizedVertices.map(v => v.x ?? 0);
      const ys = o.boundingPoly.normalizedVertices.map(v => v.y ?? 0);
      return {
        classId: -1, label: o.name, labelEn: o.name, confidence: o.score,
        x1: Math.min(...xs), y1: Math.min(...ys),
        x2: Math.max(...xs), y2: Math.max(...ys),
      };
    });
  } catch { return []; }
}

// ─── Constants ────────────────────────────────────────────────────────────────
const YOLO_INTERVAL_MS    = 500;
const PIDNET_INTERVAL_MS  = 1500;
const OCR_INTERVAL_MS     = 1000;
const PHOTO_QUALITY       = 0.4;
const TTS_COOLDOWN_MS     = 4000;
const TTS_MOVING_COOLDOWN = 2000;
const BUS_OCR_COOLDOWN_MS = 10000;

type Mode = 'DETECT' | 'OCR';

export default function CameraScreen() {
  const camRef = useRef<any>(null);
  const [permission, requestPermission] = useCameraPermissions();

  const [ready, setCameraReady] = useState(false);
  const [mode, setMode] = useState<Mode>('DETECT');
  const [busy, setBusy] = useState(false);

  // ── DETECT state ─────────────────────────────────────────────────────────
  const [detections, setDetections] = useState<TrackedDetection[]>([]);
  const [segResult, setSegResult] = useState<SegResult | null>(null);
  const [frameW, setFrameW] = useState(1);
  const [frameH, setFrameH] = useState(1);
  const [yoloActive, setYoloActive]     = useState(false);
  const [pidnetActive, setPidnetActive] = useState(false);
  const [busText, setBusText] = useState('');

  // ── OCR state ─────────────────────────────────────────────────────────────
  const [ocrText, setOcrText] = useState('');
  const [ocrStatus, setOcrStatus] = useState('');
  const ocrBusyRef = useRef(false);
  const prevOcrRef = useRef('');

  // ── Scene state ───────────────────────────────────────────────────────────
  const [sceneText, setSceneText] = useState('');
  const [sceneLoading, setSceneLoading] = useState(false);

  // ── Settings ──────────────────────────────────────────────────────────────
  const [appLang, setAppLang] = useState<SupportedLang>('ru');
  const [speechEnabled, setSpeechEnabled] = useState(true);
  const [speechRate, setSpeechRate] = useState(1.0);
  const [warningMode, setWarningMode] = useState<'voice' | 'vibration' | 'none'>('voice');

  const ttsLastRef    = useRef<Map<string, number>>(new Map());
  const busOcrCoolRef = useRef(0);
  const yoloBusyRef   = useRef(false);
  const pidnetBusyRef = useRef(false);

  // ── Model init ────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const lang = await AsyncStorage.getItem('language');
        setAppLang((lang === 'en' ? 'en' : lang === 'kk' ? 'kk' : 'ru') as SupportedLang);
        const se = await AsyncStorage.getItem('speechEnabled');
        setSpeechEnabled(se !== 'false');
        const sp = (await AsyncStorage.getItem('speechSpeed')) || 'medium';
        setSpeechRate(sp === 'fast' ? 1.15 : sp === 'slow' ? 0.85 : 1.0);
        const wm = ((await AsyncStorage.getItem('warningMode')) || 'voice') as any;
        setWarningMode(wm);
      } catch {}
      // Load both models in parallel; individual load times tracked in yolo_load / pidnet_load
      const [yOk, pOk] = await Promise.all([initYolo(), initPidnet()]);
      // Start periodic perf dump every 60 s (visible in Metro + adb logcat | grep PERF)
      Perf.startDump(60_000);
      setYoloActive(yOk);
      setPidnetActive(pOk);
    })();
  }, []);

  useEffect(() => {
    if (permission && !permission.granted) requestPermission();
  }, [permission]);

  useEffect(() => {
    resetTracker();
    setDetections([]);
    setSegResult(null);
    setBusText('');
    setOcrText('');
    setOcrStatus('');
    setSceneText('');
    prevOcrRef.current = '';
    ttsLastRef.current.clear();
  }, [mode]);

  // ── Speak ─────────────────────────────────────────────────────────────────
  const speak = useCallback((text: string) => {
    if (!speechEnabled) return;
    const code = appLang === 'ru' ? 'ru-RU' : appLang === 'kk' ? 'kk-KZ' : 'en-US';
    try { Speech.stop(); (Speech as any).speak(text, { language: code, rate: speechRate }); }
    catch {}
  }, [speechEnabled, appLang, speechRate]);

  // ── TTS helper (debounced by key) ─────────────────────────────────────────
  const trySpeak = useCallback((key: string, text: string, cooldown = TTS_COOLDOWN_MS) => {
    const now = Date.now();
    const last = ttsLastRef.current.get(key) ?? 0;
    if (now - last < cooldown) return false;
    ttsLastRef.current.set(key, now);
    if (warningMode === 'vibration') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
      return true;
    }
    if (warningMode === 'voice') speak(text);
    return true;
  }, [warningMode, speak]);

  // ── YOLO: announce tracked detections ─────────────────────────────────────
  const announceDetections = useCallback((dets: TrackedDetection[]) => {
    for (const d of dets) {
      const isHigh = HIGH_PRIORITY_CLASSES.has(d.classId) || isHighPriByName(d.labelEn);
      const isMed  = !isHigh && MEDIUM_PRIORITY_CLASSES.has(d.classId);
      const isClose = (d.y2 - d.y1) > CLOSE_THRESHOLD;
      if (!isHigh && !(isMed && isClose)) continue;

      const cooldown = d.isMoving ? TTS_MOVING_COOLDOWN : TTS_COOLDOWN_MS;
      const key = `yolo_${d.trackId ?? d.label}_${d.isMoving ? 1 : 0}`;
      const name = appLang === 'en' ? d.labelEn : d.label;
      const text = d.isMoving && isHigh
        ? (appLang === 'ru' ? `движущийся ${name}` : `moving ${name}`)
        : name;
      const phrase = appLang === 'ru' ? `Внимание: ${text}` : `Warning: ${text}`;
      trySpeak(key, phrase, cooldown);
    }
  }, [appLang, trySpeak]);

  function isHighPriByName(name: string): boolean {
    return ['person', 'car', 'bus', 'truck', 'motorcycle', 'bicycle']
      .some(k => name.toLowerCase().includes(k));
  }

  // ── PIDNet: announce surface hazards ──────────────────────────────────────
  const announceHazards = useCallback((hazards: string[]) => {
    for (const msg of hazards) {
      if (trySpeak(`pidnet_${msg}`, msg)) return;
    }
  }, [trySpeak]);

  // ── Bus number OCR ────────────────────────────────────────────────────────
  const detectBusNumber = useCallback(async (
    region: { x1: number; y1: number; x2: number; y2: number },
    photo: { uri: string; width: number; height: number },
  ) => {
    busOcrCoolRef.current = Date.now();
    try {
      const originX = Math.max(0, Math.floor(region.x1 * photo.width));
      const originY = Math.max(0, Math.floor(region.y1 * photo.height));
      const roiW = Math.min(Math.floor((region.x2 - region.x1) * photo.width), photo.width - originX);
      const roiH = Math.min(Math.floor((region.y2 - region.y1) * photo.height * 0.4), photo.height - originY);
      if (roiW < 10 || roiH < 10) return;

      const roi = await ImageManipulator.manipulateAsync(
        photo.uri,
        [{ crop: { originX, originY, width: roiW, height: roiH } }],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );
      const result = await recognizeText(roi.base64 ?? '');
      const match = result.text.replace(/\s/g, '').match(/\d{1,3}[A-ZА-ЯӘҒҚҢӨҰҮІШa-z]?/);
      if (match) {
        const msg = appLang === 'ru' ? `Автобус номер ${match[0]}` : `Bus number ${match[0]}`;
        setBusText(msg);
        speak(msg);
        setTimeout(() => setBusText(''), 8000);
      }
    } catch {}
  }, [appLang, speak]);

  // ── YOLO loop (500ms) ────────────────────────────────────────────────────
  const yoloLoop = useCallback(async () => {
    if (!camRef.current || yoloBusyRef.current || mode !== 'DETECT') return;
    yoloBusyRef.current = true;
    const tCycle = Perf.start();
    try {
      const tCapture = Perf.start();
      const photo = await camRef.current.takePictureAsync({
        base64: true, quality: PHOTO_QUALITY,
        skipProcessing: true, shutterSound: false,
      } as any);
      Perf.end('yolo_capture', tCapture);

      let rawDets: Detection[];
      if (isYoloReady()) {
        rawDets = await detectObjects(photo.uri);
      } else if (!isPidnetReady()) {
        // Vision API fallback only when neither model is loaded
        const tVision = Perf.start();
        rawDets = await visionDetect(photo.base64 ?? '');
        Perf.end('vision_api_rtt', tVision);
      } else {
        rawDets = [];
      }

      const tTrack = Perf.start();
      const tracked = updateTracks(rawDets);
      Perf.end('yolo_tracker', tTrack);

      setDetections(tracked);
      announceDetections(tracked);

      // Bus number from YOLO bbox (classId 5 = bus in COCO)
      const bus = tracked.find(d => d.classId === 5 && d.confidence > 0.6);
      if (bus && Date.now() - busOcrCoolRef.current > BUS_OCR_COOLDOWN_MS) {
        detectBusNumber(
          { x1: bus.x1, y1: bus.y1, x2: bus.x2, y2: bus.y2 },
          photo,
        );
      }
    } catch (e) { console.warn('[YOLO]', e); }
    finally {
      Perf.end('yolo_cycle', tCycle);
      yoloBusyRef.current = false;
    }
  }, [mode, announceDetections, detectBusNumber]);

  // ── PIDNet loop (1500ms) ─────────────────────────────────────────────────
  const pidnetLoop = useCallback(async () => {
    if (!camRef.current || pidnetBusyRef.current || mode !== 'DETECT') return;
    if (!isPidnetReady()) return;
    pidnetBusyRef.current = true;
    const tLoop = Perf.start();
    try {
      const tCapture = Perf.start();
      const photo = await camRef.current.takePictureAsync({
        base64: false, quality: PHOTO_QUALITY,
        skipProcessing: true, shutterSound: false,
      } as any);
      Perf.end('pidnet_capture', tCapture);

      const result = await runSegmentation(photo.uri, appLang);
      if (result) {
        setSegResult(result);
        announceHazards(result.hazards);

        // Bus from PIDNet mask only if YOLO didn't catch it
        if (result.busRegion && !isYoloReady() &&
            Date.now() - busOcrCoolRef.current > BUS_OCR_COOLDOWN_MS) {
          detectBusNumber(result.busRegion, { ...photo, width: 256, height: 128 });
        }
      }
    } catch (e) { console.warn('[PIDNet]', e); }
    finally {
      Perf.end('pidnet_loop', tLoop);
      pidnetBusyRef.current = false;
    }
  }, [mode, appLang, announceHazards, detectBusNumber]);

  useEffect(() => {
    if (!ready || mode !== 'DETECT') return;
    const y = setInterval(yoloLoop,   YOLO_INTERVAL_MS);
    const p = setInterval(pidnetLoop, PIDNET_INTERVAL_MS);
    return () => { clearInterval(y); clearInterval(p); };
  }, [ready, mode, yoloLoop, pidnetLoop]);

  // ── OCR Live loop ─────────────────────────────────────────────────────────
  const ocrLiveLoop = useCallback(async () => {
    if (!camRef.current || ocrBusyRef.current || mode !== 'OCR') return;
    ocrBusyRef.current = true;
    try {
      const photo = await camRef.current.takePictureAsync({
        base64: true, quality: 0.7, skipProcessing: true, shutterSound: false,
      } as any);
      const result = await recognizeText(photo.base64 ?? '');
      if (!result.text || result.text === prevOcrRef.current) return;
      prevOcrRef.current = result.text;
      let display = result.text;
      if (result.locale !== appLang && result.locale !== 'und') {
        try { setOcrStatus(appLang === 'ru' ? 'Перевожу…' : 'Translating…');
              display = await translateText(result.text, appLang); } catch {}
      }
      setOcrText(display); setOcrStatus(''); speak(display);
    } catch {} finally { ocrBusyRef.current = false; }
  }, [mode, appLang, speak]);

  const captureAndOcr = useCallback(async () => {
    if (!camRef.current || busy) return;
    setBusy(true);
    prevOcrRef.current = '';
    setOcrText('');
    setOcrStatus(appLang === 'ru' ? 'Читаю текст…' : 'Reading text…');
    try {
      const photo = await camRef.current.takePictureAsync({
        base64: true, quality: 0.85, skipProcessing: true, shutterSound: false,
      } as any);
      const result = await recognizeText(photo.base64 ?? '');
      if (!result.text) {
        const msg = appLang === 'ru' ? 'Текст не найден' : 'No text found';
        setOcrStatus(msg); speak(msg); return;
      }
      let display = result.text;
      if (result.locale !== appLang && result.locale !== 'und') {
        try { setOcrStatus(appLang === 'ru' ? 'Перевожу…' : 'Translating…');
              display = await translateText(result.text, appLang); } catch {}
      }
      prevOcrRef.current = display; setOcrText(display); setOcrStatus(''); speak(display);
    } catch (e: any) { setOcrStatus(e?.message ?? String(e)); }
    finally { setBusy(false); }
  }, [busy, appLang, speak]);

  useEffect(() => {
    if (!ready || mode !== 'OCR') return;
    const id = setInterval(ocrLiveLoop, OCR_INTERVAL_MS);
    return () => clearInterval(id);
  }, [ready, mode, ocrLiveLoop]);

  // ── Scene description ─────────────────────────────────────────────────────
  const handleDescribeScene = useCallback(async () => {
    if (!camRef.current || sceneLoading) return;
    setSceneLoading(true); setSceneText('');
    speak(appLang === 'ru' ? 'Описываю сцену…' : 'Describing scene…');
    try {
      const photo = await camRef.current.takePictureAsync({
        base64: false, quality: 0.6, skipProcessing: true, shutterSound: false,
      } as any);
      const desc = await describeScene(photo.uri, appLang);
      setSceneText(desc); speak(desc);
    } catch (e: any) {
      const msg = (e?.message?.length < 120) ? e.message
        : (appLang === 'ru' ? 'Ошибка описания' : 'Scene error');
      setSceneText(msg);
      speak(appLang === 'ru' ? 'Ошибка описания сцены' : 'Scene description failed');
    } finally { setSceneLoading(false); }
  }, [sceneLoading, appLang, speak]);

  // ── Badge label ───────────────────────────────────────────────────────────
  function badgeLabel(): string {
    if (yoloActive && pidnetActive) return 'YOLO + PIDNet';
    if (yoloActive)   return 'YOLOv8n';
    if (pidnetActive) return 'PIDNet-S';
    return 'Vision API';
  }

  // ── Permission ────────────────────────────────────────────────────────────
  if (!permission) return null;
  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.permText}>
          {appLang === 'ru' ? 'Нужен доступ к камере' : 'Camera access required'}
        </Text>
        <TouchableOpacity style={styles.btn} onPress={requestPermission}>
          <Text style={styles.btnText}>{appLang === 'ru' ? 'Разрешить' : 'Allow'}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <View
      style={styles.root}
      onLayout={e => { setFrameW(e.nativeEvent.layout.width); setFrameH(e.nativeEvent.layout.height); }}
    >
      <CameraView
        ref={camRef}
        style={StyleSheet.absoluteFill}
        facing="back"
        animateShutter={false}
        onCameraReady={() => setCameraReady(true)}
      />

      {/* Mode toggle */}
      <View style={styles.modeBar}>
        {(['DETECT', 'OCR'] as Mode[]).map(m => (
          <TouchableOpacity
            key={m}
            style={[styles.modeBtn, mode === m && styles.modeBtnActive]}
            onPress={() => setMode(m)}
          >
            <Ionicons
              name={m === 'DETECT' ? 'eye-outline' : 'text-outline'}
              size={18}
              color={mode === m ? '#fff' : '#aaa'}
            />
            <Text style={[styles.modeTxt, mode === m && styles.modeTxtActive]}>
              {m === 'DETECT'
                ? (appLang === 'ru' ? 'Детект' : 'Detect')
                : (appLang === 'ru' ? 'Текст' : 'OCR')}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Model badge */}
      {mode === 'DETECT' && (
        <View style={[styles.badge,
          (yoloActive || pidnetActive) ? styles.badgeGreen : styles.badgeYellow]}>
          <Text style={styles.badgeTxt}>{badgeLabel()}</Text>
        </View>
      )}

      {/* Layer 1: PIDNet segmentation grid (terrain, lower opacity) */}
      {mode === 'DETECT' && segResult && (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {segResult.grid.flatMap((row, ri) =>
            row.map((zone, ci) => {
              const [r, g, b] = zone.color;
              const opacity = ri === 2 ? 0.45 : 0.18;
              return (
                <View
                  key={`seg-${ri}-${ci}`}
                  style={[styles.gridCell, {
                    left:   (ci / 3) * frameW,
                    top:    (ri / 3) * frameH,
                    width:  frameW / 3,
                    height: frameH / 3,
                    backgroundColor: `rgba(${r},${g},${b},${opacity})`,
                  }]}
                />
              );
            })
          )}
        </View>
      )}

      {/* Layer 2: YOLO bounding boxes (dynamic objects, on top of grid) */}
      {mode === 'DETECT' && (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {detections.map((d, i) => {
            const isHigh = HIGH_PRIORITY_CLASSES.has(d.classId) || isHighPriByName(d.labelEn);
            return (
              <View
                key={`det-${d.trackId ?? i}`}
                style={[
                  styles.box,
                  {
                    left:   d.x1 * frameW,
                    top:    d.y1 * frameH,
                    width:  (d.x2 - d.x1) * frameW,
                    height: (d.y2 - d.y1) * frameH,
                  },
                  isHigh ? styles.boxHigh : undefined,
                  d.isMoving ? styles.boxMoving : undefined,
                ]}
              >
                <Text style={styles.boxLabel}>
                  {appLang === 'en' ? d.labelEn : d.label}{' '}
                  {(d.confidence * 100).toFixed(0)}%
                  {d.isMoving ? ' ▶' : ''}
                </Text>
              </View>
            );
          })}
        </View>
      )}

      {/* PIDNet surface label strip */}
      {mode === 'DETECT' && segResult && (
        <View style={styles.surfaceBar} pointerEvents="none">
          <Text style={styles.surfaceTxt}>
            {appLang === 'en' ? segResult.grid[2][1].labelEn : segResult.grid[2][1].label}
          </Text>
          {segResult.hazards.length > 0 && (
            <Text style={styles.hazardTxt}>⚠ {segResult.hazards[0]}</Text>
          )}
        </View>
      )}

      {/* Bus number toast */}
      {busText ? (
        <View style={styles.busToast}>
          <Text style={styles.busToastTxt}>{busText}</Text>
        </View>
      ) : null}

      {/* Scene overlay */}
      {(sceneText || sceneLoading) && mode === 'DETECT' ? (
        <View style={styles.sceneOverlay}>
          {sceneLoading
            ? <ActivityIndicator color="#8666E9" />
            : <Text style={styles.sceneText}>{sceneText}</Text>}
        </View>
      ) : null}

      {/* OCR overlay */}
      {mode === 'OCR' && (ocrText || ocrStatus) ? (
        <View style={styles.ocrOverlay}>
          {ocrStatus
            ? <Text style={styles.ocrStatus}>{ocrStatus}</Text>
            : <Text style={styles.ocrText}>{ocrText}</Text>}
        </View>
      ) : null}

      {/* Bottom bar */}
      <View style={styles.bottomBar}>
        {mode === 'DETECT' ? (
          <>
            <TouchableOpacity
              style={styles.sceneBtn}
              onPress={handleDescribeScene}
              disabled={sceneLoading}
            >
              <Ionicons
                name={sceneLoading ? 'hourglass-outline' : 'eye-outline'}
                size={24} color="#fff"
              />
            </TouchableOpacity>
            <View style={styles.shutterOuter}>
              <View style={styles.shutterInner} />
            </View>
            <View style={styles.sceneBtn} />
          </>
        ) : (
          <TouchableOpacity
            style={styles.shutterOuter}
            onPress={captureAndOcr}
            disabled={busy}
          >
            <View style={[styles.shutterInner, busy && { opacity: 0.4 }]} />
            {busy && <ActivityIndicator style={StyleSheet.absoluteFill} color="#8666E9" />}
          </TouchableOpacity>
        )}
      </View>

      <Text style={styles.hint}>
        {mode === 'DETECT'
          ? (appLang === 'ru' ? '👁 — описать сцену' : '👁 — describe scene')
          : (appLang === 'ru' ? 'Текст читается авто · кнопка — сразу' : 'Text reads auto · button forces now')}
      </Text>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0E0F24' },
  permText: { color: '#fff', fontSize: 16, marginBottom: 16 },
  btn: { backgroundColor: '#8666E9', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },

  modeBar: {
    position: 'absolute', top: 52, alignSelf: 'center',
    flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 24, padding: 4,
  },
  modeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
  },
  modeBtnActive: { backgroundColor: '#8666E9' },
  modeTxt: { color: '#aaa', fontSize: 14, fontWeight: '600' },
  modeTxtActive: { color: '#fff' },

  badge: {
    position: 'absolute', top: 52, right: 16,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10,
  },
  badgeGreen:  { backgroundColor: 'rgba(30,180,70,0.85)' },
  badgeYellow: { backgroundColor: 'rgba(200,140,0,0.85)' },
  badgeTxt: { color: '#fff', fontSize: 11, fontWeight: '700' },

  gridCell: { position: 'absolute' },

  box: { position: 'absolute', borderWidth: 2, borderColor: 'lime', borderRadius: 4 },
  boxHigh:   { borderColor: '#ff4444' },
  boxMoving: { borderColor: '#ff8800' },
  boxLabel: {
    position: 'absolute', top: -20, left: 0,
    paddingHorizontal: 6, paddingVertical: 2,
    fontSize: 11, fontWeight: '700', color: '#fff',
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderTopLeftRadius: 4, borderBottomRightRadius: 4,
  },

  surfaceBar: {
    position: 'absolute', bottom: 148, alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: 18, paddingVertical: 8,
    borderRadius: 20, alignItems: 'center', gap: 2,
  },
  surfaceTxt: { color: '#fff', fontSize: 15, fontWeight: '700' },
  hazardTxt:  { color: '#FFD060', fontSize: 13, fontWeight: '600' },

  busToast: {
    position: 'absolute', top: 110, alignSelf: 'center',
    backgroundColor: 'rgba(134,102,233,0.9)',
    paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20,
  },
  busToastTxt: { color: '#fff', fontSize: 16, fontWeight: '700' },

  sceneOverlay: {
    position: 'absolute', bottom: 140, left: 16, right: 16,
    backgroundColor: 'rgba(14,15,36,0.88)',
    borderRadius: 16, padding: 16,
  },
  sceneText: { color: '#fff', fontSize: 15, lineHeight: 22 },

  ocrOverlay: {
    position: 'absolute', bottom: 140, left: 16, right: 16,
    backgroundColor: 'rgba(0,0,0,0.78)',
    borderRadius: 16, padding: 16, maxHeight: 260,
  },
  ocrStatus: { color: '#aaa', fontSize: 14, textAlign: 'center' },
  ocrText:   { color: '#fff', fontSize: 16, lineHeight: 24 },

  bottomBar: {
    position: 'absolute', left: 0, right: 0, bottom: 32,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 32,
  },
  sceneBtn: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: 'rgba(134,102,233,0.85)',
    alignItems: 'center', justifyContent: 'center',
  },
  shutterOuter: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
  },
  shutterInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#eee' },

  hint: {
    position: 'absolute', bottom: 116, alignSelf: 'center',
    color: 'rgba(255,255,255,0.65)', fontSize: 12,
  },
});

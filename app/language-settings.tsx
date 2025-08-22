// Настройки языка: выбор языка и голосовая навигация
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, Modal, FlatList, Dimensions, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';
import { transcribeWithOpenAI } from '../lib/transcribe';

const micImg = require('../assets/images/mic_icon.png');
const langImg = require('../assets/images/your_language_icon.png');

export const options = { headerShown: false, tabBarStyle: { display: 'none' } };

const MIN_DURATION_MS = 700;
const MIN_SIZE_BYTES = 7000;
const HOLD_TO_RECORD_MS = 250;

const ACTIVATION_PHRASES = {
  ru: ['аудио навигация', 'активация навигации', 'голосовая навигация'],
  en: ['audio navigation', 'voice navigation', 'activate navigation'],
} as const;

function hasActivationPhrase(text: string) {
  const t = text.toLowerCase();
  return [...ACTIVATION_PHRASES.ru, ...ACTIVATION_PHRASES.en].some((p) => t.includes(p));
}

const LANGUAGES = [
  { key: 'ru', labelRu: 'Русский', labelEn: 'Russian', ttsLang: 'ru-RU', phrase: 'Вы выбрали русский' },
  { key: 'en', labelRu: 'Английский', labelEn: 'English', ttsLang: 'en-US', phrase: 'You selected English' },
  { key: 'kk', labelRu: 'Казахский', labelEn: 'Kazakh', ttsLang: 'kk-KZ', phrase: 'Сіз қазақ тілін таңдадыңыз' },
] as const;

type TKey = typeof LANGUAGES[number]['key'];

export default function LanguageSettings() {
  const router = useRouter();

  const [uiLang, setUiLang] = useState<'ru' | 'en'>('ru');
  const [speechEnabled, setSpeechEnabled] = useState(true);
  const [speechRate, setSpeechRate] = useState(1.0);
  const [current, setCurrent] = useState<TKey>('ru');

  const [listening, setListening] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [voiceNavActive, setVoiceNavActive] = useState(false);

  const startedAtRef = useRef<number | null>(null);
  const recRef = useRef<Audio.Recording | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      const lng = await AsyncStorage.getItem('language');
      const ui = lng === 'en' ? 'en' : 'ru';
      setUiLang(ui);
      setCurrent((lng as TKey) || 'ru');
      const se = await AsyncStorage.getItem('speechEnabled');
      setSpeechEnabled(se !== 'false');
      const sp = (await AsyncStorage.getItem('speechSpeed')) || 'medium';
      setSpeechRate(sp === 'fast' ? 1.15 : sp === 'slow' ? 0.85 : 1.0);

      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(ui === 'ru' ? 'Микрофон' : 'Microphone', ui === 'ru' ? 'Разреши доступ к микрофону.' : 'Please allow microphone access.');
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
    })();
  }, []);

  // Текст статуса внизу экрана
  const navStatusText = () => {
    const dict = {
      ru: { idle: 'Аудио‑навигация: ожидание', active: 'Аудио‑навигация включена — скажите команду', listening: 'Аудио‑навигация: слушаю…', sending: 'Аудио‑навигация: отправляю…' },
      en: { idle: 'Audio navigation: idle', active: 'Audio navigation enabled — say a command', listening: 'Audio navigation: listening…', sending: 'Audio navigation: sending…' },
    } as const;
    if (uploading) return (dict as any)[uiLang].sending;
    if (listening) return (dict as any)[uiLang].listening;
    if (voiceNavActive) return (dict as any)[uiLang].active;
    return (dict as any)[uiLang].idle;
  };

  async function selectLanguage(lng: TKey) {
    await AsyncStorage.setItem('language', lng);
    setCurrent(lng);
    // Произносим фразу на выбранном языке (без смешения языков)
    const meta = LANGUAGES.find((l) => l.key === lng)!;
    if (speechEnabled) {
      try { Speech.stop(); } catch {}
      await new Promise<void>((resolve) => {
        (Speech as any).speak(meta.phrase, {
          language: meta.ttsLang,
          rate: speechRate,
          onDone: resolve,
          onStopped: resolve,
          onError: () => resolve(),
        });
      });
    } else {
      try { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch {}
    }
    setTimeout(() => router.replace('/settings'), 350);
  }

  function detectLanguageFromText(textRaw: string): TKey | null {
    const t = textRaw.toLowerCase();
    if (/(русск|russ|russian|российский язык|на русский|русский)/.test(t)) return 'ru';
    if (/(англ|english|инглиш|на английский|английский)/.test(t)) return 'en';
    if (/(казах|қазақ|kazakh|qazaq|на казахский|қазақша)/.test(t)) return 'kk';
    return null;
  }

  const startRecording = async () => {
    if (recRef.current || holdTimerRef.current) return;
    holdTimerRef.current = setTimeout(async () => {
      holdTimerRef.current = null;
      try {
        const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
        recRef.current = recording;
        startedAtRef.current = Date.now();
        setListening(true);
      } catch { setListening(false); }
    }, HOLD_TO_RECORD_MS);
  };

  const stopAndHandle = async () => {
    if (!recRef.current && holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; return; }
    const rec = recRef.current; if (!rec) return;
    try { await rec.stopAndUnloadAsync(); } catch {}
    await new Promise((r) => setTimeout(r, 80));
    setListening(false);

    const uri = rec.getURI(); recRef.current = null; if (!uri) return;
    const dur = startedAtRef.current ? Date.now() - startedAtRef.current : 0; startedAtRef.current = null;
    const info = await FileSystem.getInfoAsync(uri);
    if (dur < MIN_DURATION_MS || (((info as any)?.size) ?? 0) < MIN_SIZE_BYTES) return;

    setUploading(true);
    try {
      const textRaw = await transcribeWithOpenAI(uri);
      const t = (textRaw || '').toLowerCase().trim();

      if (!voiceNavActive && hasActivationPhrase(t)) { setVoiceNavActive(true); try { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch {} return; }

      // Голосовые команды выбора языка
      const lang = detectLanguageFromText(t);
      if (lang) { await selectLanguage(lang); return; }

      // Команды навигации
      if (t.includes('назад') || t.includes('back')) { router.back(); return; }
      if (t.includes('settings') || t.includes('настройки')) { router.replace('/settings'); return; }
    } catch { /* тихо */ }
    finally { setUploading(false); }
  };

  const micText = () => {
    if (uploading) return uiLang === 'ru' ? 'Отправляю…' : 'Sending…';
    if (listening) return uiLang === 'ru' ? 'Слушаю…' : 'Listening…';
    return '';
  };

  const { width } = Dimensions.get('window');

  return (
    <View style={styles.wrapper}>
      {/* Микрофон */}
      <View style={styles.micArea}>
        <TouchableOpacity
          style={[styles.micButton, listening && styles.micButtonBig]}
          onPressIn={startRecording}
          onPressOut={stopAndHandle}
          activeOpacity={0.85}
        >
          <Image source={micImg} style={[styles.micIcon, listening && styles.micIconListening]} />
        </TouchableOpacity>
        {(uploading || listening) ? (<Text style={styles.micText}>{micText()}</Text>) : null}
      </View>

      <View style={styles.imageContainer}>
        <Image source={langImg} style={{ width: width * 0.55, height: width * 0.55 }} resizeMode="contain" />
      </View>

      <TouchableOpacity style={styles.langBtn} onPress={() => selectLanguage(current)}>
        <Text style={styles.langBtnText}>
          {uiLang === 'ru' ? `Текущий: ${LANGUAGES.find(l => l.key === current)?.labelRu}` : `Current: ${LANGUAGES.find(l => l.key === current)?.labelEn}`}
        </Text>
      </TouchableOpacity>

      {/* Нижняя статусная строка (резерв под текст) */}
      
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1, backgroundColor: '#0E0F24', alignItems: 'center', justifyContent: 'flex-start', paddingTop: 48 },
  micButton: { borderRadius: 12, padding: 6, backgroundColor: 'transparent' },
  micButtonBig: { transform: [{ scale: 1.18 }] },
  micIcon: { width: 70, height: 70, resizeMode: 'contain' },
  micIconListening: { width: 86, height: 86 },
  micArea: { position: 'absolute', top: 28, right: 22, alignItems: 'center' },
  micText: { color: '#fff', marginTop: 4, fontSize: 14, textAlign: 'center' },

  imageContainer: { width: '100%', alignItems: 'center', marginTop: 110, marginBottom: 26 },

  langBtn: { backgroundColor: '#fff', borderRadius: 18, paddingVertical: 18, paddingHorizontal: 36, alignItems: 'center', justifyContent: 'center', minWidth: 210 },
  langBtnText: { color: '#a2a9b0', fontSize: 26, fontWeight: '400' },

  bottomBar: { position: 'absolute', bottom: 14, left: 16, right: 16, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)' },
  bottomText: { color: '#DADBE6', fontSize: 14, textAlign: 'center' },
});

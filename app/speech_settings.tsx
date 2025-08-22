// Настройки озвучки: включение TTS, скорость и предупреждения
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import { transcribeWithOpenAI } from '../lib/transcribe';

export const options = { headerShown: false, tabBarStyle: { display: 'none' } };

const voiceIcon = require('../assets/images/voice_question.png');
const speedIcon = require('../assets/images/speed_icon.png');
const warnIcon = require('../assets/images/warn_icon.png');
const micImg = require('../assets/images/mic_icon.png');

const MIN_DURATION_MS = 700;
const MIN_SIZE_BYTES = 7000;
const HOLD_TO_RECORD_MS = 250;

export default function SpeechSettingsScreen() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [uiLang, setUiLang] = useState<'ru' | 'en'>('ru');
  const [speechRate, setSpeechRate] = useState(1.0);
  const [speechEnabled, setSpeechEnabled] = useState(false);
  const router = useRouter();

  const [listening, setListening] = useState(false);
  const [uploading, setUploading] = useState(false);

  const startedAtRef = useRef<number | null>(null);
  const recRef = useRef<Audio.Recording | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSpokenStepRef = useRef<1 | 2 | 3 | null>(null);

  useEffect(() => {
    (async () => {
      const lng = await AsyncStorage.getItem('language'); setUiLang(lng === 'en' ? 'en' : 'ru');
      const sp = (await AsyncStorage.getItem('speechSpeed')) || 'medium'; setSpeechRate(sp === 'fast' ? 1.15 : sp === 'slow' ? 0.85 : 1.0);
      const se = await AsyncStorage.getItem('speechEnabled'); setSpeechEnabled(se !== 'false');

      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) { /* без алертов */ }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
    })();
  }, []);

  // ===== Помощники для синтеза речи =====
  async function speakText(text: string) {
    try { Speech.stop(); } catch {}
    try { await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true }); } catch {}
    await new Promise<void>((resolve) => {
      (Speech as any).speak(text, { language: uiLang === 'ru' ? 'ru-RU' : 'en-US', rate: speechRate, onDone: resolve, onStopped: resolve, onError: () => resolve() });
    });
    await new Promise((r) => setTimeout(r, 60));
    try { await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true }); } catch {}
  }

  async function speakConfirm(ruText: string, enText: string) {
    const phrase = uiLang === 'ru' ? ruText : enText; await speakText(phrase);
  }

  function questionText(s: 1 | 2 | 3) {
    if (uiLang === 'ru') {
      return s === 1
        ? 'Хотите включить озвучивание интерфейса?'
        : s === 2
        ? 'Выберите скорость для озвучивания текстов'
        : 'Какой способ предупреждения о препятствиях вам удобнее?';
    }
    return s === 1
      ? 'Enable interface speech?'
      : s === 2
      ? 'Choose speech rate'
      : 'How to warn about obstacles?';
  }

  // Озвучиваем вопрос при входе/смене шага, если озвучка включена
  useEffect(() => {
    if (!speechEnabled) return;
    if (lastSpokenStepRef.current === step) return;
    lastSpokenStepRef.current = step;
    speakText(questionText(step));
  }, [step, speechEnabled, uiLang, speechRate]);

  // ===== Обработчики (с голосовым подтверждением) =====
  async function handleSpeechEnable(enable: boolean) {
    await AsyncStorage.setItem('speechEnabled', enable ? 'true' : 'false');
    setSpeechEnabled(enable);
    if (enable) {
      await speakConfirm('Озвучка включена', 'Speech enabled');
      setStep(2);
    } else {
      await speakConfirm('Озвучка выключена', 'Speech disabled');
      await AsyncStorage.multiRemove(['speechSpeed', 'obstacleWarning']);
      router.back();
    }
  }

  async function handleSpeed(speed: 'fast' | 'medium' | 'slow') {
    await AsyncStorage.setItem('speechSpeed', speed);
    const ru = { fast: 'быстрая', medium: 'средняя', slow: 'медленная' } as const;
    const en = { fast: 'fast', medium: 'medium', slow: 'slow' } as const;
    await speakConfirm(`Скорость: ${ru[speed]}`, `Speed: ${en[speed]}`);
    setStep(3);
  }

  async function handleWarning(type: 'voice' | 'vibration' | 'none') {
    await AsyncStorage.setItem('obstacleWarning', type);
    const ru = { voice: 'голос', vibration: 'вибрация', none: 'ничего' } as const;
    const en = { voice: 'voice', vibration: 'vibration', none: 'none' } as const;
    await speakConfirm(`Предупреждение: ${ru[type]}`, `Warning: ${en[type]}`);
    router.back();
  }

  // ===== Помощники микрофона =====
  const micText = () => {
    if (uploading) return uiLang === 'ru' ? 'Отправляю…' : 'Sending…';
    if (listening) return uiLang === 'ru' ? 'Слушаю…' : 'Listening…';
    return '';
  };

  const startRecording = async () => {
    if (recRef.current || holdTimerRef.current) return;
    holdTimerRef.current = setTimeout(async () => {
      holdTimerRef.current = null;
      try { const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY); recRef.current = recording; startedAtRef.current = Date.now(); setListening(true); } catch { setListening(false); }
    }, HOLD_TO_RECORD_MS);
  };

  const stopAndHandle = async () => {
    if (!recRef.current && holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; return; }
    const rec = recRef.current; if (!rec) return;
    try { await rec.stopAndUnloadAsync(); } catch {}
    await new Promise(r => setTimeout(r, 80));
    setListening(false);

    const uri = rec.getURI(); recRef.current = null; if (!uri) return;
    const dur = startedAtRef.current ? Date.now() - startedAtRef.current : 0; startedAtRef.current = null;
    const info = await FileSystem.getInfoAsync(uri);
    if (dur < MIN_DURATION_MS || (((info as any)?.size) ?? 0) < MIN_SIZE_BYTES) return;

    setUploading(true);
    try {
      const textRaw = await transcribeWithOpenAI(uri);
      const t = (textRaw || '').toLowerCase().trim();

      // Глобальная навигация
      if (t.includes('назад') || t.includes('back')) { if (step > 1) setStep((s) => (s === 3 ? 2 : 1)); else router.back(); return; }
      if (t.includes('settings') || t.includes('настройки')) { router.replace('/settings'); return; }

      if (step === 1) {
        const yes = ['да', 'включи', 'включить', 'давай', 'yes', 'enable', 'turn on'];
        const no = ['нет', 'выключи', 'не нужно', 'no', 'disable', 'turn off'];
        if (yes.some((w) => t.includes(w))) return handleSpeechEnable(true);
        if (no.some((w) => t.includes(w))) return handleSpeechEnable(false);
      }

      if (step === 2) {
        if (['быстрая', 'быстро', 'fast'].some((w) => t.includes(w))) return handleSpeed('fast');
        if (['средняя', 'средне', 'medium'].some((w) => t.includes(w))) return handleSpeed('medium');
        if (['медленная', 'медленно', 'slow'].some((w) => t.includes(w))) return handleSpeed('slow');
        if (['далее', 'продолжить', 'next'].some((w) => t.includes(w))) return setStep(3);
      }

      if (step === 3) {
        if (['голос', 'озвучка', 'voice'].some((w) => t.includes(w))) return handleWarning('voice');
        if (['вибрация', 'vibration', 'vibrate'].some((w) => t.includes(w))) return handleWarning('vibration');
        if (['ничего', 'none', 'no warning'].some((w) => t.includes(w))) return handleWarning('none');
      }
    } catch {
      // тихо
    } finally { setUploading(false); }
  };

  // ===== Интерфейс =====
  if (step === 1) {
    return (
      <View style={styles.wrapper}>
        <View style={styles.micArea}>
          <TouchableOpacity style={[styles.micButton, listening && styles.micButtonBig]} onPressIn={startRecording} onPressOut={stopAndHandle} activeOpacity={0.85}>
            <Image source={micImg} style={[styles.micIcon, listening && styles.micIconListening]} />
          </TouchableOpacity>
          {(uploading || listening) ? (<Text style={styles.micText}>{micText()}</Text>) : null}
        </View>

        <Image source={voiceIcon} style={styles.icon} />
        <Text style={styles.title}>{uiLang === 'ru' ? 'Хотите включить\nозвучивание интерфейса?' : 'Enable interface speech?'}</Text>
        <View style={styles.row}>
          <TouchableOpacity style={styles.btn} onPress={() => handleSpeechEnable(true)}><Text style={styles.btnText}>{uiLang === 'ru' ? 'Да' : 'Yes'}</Text></TouchableOpacity>
          <TouchableOpacity style={styles.btn} onPress={() => handleSpeechEnable(false)}><Text style={styles.btnText}>{uiLang === 'ru' ? 'Нет' : 'No'}</Text></TouchableOpacity>
        </View>
      </View>
    );
  }

  if (step === 2) {
    return (
      <View style={styles.wrapper}>
        <View style={styles.micArea}>
          <TouchableOpacity style={[styles.micButton, listening && styles.micButtonBig]} onPressIn={startRecording} onPressOut={stopAndHandle} activeOpacity={0.85}>
            <Image source={micImg} style={[styles.micIcon, listening && styles.micIconListening]} />
          </TouchableOpacity>
          {(uploading || listening) ? (<Text style={styles.micText}>{micText()}</Text>) : null}
        </View>

        <Image source={speedIcon} style={styles.icon} />
        <Text style={styles.title}>{uiLang === 'ru' ? 'Выберите скорость\nдля озвучивания текстов' : 'Choose speech rate'}</Text>
        <TouchableOpacity style={styles.bigBtn} onPress={() => handleSpeed('fast')}><Text style={styles.bigBtnText}>{uiLang === 'ru' ? 'а) быстрая' : 'a) fast'}</Text></TouchableOpacity>
        <TouchableOpacity style={styles.bigBtn} onPress={() => handleSpeed('medium')}><Text style={styles.bigBtnText}>{uiLang === 'ru' ? 'б) средняя' : 'b) medium'}</Text></TouchableOpacity>
        <TouchableOpacity style={styles.bigBtn} onPress={() => handleSpeed('slow')}><Text style={styles.bigBtnText}>{uiLang === 'ru' ? 'в) медленная' : 'c) slow'}</Text></TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.wrapper}>
      <View style={styles.micArea}>
        <TouchableOpacity style={[styles.micButton, listening && styles.micButtonBig]} onPressIn={startRecording} onPressOut={stopAndHandle} activeOpacity={0.85}>
          <Image source={micImg} style={[styles.micIcon, listening && styles.micIconListening]} />
        </TouchableOpacity>
        {(uploading || listening) ? (<Text style={styles.micText}>{micText()}</Text>) : null}
      </View>

      <Image source={warnIcon} style={styles.icon} />
      <Text style={styles.title}>{uiLang === 'ru' ? 'Какой способ предупреждения\н о препятствиях вам удобнее?' : 'How to warn about obstacles?'}</Text>
      <TouchableOpacity style={styles.bigBtn} onPress={() => handleWarning('voice')}><Text style={styles.bigBtnText}>{uiLang === 'ru' ? 'а) голос' : 'a) voice'}</Text></TouchableOpacity>
      <TouchableOpacity style={styles.bigBtn} onPress={() => handleWarning('vibration')}><Text style={styles.bigBtnText}>{uiLang === 'ru' ? 'б) вибрация' : 'b) vibration'}</Text></TouchableOpacity>
      <TouchableOpacity style={styles.bigBtn} onPress={() => handleWarning('none')}><Text style={styles.bigBtnText}>{uiLang === 'ru' ? 'в) ничего' : 'c) none'}</Text></TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1, backgroundColor: '#0E0F24', justifyContent: 'center', alignItems: 'center' },
  micArea: { position: 'absolute', top: 28, right: 22, alignItems: 'center' },
  micButton: { borderRadius: 12, padding: 6, backgroundColor: 'transparent' },
  micButtonBig: { transform: [{ scale: 1.18 }] },
  micIcon: { width: 70, height: 70, resizeMode: 'contain' },
  micIconListening: { width: 86, height: 86 },
  micText: { color: '#fff', marginTop: 4, fontSize: 14, textAlign: 'center' },

  icon: { width: 120, height: 120, marginBottom: 24, resizeMode: 'contain' },
  title: { color: '#fff', fontSize: 24, fontWeight: 'bold', marginBottom: 30, textAlign: 'center', lineHeight: 30 },
  row: { flexDirection: 'row', width: '90%', justifyContent: 'space-between', marginTop: 18, gap: 20 },
  btn: { flex: 1, backgroundColor: '#393B53', borderRadius: 14, alignItems: 'center', paddingVertical: 20, marginHorizontal: 8 },
  btnText: { color: '#fff', fontSize: 22, fontWeight: 'bold' },
  bigBtn: { width: '100%', backgroundColor: '#393B53', borderRadius: 14, alignItems: 'flex-start', paddingVertical: 24, paddingLeft: 34, marginVertical: 10 },
  bigBtnText: { color: '#fff', fontSize: 26, fontWeight: 'bold', textAlign: 'left' },
});
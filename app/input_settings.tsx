// Экран настроек ввода: выбор голосом или клавиатурой
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import { transcribeWithOpenAI } from '../lib/transcribe';

export const options = { headerShown: false, tabBarStyle: { display: 'none' } };

const keyboardImg = require('../assets/images/text_input_icon.png');
const micImg = require('../assets/images/mic_icon.png');

const MIN_DURATION_MS = 700;
const MIN_SIZE_BYTES = 7000;
const HOLD_TO_RECORD_MS = 250;

export default function InputSettingsScreen() {
  const router = useRouter();

  const [uiLang, setUiLang] = useState<'ru' | 'en'>('ru');
  const [speechEnabled, setSpeechEnabled] = useState(true);
  const [speechRate, setSpeechRate] = useState(1.0);

  const [listening, setListening] = useState(false);
  const [uploading, setUploading] = useState(false);

  const startedAtRef = useRef<number | null>(null);
  const recRef = useRef<Audio.Recording | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const questionSpokenRef = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const lng = await AsyncStorage.getItem('language');
        setUiLang(lng === 'en' ? 'en' : 'ru');

        const se = await AsyncStorage.getItem('speechEnabled');
        setSpeechEnabled(se !== 'false');
        const sp = (await AsyncStorage.getItem('speechSpeed')) || 'medium';
        setSpeechRate(sp === 'fast' ? 1.15 : sp === 'slow' ? 0.85 : 1.0);
      } catch {}

      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          uiLang === 'ru' ? 'Микрофон' : 'Microphone',
          uiLang === 'ru' ? 'Разреши доступ к микрофону.' : 'Please allow microphone access.'
        );
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });

      if (speechEnabled && !questionSpokenRef.current) {
        questionSpokenRef.current = true;
        await speakQuestion();
      }
    })();
  }, []);

  // ---------- Помощники для озвучки ----------
  async function speakText(text: string, lang: 'ru-RU' | 'en-US') {
    try { Speech.stop(); } catch {}
    try { await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true }); } catch {}
    await new Promise<void>((resolve) => {
      (Speech as any).speak(text, {
        language: lang,
        rate: speechRate,
        onDone: resolve,
        onStopped: resolve,
        onError: () => resolve(),
      });
    });
    await new Promise((r) => setTimeout(r, 60));
    try { await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true }); } catch {}
  }

  async function speakConfirm(ruText: string, enText: string) {
    const phrase = uiLang === 'ru' ? ruText : enText;
    await speakText(phrase, uiLang === 'ru' ? 'ru-RU' : 'en-US');
  }

  async function speakQuestion() {
    await speakConfirm(
      'Как вам удобнее вводить текст? Скажите: голосом или клавиатурой',
      'How do you prefer to enter text? Say: by voice or by keyboard'
    );
  }

  // ---------- Обработчики действий ----------
  async function handleInput(type: 'voice' | 'keyboard') {
    await AsyncStorage.setItem('inputType', type);
    if (speechEnabled) {
      if (type === 'voice') await speakConfirm('Вы выбрали: голосом', 'You selected: voice');
      else await speakConfirm('Вы выбрали: клавиатурой', 'You selected: keyboard');
    }
    router.replace('/settings');
  }

  // ---------- Помощники для микрофона ----------
  const micText = () => {
    if (uploading) return uiLang === 'ru' ? 'Отправляю…' : 'Sending…';
    if (listening) return uiLang === 'ru' ? 'Слушаю…' : 'Listening…';
    return '';
  };

  const startRecording = async () => {
    if (recRef.current || holdTimerRef.current) return;
    holdTimerRef.current = setTimeout(async () => {
      holdTimerRef.current = null;
      try {
        const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
        recRef.current = recording;
        startedAtRef.current = Date.now();
        setListening(true);
      } catch {
        setListening(false);
      }
    }, HOLD_TO_RECORD_MS);
  };

  const stopAndHandle = async () => {
    if (!recRef.current && holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
      return;
    }
    const rec = recRef.current;
    if (!rec) return;
    try { await rec.stopAndUnloadAsync(); } catch {}
    await new Promise((r) => setTimeout(r, 80));
    setListening(false);

    const uri = rec.getURI();
    recRef.current = null;
    if (!uri) return;

    const dur = startedAtRef.current ? Date.now() - startedAtRef.current : 0;
    startedAtRef.current = null;
    const info = await FileSystem.getInfoAsync(uri);
    if (dur < MIN_DURATION_MS || (((info as any)?.size) ?? 0) < MIN_SIZE_BYTES) return;

    setUploading(true);
    try {
      const textRaw = await transcribeWithOpenAI(uri);
      const t = (textRaw || '').toLowerCase().trim();

      const sayVoice = ['голос', 'голосом', 'voice', 'audio', 'speech'];
      const sayKeyboard = ['клавиатура', 'клавиатурой', 'печатать', 'набирать', 'keyboard', 'typing', 'type'];
      const containsAny = (arr: string[]) => arr.some((w) => t.includes(w));

      if (containsAny(sayVoice)) { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); await handleInput('voice'); return; }
      if (containsAny(sayKeyboard)) { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); await handleInput('keyboard'); return; }

      if (t.includes('назад') || t.includes('back') || t.includes('settings') || t.includes('настройки')) { router.replace('/settings'); return; }
    } catch {
      // тихо
    } finally {
      setUploading(false);
    }
  };

  // ---------- Интерфейс ----------
  return (
    <View style={styles.wrapper}>
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

      <Image source={keyboardImg} style={styles.icon} />
      <Text style={styles.title}>
        {uiLang === 'ru' ? 'Как вам удобнее\nвводить текст?' : 'How do you prefer\nto enter text?'}
      </Text>

      <TouchableOpacity style={styles.bigBtn} onPress={() => handleInput('voice')}>
        <Text style={styles.bigBtnText}>{uiLang === 'ru' ? 'а) голосом' : 'a) by voice'}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.bigBtn} onPress={() => handleInput('keyboard')}>
        <Text style={styles.bigBtnText}>{uiLang === 'ru' ? 'б) клавиатурой' : 'b) by keyboard'}</Text>
      </TouchableOpacity>
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

  icon: { width: 150, height: 150, marginBottom: 24, resizeMode: 'contain' },
  title: { color: '#fff', fontSize: 24, fontWeight: 'bold', marginBottom: 32, textAlign: 'center', lineHeight: 30 },
  bigBtn: { width: '100%', backgroundColor: '#393B53', borderRadius: 14, alignItems: 'flex-start', paddingVertical: 24, paddingLeft: 34, marginVertical: 12, minWidth: 280 },
  bigBtnText: { color: '#fff', fontSize: 26, fontWeight: 'bold', textAlign: 'left' },
});

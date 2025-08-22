// Главные настройки приложения с голосовой навигацией
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, Alert } from 'react-native';
import { useRouter, useNavigation, Href } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import { transcribeWithOpenAI } from '../lib/transcribe';

const micImg = require('../assets/images/mic_icon.png');

const MIN_DURATION_MS = 700;
const MIN_SIZE_BYTES = 7000;
const HOLD_TO_RECORD_MS = 250;

const ROUTES: Record<'language' | 'speech' | 'input' | 'support', Href> = {
  language: '/language-settings',
  speech: '/speech_settings',
  input: '/input_settings',
  support: '/support',
};

const SYNONYMS: Record<'language' | 'speech' | 'input' | 'support' | 'back', { ru: string[]; en: string[] }> = {
  language: { ru: ['язык', 'языки', 'сменить язык', 'настройки языка', 'языковые настройки'], en: ['language', 'languages', 'language settings'] },
  speech: { ru: ['озвучка', 'настройки озвучки', 'голос', 'звук', 'речь'], en: ['speech', 'voice', 'audio', 'tts'] },
  input: { ru: ['ввод', 'настройки ввода', 'клавиатура', 'текст'], en: ['input', 'keyboard', 'typing'] },
  support: { ru: ['поддержка', 'хелп', 'помощь'], en: ['support', 'help'] },
  back: { ru: ['назад'], en: ['back'] },
};

const ACTIVATION_PHRASES = {
  ru: ['аудио навигация', 'активация навигации', 'голосовая навигация'],
  en: ['audio navigation', 'voice navigation', 'activate navigation'],
} as const;

function hasActivationPhrase(text: string) {
  const t = text.toLowerCase();
  return [...ACTIVATION_PHRASES.ru, ...ACTIVATION_PHRASES.en].some((p) => t.includes(p));
}

export default function SettingsScreen() {
  const router = useRouter();
  const navigation = useNavigation();

  const [speechEnabled, setSpeechEnabled] = useState(true);
  const [speechRate, setSpeechRate] = useState(1.0);
  const [appLang, setAppLang] = useState<'ru' | 'en'>('ru');

  const [listening, setListening] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [voiceNavActive, setVoiceNavActive] = useState(false);

  const startedAtRef = useRef<number | null>(null);
  const recRef = useRef<Audio.Recording | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    navigation.setOptions?.({ tabBarStyle: { display: 'none' }, headerShown: false });
  }, [navigation]);

  useEffect(() => {
    (async () => {
      try { const lng = await AsyncStorage.getItem('language'); setAppLang(lng === 'en' ? 'en' : 'ru'); } catch {}
      try {
        const se = await AsyncStorage.getItem('speechEnabled'); setSpeechEnabled(se !== 'false');
        const sp = (await AsyncStorage.getItem('speechSpeed')) || 'medium'; setSpeechRate(sp === 'fast' ? 1.15 : sp === 'slow' ? 0.85 : 1.0);
      } catch {}
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) { Alert.alert(appLang === 'ru' ? 'Микрофон' : 'Microphone', appLang === 'ru' ? 'Разреши доступ к микрофону.' : 'Please allow microphone access.'); }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
    })();
  }, []);

  const speakOpen = async (labelRu: string, labelEn: string) => {
    if (!speechEnabled) return;
    const phrase = appLang === 'ru' ? `Открываю ${labelRu}` : `Opening ${labelEn}`;
    try { Speech.stop(); } catch {}
    try { await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true }); } catch {}
    await new Promise<void>((resolve) => {
      (Speech as any).speak(phrase, { language: appLang === 'ru' ? 'ru-RU' : 'en-US', rate: speechRate, onDone: resolve, onStopped: resolve, onError: () => resolve() });
    });
    await new Promise(r => setTimeout(r, 80));
    try { await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true }); } catch {}
  };

  const hapticEnabled = async () => {
    try { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch {}
  };

  // Текст под иконкой микрофона (статус)
  const micText = () => {
    if (uploading) return appLang === 'ru' ? 'Отправляю…' : 'Sending…';
    if (listening) return appLang === 'ru' ? 'Слушаю…' : 'Listening…';
    return '';
  };

  const startRecording = async () => {
    if (recRef.current || holdTimerRef.current) return;
    holdTimerRef.current = setTimeout(async () => {
      holdTimerRef.current = null;
      try {
        const perm = await Audio.getPermissionsAsync();
        if (!perm.granted) { const perm2 = await Audio.requestPermissionsAsync(); if (!perm2.granted) return; }
        const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
        recRef.current = recording; startedAtRef.current = Date.now(); setListening(true);
      } catch { setListening(false); }
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
      const text = (textRaw || '').toLowerCase().trim();

      if (!voiceNavActive && hasActivationPhrase(text)) { setVoiceNavActive(true); await hapticEnabled(); return; }

      const containsAny = (arr: readonly string[]) => arr.some((w) => text.includes(w));
      const go = async (route: keyof typeof ROUTES, labelRu: string, labelEn: string) => { await speakOpen(labelRu, labelEn); router.push(ROUTES[route]); };

      if (containsAny([...SYNONYMS.back.ru, ...SYNONYMS.back.en])) { router.back(); setVoiceNavActive(false); return; }
      if (containsAny([...SYNONYMS.language.ru, ...SYNONYMS.language.en])) { await go('language', 'настройки языка', 'language settings'); setVoiceNavActive(false); return; }
      if (containsAny([...SYNONYMS.speech.ru, ...SYNONYMS.speech.en])) { await go('speech', 'озвучку', 'speech'); setVoiceNavActive(false); return; }
      if (containsAny([...SYNONYMS.input.ru, ...SYNONYMS.input.en])) { await go('input', 'ввод текста', 'text input'); setVoiceNavActive(false); return; }
      if (containsAny([...SYNONYMS.support.ru, ...SYNONYMS.support.en])) { await go('support', 'поддержку', 'support'); setVoiceNavActive(false); return; }

    } catch { /* тихо */ }
    finally { setUploading(false); }
  };

  return (
    <View style={styles.wrapper}>
      {/* Микрофон (зажми — говори) */}
      <View style={{ width: '100%', flexDirection: 'row', justifyContent: 'flex-end', padding: 24 }}>
        <View style={{ alignItems: 'center' }}>
          <TouchableOpacity
            onPressIn={startRecording}
            onPressOut={stopAndHandle}
            onLongPress={async () => { if (!voiceNavActive) { setVoiceNavActive(true); await hapticEnabled(); } }}
            delayLongPress={400}
            activeOpacity={0.85}
            style={[styles.micWrapper, listening && styles.micWrapperBig]}
          >
            <Image source={micImg} style={[styles.micIcon, listening && styles.micIconListening]} />
          </TouchableOpacity>
          {(uploading || listening) ? (<Text style={styles.micText}>{micText()}</Text>) : null}
        </View>
      </View>

      {/* Кнопки меню настроек */}
      <View style={styles.menuBlock}>
        <TouchableOpacity style={styles.menuBtn} onPress={() => router.push(ROUTES.language)}>
          <Text style={styles.menuText}>Язык</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuBtn} onPress={() => router.push(ROUTES.speech)}>
          <Text style={styles.menuText}>Озвучка</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuBtn} onPress={() => router.push(ROUTES.input)}>
          <Text style={styles.menuText}>Ввод текста</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuBtn} onPress={() => router.push(ROUTES.support)}>
          <Text style={styles.menuText}>Поддержка</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={styles.restartBtn}
        onPress={async () => { await AsyncStorage.removeItem('onboardingComplete'); await AsyncStorage.removeItem('inputType'); router.replace('/onboarding'); }}
      >
        <Text style={styles.restartBtnText}>Пройти персонализацию заново</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1, backgroundColor: '#0E0F24', alignItems: 'center' },
  menuBlock: { marginTop: 24, width: '92%', alignSelf: 'center', backgroundColor: 'transparent' },
  menuBtn: { backgroundColor: '#393B53', borderRadius: 20, paddingVertical: 20, paddingHorizontal: 30, marginBottom: 18, justifyContent: 'center' },
  menuText: { color: '#fff', fontSize: 24, fontWeight: '500' },
  restartBtn: { marginTop: 48, backgroundColor: '#fff', borderRadius: 20, paddingVertical: 18, paddingHorizontal: 38, alignSelf: 'center' },
  restartBtnText: { color: '#8666E9', fontSize: 24, fontWeight: 'bold', textAlign: 'center' },

  micWrapper: { borderRadius: 14, padding: 6, backgroundColor: 'transparent' },
  micWrapperBig: { transform: [{ scale: 1.18 }] },
  micIcon: { width: 68, height: 68, resizeMode: 'contain' },
  micIconListening: { width: 84, height: 84 },
  micText: { color: '#fff', marginTop: 4, fontSize: 14, textAlign: 'center' },
});

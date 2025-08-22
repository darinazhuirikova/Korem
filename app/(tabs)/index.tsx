// Главный экран вкладки: голосовая навигация и быстрые карточки
import React, { useRef, useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Image,
  Alert,
  Text,
} from 'react-native';
import { useRouter, useNavigation, Href } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { transcribeWithOpenAI } from '../../lib/transcribe';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';
import { classifyCommandLLM, MIN_CONF } from '../../lib/nlu';

/** ======== Параметры записи/навигации ======== */
const MIN_DURATION_MS = 700; // минимальная длительность записи
const MIN_SIZE_BYTES = 7000; // минимальный размер файла
const HOLD_TO_RECORD_MS = 250; // минимальное удержание кнопки перед стартом записи

/** Соответствие экранов маршрутам */
const SCREEN_TO_ROUTE: Record<string, Href> = {
  settings: '/settings',
  speech: '/speech_settings',
  language: '/language-settings',
  input: '/input_settings',
  camera: '/camera',
  navigation: '/navigation',
  explore: '/explore',
  info: '/info',
};

/** === Сопоставление INTENT → экран для NLU === */
const INTENT_TO_SCREEN: Record<string, keyof typeof SCREEN_TO_ROUTE> = {
  OPEN_SETTINGS: 'settings',
  OPEN_LANGUAGE: 'language',
  OPEN_SPEECH: 'speech',
  OPEN_INPUT: 'input',
  OPEN_SUPPORT: 'info',
};
function screenFromIntent(intent: string): keyof typeof SCREEN_TO_ROUTE | null {
  return (INTENT_TO_SCREEN as any)[intent] ?? null;
}

/** Синонимы (RU/EN) для резервного сопоставления, когда NLU недоступен */
const SCREEN_SYNONYMS: Record<string, { ru: string[]; en: string[] }> = {
  settings: {
    ru: [
      'настройки','параметры','опции','раздел настроек','панель настроек','меню настроек',
      'общие настройки','системные настройки','конфигурация','конфиг','предпочтения',
      'изменить настройки','перейти в настройки','открой настройки'
    ],
    en: [
      'settings','options','preferences','prefs','configuration','config','setup',
      'system settings','app settings','settings menu','open settings','go to settings'
    ],
  },

  speech: {
    ru: [
      'озвучка','озвучивание','настройки озвучки','голос','голосовые настройки','звук','речь',
      'синтез речи','синтезатор речи','tts','ттс','прочитай вслух','чтение вслух','диктор',
      'voiceover','объявления','озвучка интерфейса','озвучивание текста','озвучку'
    ],
    en: [
      'speech','voice','audio','sound','tts','text to speech','read aloud','narrator','voice over',
      'spoken output','announcements','speech settings','enable voice','speak'
    ],
  },

  language: {
    ru: [
      'язык','языки','локализация','локаль','locale','сменить язык','выбор языка',
      'настройки языка','языковые настройки','переключить язык','русский','английский','казахский'
    ],
    en: [
      'language','languages','locale','localization','change language','switch language',
      'select language','language settings','language preferences'
    ],
  },

  input: {
    ru: [
      'ввод','ввод текста','способ ввода','тип ввода','клавиатура','клавиатурные настройки',
      'раскладка','раскладка клавиатуры','текст','набор текста','печатать','вводить текст','кнопки'
    ],
    en: [
      'input','text input','text entry','keyboard','keyboards','keyboard layout',
      'typing','type','input method','ime','enter text'
    ],
  },

  camera: {
    ru: [
      'камера','фото','снимок','съёмка','сфотографировать','сделать фото','фотокамера',
      'фотоаппарат','режим камеры','видеокамера','снимать','открыть камеру'
    ],
    en: [
      'camera','photo','picture','capture','shoot','snap','take photo','open camera','camera mode'
    ],
  },

  navigation: {
    ru: [
      'навигация','маршрут','путь','направление','карта','карты','навигатор','gps','джи пи эс',
      'куда идти','ориентирование','перемещение','построить маршрут','route'
    ],
    en: [
      'navigation','route','directions','map','maps','navigator','gps','wayfinding','path','routing',
      'turn by turn'
    ],
  },

  explore: {
    ru: [
      'исследование','исследовать','поиск','обзор','изучение','обзор мест','рекомендации',
      'каталог','просмотр','лента','дискавери','тренды','топ'
    ],
    en: [
      'explore','search','discover','browse','feed','trending','discoveries','catalog','nearby','suggestions'
    ],
  },

  info: {
    ru: [
      'информация','инфо','сведения','справка','помощь','о программе','о приложении',
      'о нас','документация','faq','частые вопросы'
    ],
    en: [
      'info','information','about','about app','help','support','docs','documentation','faq','learn more'
    ],
  },
};


const SCREEN_LABELS: Record<string, { ru: string; en: string }> = {
  settings: { ru: 'настройки', en: 'settings' },
  speech:   { ru: 'озвучка',   en: 'speech' },
  language: { ru: 'язык',      en: 'language' },
  input:    { ru: 'ввод',      en: 'input' },
  camera:   { ru: 'камера',    en: 'camera' },
  navigation:{ ru: 'навигация',en: 'navigation' },
  explore:  { ru: 'обзор',     en: 'explore' },
  info:     { ru: 'информация',en: 'info' },
};

/** Активационные фразы для включения голосовой навигации */
const ACTIVATION_PHRASES = {
  ru: ['аудио навигация', 'активация навигации', 'голосовая навигация'],
  en: ['audio navigation', 'voice navigation', 'activate navigation'],
} as const;

function hasActivationPhrase(text: string) {
  const t = text.toLowerCase().trim();
  for (const lang of ['ru', 'en'] as const) {
    for (const p of ACTIVATION_PHRASES[lang]) if (t.includes(p)) return true;
  }
  return false;
}

/** Составные правила (высший приоритет) — распознаём более конкретные запросы */
function compoundScreenFromText(text: string): string | null {
  const t = text.toLowerCase();

  // RU: «настройки языка», «языковые настройки», «настройки для языка» и т.п.
  // Отправляем в язык (language), а не в общий раздел настроек.
  if (
    t.includes('настройки языка') ||
    t.includes('языковые настройки') ||
    (t.includes('настрой') && t.includes('язык'))
  ) {
    return 'language';
  }

  // EN: «language settings», «settings language» — тоже в language
  if (t.includes('language settings') || (t.includes('settings') && t.includes('language'))) {
    return 'language';
  }

  // Сюда можно добавить другие приоритетные комбинации при необходимости
  return null;
}

/** Резервный словарь по синонимам */
function localScreenFromText(text: string, lang: 'ru' | 'en'): string | null {
  const t = text.toLowerCase();
  for (const key of Object.keys(SCREEN_SYNONYMS)) {
    for (const syn of (SCREEN_SYNONYMS as any)[key][lang]) {
      if (t.includes(syn)) return key;
    }
  }
  return null;
}

/** Настройки записи: m4a (AAC), моно, 44.1 kHz, 64 kbps */
const RECORDING_OPTIONS: Audio.RecordingOptions = {
  ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
  android: {
    ...Audio.RecordingOptionsPresets.HIGH_QUALITY.android,
    extension: '.m4a',
    sampleRate: 44100,
    numberOfChannels: 1,
    bitRate: 64000,
  },
  ios: {
    ...Audio.RecordingOptionsPresets.HIGH_QUALITY.ios,
    extension: '.m4a',
    sampleRate: 44100,
    numberOfChannels: 1,
    bitRate: 64000,
  },
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function MainScreen() {
  const router = useRouter();
  const navigation = useNavigation();

  const [currentLanguage, setCurrentLanguage] = useState<'ru' | 'en'>('ru');
  const [listening, setListening] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [voiceNavActive, setVoiceNavActive] = useState(false);
  const [speechEnabled, setSpeechEnabled] = useState(true);
  const [speechRate, setSpeechRate] = useState(1.0);

  const startedAtRef = useRef<number | null>(null);
  const recRef = useRef<Audio.Recording | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Прячем заголовок и таб-бар */
  useEffect(() => {
    navigation.setOptions?.({ tabBarStyle: { display: 'none' }, headerShown: false });
  }, [navigation]);

  /** Загружаем язык и сразу просим доступ к микрофону */
  useEffect(() => {
    (async () => {
      try {
        const languageStored = await AsyncStorage.getItem('language');
        setCurrentLanguage(languageStored === 'en' ? 'en' : 'ru');
      } catch {}
      // Важно: запросить разрешение сразу на старте
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Microphone', currentLanguage === 'ru'
          ? 'Разреши доступ к микрофону, чтобы использовать голосовую навигацию.'
          : 'Please allow microphone access to use voice navigation.');
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
    })();
  }, []);
  // Загружаем настройки озвучки интерфейса (включена/скорость)
  useEffect(() => {
    (async () => {
      try {
        const se = await AsyncStorage.getItem('speechEnabled');
        setSpeechEnabled(se !== 'false');
        const sp = (await AsyncStorage.getItem('speechSpeed')) || 'medium';
        const rate = sp === 'fast' ? 1.15 : sp === 'slow' ? 0.85 : 1.0;
        setSpeechRate(rate);
      } catch {}
    })();
  }, []);

  const t = (key: 'navOn'|'opening'|'notRecognized'|'pressAndSpeak'|'listening'|'sending') => {
    const dict = {
      ru: {
        navOn: 'Аудио-навигация включена. Скажите название экрана.',
        opening: 'Открываю',
        notRecognized: 'Команда не распознана. Повторите, пожалуйста.',
        pressAndSpeak: '🎤 Нажми и говори',
        listening: 'Слушаю… отпусти',
        sending: 'Отправляю…',
      },
      en: {
        navOn: 'Audio navigation enabled. Say a screen name.',
        opening: 'Opening',
        notRecognized: 'Command not recognized. Please try again.',
        pressAndSpeak: '🎤 Press & speak',
        listening: 'Listening… release',
        sending: 'Sending…',
      },
    } as const;
    return (dict as any)[currentLanguage][key];
  };

  // Озвучиваем «Открываю <экран>», если озвучка интерфейса включена в персонализации
  const speakUiOpen = async (screenKey: string) => {
    try {
      if (!speechEnabled) return;
      const label = (SCREEN_LABELS as any)[screenKey]?.[currentLanguage] ?? screenKey;
      const phrase = currentLanguage === 'ru' ? `Открываю ${label}` : `Opening ${label}`;
      try { Speech.stop(); } catch {}
      try { await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true }); } catch {}

      await new Promise<void>((resolve) => {
        try {
          (Speech as any).speak(phrase, {
            language: currentLanguage === 'ru' ? 'ru-RU' : 'en-US',
            rate: speechRate,
            onDone: resolve,
            onStopped: resolve,
            onError: () => resolve(),
          });
        } catch {
          resolve();
        }
      });
      await new Promise((r) => setTimeout(r, 80));
    } catch {} finally {
      try { await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true }); } catch {}
    }
  };

  // Вибрация при включении аудио-навигации (вместо озвучки)
  const hapticVoiceNavEnabled = async () => {
    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {}
  };
  // Применяем NLU к распознанной фразе. Вернёт true, если команда обработана.
  const applyNlu = async (text: string): Promise<boolean> => {
    try {
      const res = await classifyCommandLLM(text);
      if (!res || (res.confidence ?? 0) < MIN_CONF) return false;

      switch (res.intent) {
        case 'GO_BACK': {
          if ((navigation as any)?.canGoBack?.()) navigation.goBack();
          setVoiceNavActive(false);
          return true;
        }
        case 'ACTIVATE_VOICE_NAV': {
          setVoiceNavActive(true);
          await hapticVoiceNavEnabled();
          return true;
        }
        case 'DEACTIVATE_VOICE_NAV': {
          setVoiceNavActive(false);
          return true;
        }
        case 'SET_LANGUAGE': {
          const lang = res.slots?.language;
          if (lang === 'ru' || lang === 'en') {
            await AsyncStorage.setItem('language', lang);
            setCurrentLanguage(lang);
          } else if (lang === 'kk') {
            await AsyncStorage.setItem('language', 'ru');
            setCurrentLanguage('ru');
          }
          return true;
        }
        case 'SET_INPUT_METHOD': {
          const method = res.slots?.method ?? 'voice';
          await AsyncStorage.setItem('inputMethod', method);
          return true;
        }
        case 'SET_SPEECH_ENABLE': {
          const enable = !!res.slots?.enable;
          setSpeechEnabled(enable);
          await AsyncStorage.setItem('speechEnabled', enable ? 'true' : 'false');
          return true;
        }
        case 'SET_SPEECH_SPEED': {
          const sp = res.slots?.speed ?? 'medium';
          await AsyncStorage.setItem('speechSpeed', sp);
          const rate = sp === 'fast' ? 1.15 : sp === 'slow' ? 0.85 : 1.0;
          setSpeechRate(rate);
          return true;
        }
        case 'SET_WARNING': {
          const w = (res.slots as any)?.warning ?? 'none';
          await AsyncStorage.setItem('warningMode', String(w));
          if (w === 'vibration') {
            try { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch {}
          }
          return true;
        }
        default: {
          const screenKey = screenFromIntent(res.intent);
          if (screenKey && SCREEN_TO_ROUTE[screenKey]) {
            await speakUiOpen(screenKey);
            setVoiceNavActive(false);
            router.push(SCREEN_TO_ROUTE[screenKey]);
            return true;
          }
        }
      }
      return false;
    } catch {
      return false;
    }
  };


  /** Начать запись (нажатие и удержание) */
  const startRecording = async () => {
    try {
      if (recRef.current || holdTimerRef.current) return;
      // Режим «зажми, чтобы записать»: стартуем, только если удержание дольше HOLD_TO_RECORD_MS
      holdTimerRef.current = setTimeout(async () => {
        holdTimerRef.current = null;
        try {
          const perm = await Audio.getPermissionsAsync();
          if (!perm.granted) {
            const perm2 = await Audio.requestPermissionsAsync();
            if (!perm2.granted) return;
          }
          const { recording } = await Audio.Recording.createAsync(RECORDING_OPTIONS);
          recRef.current = recording;
          startedAtRef.current = Date.now();
          setListening(true);
        } catch (e) {
          console.warn('startRecording error', e);
          setListening(false);
        }
      }, HOLD_TO_RECORD_MS);
    } catch (e) {
      console.warn('startRecording outer error', e);
    }
  };

  /** Остановить и отправить (отпускание) */
  const stopAndSend = async () => {
    // Если отпустили раньше, чем началась запись — просто отменяем таймер и выходим
    if (!recRef.current && holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
      setListening(false);
      startedAtRef.current = null;
      return;
    }

    const rec = recRef.current;
    if (!rec) return;
    try { await rec.stopAndUnloadAsync(); } catch {}
    await sleep(80);

    setListening(false);
    const uri = rec.getURI();
    recRef.current = null;
    if (!uri) return;

    // Базовые фильтры «слишком коротко/маленький файл» — тихо игнорируем
    const durMs = startedAtRef.current ? Date.now() - startedAtRef.current : 0;
    startedAtRef.current = null;
    const info = await FileSystem.getInfoAsync(uri);
    if (durMs < MIN_DURATION_MS || (((info as any)?.size) ?? 0) < MIN_SIZE_BYTES) {
      return; // никаких алертов/логов о длительности и размере
    }

    setUploading(true);
    try {
      const textRaw = await transcribeWithOpenAI(uri);
      const recognizedText = (textRaw || '').toLowerCase().trim();

      // Активационная фраза: включаем режим и ждём следующую короткую команду
      if (!voiceNavActive && hasActivationPhrase(recognizedText)) {
        setVoiceNavActive(true);
        await hapticVoiceNavEnabled();
        return;
      }

      // Сначала пробуем NLU
      if (await applyNlu(recognizedText)) {
        return;
      }

      // Если режим активен — допускаем короткие названия экранов (например, «настройки»).
      // Сначала проверяем составные фразы с более высоким приоритетом:
      let screen: string | null = compoundScreenFromText(recognizedText);
      if (!screen) {
        screen = localScreenFromText(recognizedText, currentLanguage);
      }

      if (screen && SCREEN_TO_ROUTE[screen]) {
        try {
          await speakUiOpen(screen);
          // после навигации сбрасываем режим
          setVoiceNavActive(false);
          return router.push(SCREEN_TO_ROUTE[screen]);
        } catch (e) {
          console.warn('Navigation error', e);
        }
      }

      // Не воспроизводим исходную фразу пользователя в уведомлении
      Alert.alert(
        currentLanguage === 'ru' ? 'Не понял команду' : 'Did not understand',
        currentLanguage === 'ru'
          ? 'Скажи, например: «настройки языка».'
          : 'Say e.g. "language settings".'
      );
    } catch (e: any) {
      console.warn('Transcribe error', e);
      Alert.alert('Transcribe', e?.message ?? String(e));
    } finally {
      setUploading(false);
    }
  };

  return (
    <View style={styles.wrapper}>
      <TouchableOpacity style={styles.settingsBtn} onPress={() => router.push('/settings')}>
        <Image source={require('../../assets/images/settings_icon.png')} style={styles.settingsIcon} />
      </TouchableOpacity>

      <View style={styles.grid}>
        <TouchableOpacity style={styles.cardBtn} onPress={() => router.push('/camera')}>
          <Image source={require('../../assets/images/camera_card.png')} style={styles.cardImg} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.cardBtn} onPress={() => Alert.alert('Навигация', 'Функция навигации будет добавлена')}>
          <Image source={require('../../assets/images/navigation_card.png')} style={styles.cardImg} />
        </TouchableOpacity>
      </View>

      {/* Кнопка микрофона: зажми — говори — отпусти */}
      <TouchableOpacity
        style={[
          styles.micWrapper,
          voiceNavActive && styles.micWrapperActive,
          listening && styles.micWrapperListening,
          listening && styles.micWrapperBig,
          uploading && styles.micWrapperUploading,
        ]}
        onPressIn={startRecording}
        onPressOut={stopAndSend}
        onLongPress={async () => {
          if (!voiceNavActive) {
            setVoiceNavActive(true);
            await hapticVoiceNavEnabled();
          }
        }}
        delayLongPress={400}
        activeOpacity={0.85}
      >
        <Image
          source={require('../../assets/images/mic_icon.png')}
          style={[
            styles.micIcon,
            listening && styles.micIconListening,
            (listening || uploading) && { opacity: 0.7 }
          ]}
        />
        {(uploading || listening) && (
          <Text style={styles.micText}>
            {uploading ? t('sending') : t('listening')}
          </Text>
        )}

        
      </TouchableOpacity>
    </View>
  );
}

/** ======== Стили ======== */
const styles = StyleSheet.create({
  wrapper: { flex: 1, backgroundColor: '#0E0F24', justifyContent: 'center', alignItems: 'center' },
  settingsBtn: { position: 'absolute', top: 38, left: 30, zIndex: 10 },
  settingsIcon: { width: 44, height: 44, resizeMode: 'contain' },
  grid: { marginTop: 80 },
  cardBtn: { marginVertical: 22 },
  cardImg: { width: 400, height: 210, resizeMode: 'contain' },

  micWrapper: {
    position: 'absolute',
    right: 32,
    top: 80,
    width: 88,
    height: 104,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
    borderRadius: 12,
    backgroundColor: 'transparent',
  },
  micWrapperBig: { width: 110, height: 124 },
  micWrapperActive: { backgroundColor: '#0E0F24' },
  micWrapperListening: { backgroundColor: '#0E0F24' },
  micWrapperUploading: { backgroundColor: 'transparent' },

  micIcon: { width: 84, height: 84, resizeMode: 'contain' },
  micIconListening: { width: 104, height: 104, resizeMode: 'contain' },

  micText: { color: '#fff', marginTop: 4, fontSize: 16, textAlign: 'center' },
});

import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Image,
  Alert,
  Text,
} from 'react-native';
import { useRouter, useNavigation } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Voice from '@react-native-voice/voice';

export default function MainScreen() {
  const [inputType, setInputType] = useState<'voice' | 'keyboard'>('keyboard');
  const [isListening, setIsListening] = useState(false);
  /**
   * When `voiceNavActive` is true we are in the "navigation" mode – the next
   * utterance will be interpreted as a navigation command (e.g. "настройки").
   * When false we continuously listen for the activation hotword or a long
   * press on the microphone button. Once a navigation command has been
   * executed we reset this flag back to false.  See Voice.onSpeechResults
   * handler below for logic.
   */
  const [voiceNavActive, setVoiceNavActive] = useState(false);
  const router = useRouter();
  const navigation = useNavigation();
  const listenTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    AsyncStorage.getItem('inputType').then((type) => {
      if (type === 'voice' || type === 'keyboard') setInputType(type);
    });
  }, []);

  useEffect(() => {
    navigation.setOptions?.({
      tabBarStyle: { display: 'none' },
      headerShown: false,
    });
    return () => {
      Voice.destroy().then(Voice.removeAllListeners);
      if (listenTimeout.current) clearTimeout(listenTimeout.current);
    };
  }, []);

  useEffect(() => {
    /**
     * Handle incoming recognition results.  We normalise the text to lower-case
     * Russian (ru-RU) for simple matching.  When not in navigation mode we
     * listen for a hotword to enter navigation mode.  When in navigation mode
     * we execute a command and then automatically exit navigation mode.  After
     * handling a phrase we stop and immediately restart listening so that the
     * recogniser stays responsive to subsequent hotwords.
     */
    Voice.onSpeechResults = (e) => {
      const raw = e?.value?.[0] || '';
      const text = raw.toLowerCase().trim();
      console.log('Распознано:', text);
      // When navigation is not active, listen for a hotword to enable it
      if (!voiceNavActive) {
        // If the user says the activation phrase, enter navigation mode
        if (text.includes('активация аудио навигации')) {
          setVoiceNavActive(true);
          // Notify the user that navigation has started
          Alert.alert(
            'Голосовая навигация',
            'Аудио‑навигация включена. Произнесите команду: "Настройки", "Камера" или "Навигация".',
          );
        }
        // Stop current recognition and restart to continue listening
        stopListening().then(() => startListening());
        return;
      }
      // When navigation is active, interpret the next utterance as a command
      let handled = false;
      if (text.includes('настройки')) {
        // Navigate to settings screen
        handled = true;
        router.push('/settings');
      } else if (text.includes('камера')) {
        handled = true;
        Alert.alert('Переход', 'Открытие функции "Камера" (реализуй роут)');
        // router.push('/camera');
      } else if (text.includes('навигация')) {
        handled = true;
        Alert.alert('Переход', 'Открытие функции "Навигация" (реализуй роут)');
        // router.push('/navigation');
      }
      // After handling a command (or if none matched) exit navigation mode
      if (handled || voiceNavActive) {
        setVoiceNavActive(false);
      }
      // Stop current recognition and restart listening for the next hotword
      stopListening().then(() => startListening());
    };

    Voice.onSpeechError = (e) => {
      console.warn('Ошибка распознавания:', e);
      // Stop and restart listening after an error to recover gracefully
      stopListening().then(() => startListening());
    };
  }, [voiceNavActive]);

  const startListening = async () => {
    try {
      setIsListening(true);
      await Voice.start('ru-RU');
      // Clear any previous timeout; we rely on onSpeechResults/onSpeechError to
      // restart listening automatically when needed.  The timeout below acts as
      // a failsafe to stop recognition if no speech is detected for an extended
      // period, preventing the microphone from staying open indefinitely.
      if (listenTimeout.current) clearTimeout(listenTimeout.current);
      listenTimeout.current = setTimeout(() => {
        setIsListening(false);
        Voice.stop();
        // Restart listening so we can continue to detect activation phrases
        startListening();
      }, 15000);
    } catch (e) {
      setIsListening(false);
      console.warn('Ошибка запуска микрофона', e);
    }
  };

  /**
   * Stop listening and clear state.  We wrap Voice.stop in a helper to
   * gracefully handle cases where Voice.stop may throw if invoked while not
   * actively listening.  After stopping we set `isListening` to false.
   */
  const stopListening = async () => {
    try {
      if (listenTimeout.current) {
        clearTimeout(listenTimeout.current);
        listenTimeout.current = null;
      }
      await Voice.stop();
    } catch (error) {
      // ignore errors when stopping if microphone was not active
      console.warn('Ошибка остановки микрофона', error);
    } finally {
      setIsListening(false);
    }
  };

  useEffect(() => {
    startListening();
    return () => {
      if (listenTimeout.current) clearTimeout(listenTimeout.current);
      Voice.destroy().then(Voice.removeAllListeners);
    };
  }, []);

  return (
      <View style={styles.wrapper}>
      <TouchableOpacity
        style={styles.settingsBtn}
        onPress={() => router.push('/settings')}
      >
        <Image source={require('../../assets/images/settings_icon.png')} style={styles.settingsIcon} />
      </TouchableOpacity>
      <View style={styles.grid}>
        <TouchableOpacity style={styles.cardBtn}>
          <Image source={require('../../assets/images/camera_card.png')} style={styles.cardImg} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.cardBtn}>
          <Image source={require('../../assets/images/navigation_card.png')} style={styles.cardImg} />
        </TouchableOpacity>
      </View>
      {/* Микрофон всегда доступен для ручного клика */}
      <TouchableOpacity
        style={styles.micWrapper}
        /**
         * Short press will simply restart the recogniser without entering
         * navigation mode.  Long press enters navigation mode immediately.
         */
        onPress={() => {
          // On a normal tap we begin listening; this will pick up the
          // activation phrase if the user speaks it.  We do not toggle
          // navigation mode here.
          startListening();
        }}
        onLongPress={() => {
          // Long press directly enters navigation mode and begins listening
          if (!voiceNavActive) {
            setVoiceNavActive(true);
            Alert.alert(
              'Голосовая навигация',
              'Аудио‑навигация включена. Произнесите команду: "Настройки", "Камера" или "Навигация".',
            );
          }
          startListening();
        }}
        delayLongPress={400}
        activeOpacity={0.8}
      >
          <Image
            source={require('../../assets/images/mic_icon.png')}
            style={[styles.micIcon, isListening && { opacity: 0.6 }]}
          />
        <Text style={{ color: '#fff', marginTop: 4, fontSize: 16, textAlign: 'center' }}>
          {isListening ? 'Слушаю...' : 'Голос'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    backgroundColor: '#0E0F24',
    justifyContent: 'center',
    alignItems: 'center',
  },
  settingsBtn: {
    position: 'absolute',
    top: 38,
    left: 30,
    zIndex: 10,
  },
  settingsIcon: {
    width: 44,
    height: 44,
    resizeMode: 'contain',
  },
  grid: {
    marginTop: 80,
  },
  cardBtn: {
    marginVertical: 22,
  },
  cardImg: {
    width: 400,
    height: 210,
    resizeMode: 'contain',
  },
  micWrapper: {
    position: 'absolute',
    right: 32,
    top: 120,
    width: 88,
    height: 104,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
  micIcon: {
    width: 84,
    height: 84,
    resizeMode: 'contain',
  },
});

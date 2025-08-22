import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Speech from 'expo-speech';

const avatarImg = require('../assets/images/person_avatar.png');
const voiceImg = require('../assets/images/voice_question.png');
const inputImg = require('../assets/images/text_input_icon.png');
const speedImg = require('../assets/images/speed_icon.png');
const warnImg = require('../assets/images/warn_icon.png');

export default function PersonalizationScreen() {
  const [step, setStep] = useState<'blind' | 'voice' | 'speed' | 'input' | 'warn'>('blind');
  const [isBlind, setIsBlind] = useState<boolean | null>(null);
  const [speechEnabled, setSpeechEnabled] = useState(true);
  const router = useRouter();

  // При запуске загружаем текущее состояние озвучки интерфейса
  useEffect(() => {
    AsyncStorage.getItem('speechEnabled').then((v) => {
      if (v === 'false') setSpeechEnabled(false);
      else setSpeechEnabled(true);
    });
  }, []);

  // Для каждого шага произносим вопрос (если озвучка включена)
  useEffect(() => {
    if (!speechEnabled) return;
    if (step === 'blind') {
      Speech.speak('Вы незрячий человек?');
    } else if (step === 'voice') {
      Speech.speak('Хотите выключить озвучивание интерфейса?');
    } else if (step === 'speed') {
      Speech.speak('Выберите скорость для озвучивания текстов: быстрая, средняя или медленная.');
    } else if (step === 'input') {
      Speech.speak('Как вам удобнее вводить текст? Голосом или клавиатурой?');
    } else if (step === 'warn') {
      Speech.speak('Какой способ предупреждения о препятствиях вам удобнее? Голос, вибрация или ничего.');
    }
  }, [step, speechEnabled]);

  // Шаг 1: вопрос «Вы незрячий человек?»
  function handleBlind(answer: boolean) {
    setIsBlind(answer);
    setTimeout(() => {
      if (answer) setStep('voice');
      else setStep('input');
    }, 200);
  }

  // Шаг 2: вопрос «Хотите выключить озвучку интерфейса?»
  async function handleVoice(answer: boolean) {
    if (answer) {
      await AsyncStorage.setItem('speechEnabled', 'false');
      setSpeechEnabled(false);
      // Если человек хочет выключить озвучку — всё, выходим на главный
      setTimeout(() => {
        AsyncStorage.setItem('inputType', 'keyboard');
        router.replace('/(tabs)');
      }, 300);
    } else {
      await AsyncStorage.setItem('speechEnabled', 'true');
      setSpeechEnabled(true);
      setTimeout(() => setStep('speed'), 300);
    }
  }

  // Шаг 3 (для незрячих): выбор скорости озвучки
  async function handleSpeed(speed: string) {
    await AsyncStorage.setItem('speechSpeed', speed);
    setTimeout(() => setStep('warn'), 300);
  }

  // Шаг 4 (для зрячих): выбор способа ввода текста
  async function handleInput(type: string) {
    await AsyncStorage.setItem('inputType', type);
    setTimeout(() => setStep('warn'), 400);
  }

  // Шаг 5: выбор способа предупреждения о препятствиях
  async function handleWarn(type: string) {
    await AsyncStorage.setItem('obstacleWarning', type);
    // Если пользователь незрячий — inputType точно voice
    if (isBlind) {
      await AsyncStorage.setItem('inputType', 'voice');
    }
    setTimeout(() => router.replace('/(tabs)'), 400);
  }

  // --- Экран: «Какой способ предупреждения о препятствиях…» ---
  if (step === 'warn') {
    return (
      <View style={styles.wrapper}>
        <View style={styles.card}>
          <Image source={warnImg} style={styles.inputImg} resizeMode="contain" />
          <Text style={styles.title}>Какой способ предупреждения{'\n'}о препятствиях вам удобнее?</Text>
          <TouchableOpacity style={styles.bigBtn} onPress={() => handleWarn('voice')}>
            <Text style={styles.bigBtnText}>а) голос</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.bigBtn} onPress={() => handleWarn('vibration')}>
            <Text style={styles.bigBtnText}>б) вибрация</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.bigBtn} onPress={() => handleWarn('none')}>
            <Text style={styles.bigBtnText}>в) ничего</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // --- Экран: «Скорость озвучки» ---
  if (step === 'speed') {
    return (
      <View style={styles.wrapper}>
        <View style={styles.card}>
          <Image source={speedImg} style={styles.inputImg} resizeMode="contain" />
          <Text style={styles.title}>Выберите скорость{'\n'}для озвучивания текстов</Text>
          <TouchableOpacity style={styles.bigBtn} onPress={() => handleSpeed('fast')}>
            <Text style={styles.bigBtnText}>а) быстрая</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.bigBtn} onPress={() => handleSpeed('medium')}>
            <Text style={styles.bigBtnText}>б) средняя</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.bigBtn} onPress={() => handleSpeed('slow')}>
            <Text style={styles.bigBtnText}>в) медленная</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // --- Экран: «Как вам удобнее вводить текст?» ---
  if (step === 'input') {
    return (
      <View style={styles.wrapper}>
        <View style={styles.card}>
          <Image source={inputImg} style={styles.inputImg} resizeMode="contain" />
          <Text style={styles.title}>Как вам удобнее{'\n'}вводить текст?</Text>
          <TouchableOpacity style={styles.bigBtn} onPress={() => handleInput('voice')}>
            <Text style={styles.bigBtnText}>а) голосом</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.bigBtn} onPress={() => handleInput('keyboard')}>
            <Text style={styles.bigBtnText}>б) клавиатурой</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // --- Экран: «Хотите выключить озвучку?» ---
  if (step === 'voice') {
    return (
      <View style={styles.wrapper}>
        <View style={styles.card}>
          <Image source={voiceImg} style={styles.avatar} resizeMode="contain" />
          <Text style={styles.title}>Хотите выключить{'\n'}озвучивание интерфейса?</Text>
          <View style={styles.btnRow}>
            <TouchableOpacity style={styles.btn} onPress={() => handleVoice(true)}>
              <Text style={styles.btnLabel}>Да</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btn} onPress={() => handleVoice(false)}>
              <Text style={styles.btnLabel}>Нет</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  // --- Экран: «Вы незрячий человек?» ---
  return (
    <View style={styles.wrapper}>
      <View style={styles.card}>
        <Image source={avatarImg} style={styles.avatar} resizeMode="contain" />
        <Text style={styles.title}>Вы незрячий человек?</Text>
        <View style={styles.btnRow}>
          <TouchableOpacity style={styles.btn} onPress={() => handleBlind(true)}>
            <Text style={styles.btnLabel}>Да</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btn} onPress={() => handleBlind(false)}>
            <Text style={styles.btnLabel}>Нет</Text>
          </TouchableOpacity>
        </View>
      </View>
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
  card: {
    backgroundColor: '#171A36',
    borderRadius: 28,
    padding: 32,
    width: 340,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 16,
    elevation: 6,
  },
  avatar: {
    width: 120,
    height: 120,
    marginBottom: 24,
  },
  inputImg: {
    width: 140,
    height: 140,
    marginBottom: 18,
  },
  title: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 24,
    textAlign: 'center',
    lineHeight: 30,
  },
  btnRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: 32,
    gap: 16,
  },
  btn: {
    flex: 1,
    paddingVertical: 18,
    borderRadius: 14,
    alignItems: 'center',
    backgroundColor: '#393B53',
    marginHorizontal: 6,
  },
  btnLabel: {
    color: '#fff',
    fontSize: 22,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  bigBtn: {
    backgroundColor: '#393B53',
    borderRadius: 16,
    width: '100%',
    paddingVertical: 24,
    marginVertical: 14,
    alignItems: 'flex-start',
    paddingLeft: 32,
  },
  bigBtnText: {
    color: '#fff',
    fontSize: 28,
    fontWeight: 'bold',
    textAlign: 'left',
    letterSpacing: 0.2,
  },
});

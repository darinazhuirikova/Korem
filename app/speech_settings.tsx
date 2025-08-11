import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';

// УБИРАЕМ NAVBAR (tabBar, header) ↓↓↓
export const options = {
  headerShown: false,
  tabBarStyle: { display: 'none' },
};

const voiceIcon = require('../assets/images/voice_question.png');
const speedIcon = require('../assets/images/speed_icon.png');
const warnIcon = require('../assets/images/warn_icon.png'); // свою картинку

export default function SpeechSettingsScreen() {
  const [step, setStep] = useState(1);
  const router = useRouter();

  // 1. Включить озвучку
  async function handleSpeechEnable(enable: boolean) {
    await AsyncStorage.setItem('speechEnabled', enable ? 'true' : 'false');
    if (enable) setStep(2);
    else {
      // если выбрал "нет" — сбрасываем скорость и предупреждение, возвращаемся на настройки
      await AsyncStorage.multiRemove(['speechSpeed', 'obstacleWarning']);
      router.back();
    }
  }

  // 2. Скорость
  async function handleSpeed(speed: string) {
    await AsyncStorage.setItem('speechSpeed', speed);
    setStep(3);
  }

  // 3. Предупреждение о препятствиях
  async function handleWarning(type: string) {
    await AsyncStorage.setItem('obstacleWarning', type);
    // после выбора возвращаем на настройки
    router.back();
  }

  // --- UI ---
  if (step === 1) {
    return (
      <View style={styles.wrapper}>
        <Image source={voiceIcon} style={styles.icon} />
        <Text style={styles.title}>Хотите включить{'\n'}озвучивание интерфейса?</Text>
        <View style={styles.row}>
          <TouchableOpacity style={styles.btn} onPress={() => handleSpeechEnable(true)}>
            <Text style={styles.btnText}>Да</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btn} onPress={() => handleSpeechEnable(false)}>
            <Text style={styles.btnText}>Нет</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (step === 2) {
    return (
      <View style={styles.wrapper}>
        <Image source={speedIcon} style={styles.icon} />
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
    );
  }

  if (step === 3) {
    return (
      <View style={styles.wrapper}>
        <Image source={warnIcon} style={styles.icon} />
        <Text style={styles.title}>Какой способ предупреждения{'\n'}о препятствиях вам удобнее?</Text>
        <TouchableOpacity style={styles.bigBtn} onPress={() => handleWarning('voice')}>
          <Text style={styles.bigBtnText}>а) голос</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.bigBtn} onPress={() => handleWarning('vibration')}>
          <Text style={styles.bigBtnText}>б) вибрация</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.bigBtn} onPress={() => handleWarning('none')}>
          <Text style={styles.bigBtnText}>в) ничего</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // fallback, вдруг что-то не так
  return <View style={styles.wrapper}><Text style={styles.title}>Ошибка!</Text></View>;
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    backgroundColor: '#0E0F24',
    justifyContent: 'center',
    alignItems: 'center',
  },
  icon: {
    width: 120,
    height: 120,
    marginBottom: 24,
    resizeMode: 'contain',
  },
  title: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 30,
    textAlign: 'center',
    lineHeight: 30,
  },
  row: {
    flexDirection: 'row',
    width: '90%',
    justifyContent: 'space-between',
    marginTop: 18,
    gap: 20,
  },
  btn: {
    flex: 1,
    backgroundColor: '#393B53',
    borderRadius: 14,
    alignItems: 'center',
    paddingVertical: 20,
    marginHorizontal: 8,
  },
  btnText: {
    color: '#fff',
    fontSize: 22,
    fontWeight: 'bold',
  },
  bigBtn: {
    width: '100%',
    backgroundColor: '#393B53',
    borderRadius: 14,
    alignItems: 'flex-start',
    paddingVertical: 24,
    paddingLeft: 34,
    marginVertical: 10,
  },
  bigBtnText: {
    color: '#fff',
    fontSize: 26,
    fontWeight: 'bold',
    textAlign: 'left',
  },
});

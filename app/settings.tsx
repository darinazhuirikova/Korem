import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { useRouter, useNavigation } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';

const micImg = require('../assets/images/mic_icon.png'); // путь актуальный

export default function SettingsScreen() {
  const router = useRouter();
  const navigation = useNavigation();

  React.useEffect(() => {
    navigation.setOptions?.({
      tabBarStyle: { display: 'none' },
      headerShown: false,
    });
  }, [navigation]);

  const handleRestartOnboarding = async () => {
    await AsyncStorage.removeItem('onboardingComplete');
    await AsyncStorage.removeItem('inputType');
    router.replace('/onboarding');
  };

  return (
    <View style={styles.wrapper}>
      {/* Микрофон сверху */}
      <View style={{ width: '100%', flexDirection: 'row', justifyContent: 'flex-end', padding: 24 }}>
        <Image source={micImg} style={{ width: 68, height: 68 }} />
      </View>

      {/* Кнопки меню */}
      <View style={styles.menuBlock}>
        <TouchableOpacity style={styles.menuBtn} onPress={() => router.push('/language-settings')}>
          <Text style={styles.menuText}>Язык</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuBtn} onPress={() => router.push('/speech_settings')}>
          <Text style={styles.menuText}>Озвучка</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuBtn} onPress={() => router.push('/input_settings')}>
          <Text style={styles.menuText}>Ввод текста</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuBtn} onPress={() => {}}>
          <Text style={styles.menuText}>Поддержка</Text>
        </TouchableOpacity>
      </View>

      {/* Кнопка "Пройти персонализацию заново" */}
      <TouchableOpacity style={styles.restartBtn} onPress={handleRestartOnboarding}>
        <Text style={styles.restartBtnText}>Пройти персонализацию заново</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1, backgroundColor: '#0E0F24', alignItems: 'center' },
  menuBlock: {
    marginTop: 24,
    width: '92%',
    alignSelf: 'center',
    backgroundColor: 'transparent'
  },
  menuBtn: {
    backgroundColor: '#393B53',
    borderRadius: 20,
    paddingVertical: 20,
    paddingHorizontal: 30,
    marginBottom: 18,
    justifyContent: 'center',
  },
  menuText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '500',
  },
  restartBtn: {
    marginTop: 48,
    backgroundColor: '#fff',
    borderRadius: 20,
    paddingVertical: 18,
    paddingHorizontal: 38,
    alignSelf: 'center',
  },
  restartBtnText: {
    color: '#8666E9',
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center'
  },
});

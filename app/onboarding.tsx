import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Pressable,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';

enum Screens {
  SPLASH = 'splash',
  LANGUAGE = 'language',
  ABOUT = 'about',
}

const LANGUAGES = [
  { key: 'en', label: 'English' },
  { key: 'ru', label: 'Русский' },
  { key: 'kk', label: 'Қазақша' },
];

export default function OnboardingScreen() {
  const [screen, setScreen] = useState<Screens>(Screens.SPLASH);
  const [language, setLanguage] = useState('');
  const router = useRouter();

  // Экран 1: логотип
  if (screen === Screens.SPLASH) {
    return (
      <Pressable
        style={styles.splashWrapper}
        onPress={() => setScreen(Screens.LANGUAGE)}
      >
        <View style={styles.centerBox}>
          <Image
            source={require('../assets/images/korem_logo.png')}
            style={styles.splashLogo}
            resizeMode="contain"
          />
          <Text style={styles.hint}>
            Нажмите или коснитесь экрана, чтобы продолжить
          </Text>
        </View>
      </Pressable>
    );
  }

  // Экран 2: выбор языка
  if (screen === Screens.LANGUAGE) {
    return (
      <View style={styles.wrapper}>
        <View style={styles.container}>
          <Text style={styles.title}>
            Korem wants to{'\n'}speak in your{'\n'}familiar language
          </Text>
          <Image
            source={require('../assets/images/your_language_icon.png')}
            style={styles.img}
            resizeMode="contain"
          />
          <View style={{ width: '100%', marginTop: 24 }}>
            {LANGUAGES.map((item) => (
              <TouchableOpacity
                key={item.key}
                style={[
                  styles.langBtn,
                  language === item.key && styles.langBtnSelected,
                ]}
                onPress={async () => {
                  setLanguage(item.key);
                  await AsyncStorage.setItem('language', item.key);
                }}
              >
                <Text
                  style={[
                    styles.langBtnText,
                    language === item.key && styles.langBtnTextSelected,
                  ]}
                >
                  {item.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity
            style={[styles.btn, { marginTop: 32 }]}
            onPress={() => setScreen(Screens.ABOUT)}
            disabled={!language}
          >
            <Text
              style={[
                styles.btnText,
                { color: !language ? '#bbb' : '#3d415c' },
              ]}
            >
              Continue
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Экран 3: описание и "Продолжить"
  return (
    <View style={styles.wrapper}>
      <View style={styles.container}>
        <Text style={styles.about}>
          <Text style={{ fontWeight: 'bold', color: '#e5ff27' }}>körеm</Text> —
          ваш помощник для удобной навигации и взаимодействия с миром.{"\n\n"}
          Приложение распознает текст, объекты и строит маршруты с учетом ваших
          потребностей.
        </Text>
        <TouchableOpacity
          style={[styles.btn, styles.nextBtn]}
          onPress={() => {
            // теперь сразу переход на personalization
            router.replace('/personalization');
          }}
        >
          <Text style={styles.btnText}>Продолжить</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  centerBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
  },
  splashWrapper: {
    flex: 1,
    backgroundColor: '#0E0F24', // фон как просили
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
  },
  splashLogo: {
    width: 180, // Сделал крупнее, как в макете
    height: 180,
    marginBottom: 48,
  },
  hint: {
    color: '#aaa',
    fontSize: 16,
    textAlign: 'center',
    marginTop: 18,
  },
  wrapper: {
    flex: 1,
    backgroundColor: '#111428',
    alignItems: 'center',
    justifyContent: 'center',
  },
  container: {
    backgroundColor: '#171A36',
    borderRadius: 28,
    width: '90%',
    maxWidth: 360,
    minHeight: 480,
    padding: 32,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 16,
    elevation: 8,
    justifyContent: 'center',
  },
  transparent: {
    backgroundColor: 'transparent',
    shadowOpacity: 0,
    elevation: 0,
  },
  title: {
    fontWeight: 'bold',
    fontSize: 22,
    marginTop: 24,
    textAlign: 'center',
    color: '#fff',
  },
  img: {
    marginVertical: 32,
    width: 120,
    height: 120,
  },
  btn: {
    marginTop: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 14,
    width: '100%',
  },
  btnText: {
    color: '#3d415c',
    fontSize: 20,
    fontWeight: '600',
    textAlign: 'center',
  },
  about: {
    fontSize: 18,
    marginTop: 16,
    lineHeight: 24,
    textAlign: 'center',
    color: '#fff',
  },
  nextBtn: {
    marginTop: 48,
  },
  langBtn: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 14,
    marginBottom: 12,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  langBtnSelected: {
    borderColor: '#e5ff27',
    backgroundColor: '#fcfcea',
  },
  langBtnText: {
    color: '#3d415c',
    fontSize: 18,
    fontWeight: '500',
  },
  langBtnTextSelected: {
    color: '#bfa800',
  },
});

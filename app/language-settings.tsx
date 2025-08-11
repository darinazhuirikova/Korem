import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Modal,
  FlatList,
  Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Экспорт для Expo Router, чтобы скрывать навбар и хедер:
export const options = {
  headerShown: false,
  tabBarStyle: { display: 'none' },
};

const LANGUAGES = [
  { key: 'en', label: 'English' },
  { key: 'ru', label: 'Русский' },
  { key: 'kk', label: 'Қазақша' },
];

const langImg = require('../assets/images/your_language_icon.png');

export default function LanguageSettings() {
  const [language, setLanguage] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const router = useRouter();

  useEffect(() => {
    AsyncStorage.getItem('language').then((lng) => {
      setLanguage(lng || '');
    });
  }, []);

  async function selectLanguage(lng: string) {
    await AsyncStorage.setItem('language', lng);
    setLanguage(lng);
    setModalVisible(false);
    setTimeout(() => router.replace('/settings'), 400);
  }

  return (
    <View style={styles.wrapper}>
      {/* Back arrow */}
      <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
        <Text style={styles.backArrow}>{'‹'}</Text>
      </TouchableOpacity>

      {/* Mic icon */}
      <Image
        source={require('../assets/images/mic_icon.png')}
        style={styles.micIcon}
      />

      {/* Main icon */}
      <View style={styles.imageContainer}>
        <Image source={langImg} style={styles.langImg} resizeMode="contain" />
      </View>

      {/* Select language button */}
      <TouchableOpacity
        style={styles.langBtn}
        onPress={() => setModalVisible(true)}
      >
        <Text style={styles.langBtnText}>
          {language
            ? LANGUAGES.find((l) => l.key === language)?.label || language
            : 'Выбери язык'}
        </Text>
      </TouchableOpacity>

      {/* Modal for language selection */}
      <Modal visible={modalVisible} animationType="slide" transparent>
        <View style={styles.modalBg}>
          <View style={styles.modalContent}>
            <FlatList
              data={LANGUAGES}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.modalItem}
                  onPress={() => selectLanguage(item.key)}
                >
                  <Text style={styles.modalItemText}>{item.label}</Text>
                  {language === item.key && (
                    <Text style={styles.selectedMark}>✓</Text>
                  )}
                </TouchableOpacity>
              )}
              keyExtractor={(item) => item.key}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const { width } = Dimensions.get('window');

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    backgroundColor: '#0E0F24',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 48,
  },
  backBtn: {
    position: 'absolute',
    top: 36,
    left: 24,
    zIndex: 10,
  },
  backArrow: {
    color: '#fff',
    fontSize: 40,
    fontWeight: '200',
    marginTop: 2,
  },
  micIcon: {
    position: 'absolute',
    top: 28,
    right: 22,
    width: 70,
    height: 70,
    resizeMode: 'contain',
  },
  imageContainer: {
    width: '100%',
    alignItems: 'center',
    marginTop: 50,
    marginBottom: 26,
  },
  langImg: {
    width: width * 0.55, // Большая картинка, адаптивно
    height: width * 0.55,
  },
  langBtn: {
    backgroundColor: '#fff',
    borderRadius: 18,
    paddingVertical: 18,
    paddingHorizontal: 36,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 210,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 7,
    elevation: 3,
  },
  langBtnText: {
    color: '#a2a9b0',
    fontSize: 26,
    fontWeight: '400',
  },
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(30,30,40,0.80)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#22244d',
    borderRadius: 22,
    padding: 24,
    width: 280,
    alignItems: 'center',
    maxHeight: 370,
  },
  modalItem: {
    paddingVertical: 18,
    paddingHorizontal: 10,
    width: 200,
    borderBottomWidth: 1,
    borderBottomColor: '#444',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalItemText: {
    color: '#fff',
    fontSize: 22,
  },
  selectedMark: {
    fontSize: 20,
    color: '#e5ff27',
    marginLeft: 14,
  },
});

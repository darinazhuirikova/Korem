import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Убрать header и navbar/tabbar:
export const options = {
  headerShown: false,
  tabBarStyle: { display: 'none' },
};

const keyboardImg = require('../assets/images/text_input_icon.png'); // поменяй путь если нужно

export default function InputSettingsScreen() {
  const router = useRouter();

  async function handleInput(type: 'voice' | 'keyboard') {
    await AsyncStorage.setItem('inputType', type);
    router.replace('/settings'); // возвращает в настройки
  }

  return (
    <View style={styles.wrapper}>
      <Image source={keyboardImg} style={styles.icon} />
      <Text style={styles.title}>Как вам удобнее{'\n'}вводить текст?</Text>
      <TouchableOpacity style={styles.bigBtn} onPress={() => handleInput('voice')}>
        <Text style={styles.bigBtnText}>а) голосом</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.bigBtn} onPress={() => handleInput('keyboard')}>
        <Text style={styles.bigBtnText}>б) клавиатурой</Text>
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
  icon: {
    width: 150,
    height: 150,
    marginBottom: 24,
    resizeMode: 'contain',
  },
  title: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 32,
    textAlign: 'center',
    lineHeight: 30,
  },
  bigBtn: {
    width: '100%',
    backgroundColor: '#393B53',
    borderRadius: 14,
    alignItems: 'flex-start',
    paddingVertical: 24,
    paddingLeft: 34,
    marginVertical: 12,
    minWidth: 280,
  },
  bigBtnText: {
    color: '#fff',
    fontSize: 26,
    fontWeight: 'bold',
    textAlign: 'left',
  },
});

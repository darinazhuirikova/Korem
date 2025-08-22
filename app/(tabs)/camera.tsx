import React, { useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";

// В демонстрационных целях ключ хранится здесь; для продакшна — прокси/секреты
const API_KEY = "AIzaSyAmU9up_678BXpqoByJCxO0OrlO2C87qUE";

type LocalizedObject = {
  name: string;
  score: number;
  boundingPoly: { normalizedVertices: { x: number; y: number }[] };
};

const POLLING_MS = 450;   // примерно два запроса в секунду
const PHOTO_QUALITY = 0.3;

export default function ObjectDetectionCamera() {
  // Берём any для ref, чтобы не упираться в различия версий expo-camera
  const camRef = useRef<any>(null);
  const [permission, requestPermission] = useCameraPermissions();

  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [objects, setObjects] = useState<LocalizedObject[]>([]);
  const [vw, setVw] = useState(0);
  const [vh, setVh] = useState(0);

  useEffect(() => {
    if (!permission) return;
    if (!permission.granted) requestPermission();
  }, [permission]);

  useEffect(() => {
    let id: any;
    if (ready) id = setInterval(captureAndDetect, POLLING_MS);
    return () => clearInterval(id);
  }, [ready]);

  const captureAndDetect = async () => {
    if (!camRef.current || busy) return;
    setBusy(true);
    try {
      // Отключаем звук затвора и экранную «вспышку»
      const photo = await camRef.current.takePictureAsync({
        base64: true,
        quality: PHOTO_QUALITY,
        skipProcessing: true,
        // @ts-ignore: опция есть на устройствах, но может отсутствовать в типах
        shutterSound: false,
      });

      const body = {
        requests: [
          {
            image: { content: photo.base64 },
            features: [{ type: "OBJECT_LOCALIZATION" }],
          },
        ],
      };

      const res = await fetch("https://vision.googleapis.com/v1/images:annotate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": API_KEY,
        },
        body: JSON.stringify(body),
      });

      const json = await res.json();
      setObjects(json?.responses?.[0]?.localizedObjectAnnotations || []);
    } catch (e) {
      console.warn("Vision error:", e);
    } finally {
      setBusy(false);
    }
  };

  if (!permission) return null;
  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text>Нужно разрешение на камеру</Text>
        <TouchableOpacity onPress={requestPermission} style={[styles.button, { marginTop: 16 }]}>
          <Text style={styles.buttonText}>Выдать доступ</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View
      style={styles.root}
      onLayout={(e) => {
        setVw(e.nativeEvent.layout.width);
        setVh(e.nativeEvent.layout.height);
      }}
    >
      {/* Камера без экранной вспышки */}
      <CameraView
        ref={camRef}
        style={styles.camera}
        facing="back"
        animateShutter={false}   // отключаем анимацию «вспышки»
        onCameraReady={() => setReady(true)}
      />

      {/* Прицел (ромб) */}
      <View style={styles.diamond} pointerEvents="none" />

      {/* Плавающая кнопка микрофона (логика позже) */}
      <TouchableOpacity style={styles.micFab} activeOpacity={0.8} onPress={() => {}}>
        <Ionicons name="mic" size={28} color="#000" />
      </TouchableOpacity>

      {/* Оверлей с прямоугольниками распознанных объектов */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {objects.map((o, idx) => {
          const xs = o.boundingPoly.normalizedVertices.map((v) => v.x * vw);
          const ys = o.boundingPoly.normalizedVertices.map((v) => v.y * vh);
          const left = Math.min(...xs);
          const top = Math.min(...ys);
          const right = Math.max(...xs);
          const bottom = Math.max(...ys);
          return (
            <View
              key={idx}
              style={[styles.box, { left, top, width: right - left, height: bottom - top }]}
            >
              <Text style={styles.boxLabel}>
                {o.name} {(o.score * 100).toFixed(0)}%
              </Text>
            </View>
          );
        })}
      </View>

      {/* Кнопка спуска */}
      <View style={styles.bottomBar}>
        <TouchableOpacity onPress={captureAndDetect} activeOpacity={0.7} style={styles.shutterOuter}>
          <View style={styles.shutterInner} />
        </TouchableOpacity>
      </View>

      {busy && (
        <View style={styles.loadingBadge}>
          <ActivityIndicator />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  camera: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  diamond: {
    position: "absolute",
    left: 24,
    top: 80,
    width: 40,
    height: 40,
    borderWidth: 2,
    borderColor: "#fff",
    borderRadius: 6,
    transform: [{ rotate: "45deg" }],
    opacity: 0.9,
  },

  micFab: {
    position: "absolute",
    right: 24,
    top: 64,
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    elevation: 6,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },

  box: { position: "absolute", borderWidth: 2, borderColor: "lime", borderRadius: 6 },
  boxLabel: {
    position: "absolute",
    left: 0,
    top: -18,
    paddingHorizontal: 6,
    paddingVertical: 2,
    fontSize: 12,
    color: "#fff",
    backgroundColor: "rgba(0,0,0,0.6)",
    borderTopLeftRadius: 6,
    borderBottomRightRadius: 6,
  },

  bottomBar: { position: "absolute", left: 0, right: 0, bottom: 24, alignItems: "center" },
  shutterOuter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: "#eee" },

  loadingBadge: {
    position: "absolute",
    right: 12,
    bottom: 12,
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },

  button: { backgroundColor: "#111", paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
  buttonText: { color: "#fff" },
});

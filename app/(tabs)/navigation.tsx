/**
 * Экран навигации:
 *  - Карта через Google Maps JavaScript API в WebView (react-native-webview уже установлен)
 *  - GPS через expo-location
 *  - Голосовой ввод пункта назначения (Whisper-прокси)
 *  - Два режима маршрута: обычный и доступный (prefer sidewalks / avoid indoor)
 *  - TTS пошаговых инструкций с автопереходом по GPS
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';

import { transcribeAudio } from '../../lib/stt';
import {
  getDirectionsWithFallback,
  geocodeAddress,
  haversineM,
  decodePolyline,
  RouteStep,
  LatLng,
} from '../../lib/directions';
import { VisionBus } from '../../lib/visionBus';
import { shouldAnnounceError } from '../../lib/errorHandler';

// ─── Constants ────────────────────────────────────────────────────────────────
const GOOGLE_KEY = process.env.EXPO_PUBLIC_GOOGLE_KEY ?? '';
// Maps JS API needs a separate key with no Application restrictions (WebView ≠ Android app)
const MAPS_KEY = process.env.EXPO_PUBLIC_MAPS_KEY ?? GOOGLE_KEY;
// How close (metres) before advancing to next step
const STEP_ADVANCE_M = 20;
// GPS update interval (ms)
const GPS_INTERVAL_MS = 3000;
// Minimum recording length
const MIN_DURATION_MS = 700;
const MIN_SIZE_BYTES = 7000;
const HOLD_TO_RECORD_MS = 250;

type RouteMode = 'normal' | 'accessible';
type NavPhase = 'idle' | 'loading' | 'navigating';

// ─── Google Maps WebView HTML ─────────────────────────────────────────────────
function buildMapHtml(apiKey: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<style>
  html,body,#map{height:100%;margin:0;padding:0;background:#0E0F24;}
</style>
</head>
<body>
<div id="map"></div>
<script>
var map,userMarker,routePolyline,stepMarkers=[];

function initMap(){
  map=new google.maps.Map(document.getElementById('map'),{
    zoom:16,center:{lat:51.18,lng:71.45},
    disableDefaultUI:true,
    styles:[{elementType:'geometry',stylers:[{color:'#1a1c2e'}]},
            {elementType:'labels.text.fill',stylers:[{color:'#8ec3b9'}]},
            {featureType:'road',elementType:'geometry',stylers:[{color:'#38414e'}]},
            {featureType:'road',elementType:'geometry.stroke',stylers:[{color:'#212a37'}]},
            {featureType:'water',elementType:'geometry',stylers:[{color:'#17263c'}]}]
  });
  userMarker=new google.maps.Marker({
    map,icon:{path:google.maps.SymbolPath.CIRCLE,scale:10,
              fillColor:'#8666E9',fillOpacity:1,strokeColor:'#fff',strokeWeight:2}
  });
}

function updateLocation(lat,lng){
  var pos={lat:parseFloat(lat),lng:parseFloat(lng)};
  userMarker.setPosition(pos);
  map.panTo(pos);
}

function showRoute(polylinePoints,steps){
  if(routePolyline)routePolyline.setMap(null);
  stepMarkers.forEach(function(m){m.setMap(null);});
  stepMarkers=[];

  routePolyline=new google.maps.Polyline({
    path:polylinePoints,map:map,
    strokeColor:'#8666E9',strokeOpacity:0.9,strokeWeight:5
  });

  if(polylinePoints.length>0){
    map.fitBounds(polylinePoints.reduce(function(b,p){return b.extend(p);},
      new google.maps.LatLngBounds()));
  }

  steps.forEach(function(s,i){
    var m=new google.maps.Marker({
      position:{lat:s.lat,lng:s.lng},map:map,
      label:{text:String(i+1),color:'#fff',fontSize:'11px'},
      icon:{path:google.maps.SymbolPath.CIRCLE,scale:8,
            fillColor:'#e9a866',fillOpacity:1,strokeColor:'#fff',strokeWeight:1}
    });
    stepMarkers.push(m);
  });
}

function highlightStep(idx){
  stepMarkers.forEach(function(m,i){
    m.setIcon({path:google.maps.SymbolPath.CIRCLE,scale:i===idx?12:8,
      fillColor:i===idx?'#ff4444':'#e9a866',fillOpacity:1,
      strokeColor:'#fff',strokeWeight:i===idx?2:1});
  });
}

function clearRoute(){
  if(routePolyline)routePolyline.setMap(null);
  stepMarkers.forEach(function(m){m.setMap(null);});
  stepMarkers=[];
}

// Messages from React Native
document.addEventListener('message',handle);
window.addEventListener('message',handle);
function handle(e){
  try{
    var d=JSON.parse(e.data);
    if(d.type==='loc')updateLocation(d.lat,d.lng);
    else if(d.type==='route')showRoute(d.points,d.steps);
    else if(d.type==='step')highlightStep(d.idx);
    else if(d.type==='clear')clearRoute();
  }catch(ex){}
}
</script>
<script async
  src="https://maps.googleapis.com/maps/api/js?key=${apiKey}&callback=initMap">
</script>
</body>
</html>`;
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function NavigationScreen() {
  const webViewRef = useRef<WebView>(null);

  // Settings
  const [appLang, setAppLang] = useState<'ru' | 'en'>('ru');
  const [speechEnabled, setSpeechEnabled] = useState(true);
  const [speechRate, setSpeechRate] = useState(1.0);

  // Location
  const [userLocation, setUserLocation] = useState<LatLng | null>(null);
  const [locationError, setLocationError] = useState('');

  // Route
  const [routeMode, setRouteMode] = useState<RouteMode>('normal');
  const [phase, setPhase] = useState<NavPhase>('idle');
  const [steps, setSteps] = useState<RouteStep[]>([]);
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [destination, setDestination] = useState('');
  const [totalInfo, setTotalInfo] = useState('');

  // Voice input
  const [listening, setListening] = useState(false);
  const [uploading, setUploading] = useState(false);
  const recRef = useRef<Audio.Recording | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAtRef = useRef<number | null>(null);

  const locationSubRef = useRef<Location.LocationSubscription | null>(null);
  const userLocationRef = useRef<LatLng | null>(null);
  const isSpeakingRef  = useRef(false);
  const lastGpsRef     = useRef(Date.now());

  // ── Load settings ──────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const lang = await AsyncStorage.getItem('language');
        setAppLang(lang === 'en' ? 'en' : 'ru');
        const se = await AsyncStorage.getItem('speechEnabled');
        setSpeechEnabled(se !== 'false');
        const sp = (await AsyncStorage.getItem('speechSpeed')) || 'medium';
        setSpeechRate(sp === 'fast' ? 1.15 : sp === 'slow' ? 0.85 : 1.0);
      } catch {}
    })();
  }, []);

  // ── GPS ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationError(appLang === 'ru' ? 'Нет доступа к геолокации' : 'Location permission denied');
        return;
      }
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: GPS_INTERVAL_MS, distanceInterval: 5 },
        (loc) => {
          const pos: LatLng = { lat: loc.coords.latitude, lng: loc.coords.longitude };
          setUserLocation(pos);
          userLocationRef.current = pos;
          lastGpsRef.current = Date.now();
          postToMap({ type: 'loc', lat: pos.lat, lng: pos.lng });
          checkStepAdvance(pos);
        }
      );
      locationSubRef.current = sub;
    })();
    return () => { sub?.remove(); };
  }, []);

  const postToMap = (data: object) => {
    webViewRef.current?.injectJavaScript(
      `(function(){var e=new MessageEvent('message',{data:${JSON.stringify(JSON.stringify(data))}});document.dispatchEvent(e);})();true;`
    );
  };

  // ── Step advance ───────────────────────────────────────────────────────────
  const stepsRef = useRef<RouteStep[]>([]);
  const stepIdxRef = useRef(0);
  stepsRef.current = steps;
  stepIdxRef.current = currentStepIdx;

  const checkStepAdvance = useCallback((pos: LatLng) => {
    const stps = stepsRef.current;
    const idx = stepIdxRef.current;
    if (stps.length === 0 || idx >= stps.length) return;

    const dist = haversineM(pos, stps[idx].endLocation);
    if (dist < STEP_ADVANCE_M) {
      const next = idx + 1;
      if (next >= stps.length) {
        // Arrived
        setPhase('idle');
        const msg = appLang === 'ru' ? 'Вы прибыли!' : 'You have arrived!';
        if (speechEnabled) (Speech as any).speak(msg, { language: appLang === 'ru' ? 'ru-RU' : 'en-US', rate: speechRate });
        try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch {}
      } else {
        setCurrentStepIdx(next);
        stepIdxRef.current = next;
        postToMap({ type: 'step', idx: next });
        speakStep(stps[next]);
      }
    }
  }, [appLang, speechEnabled, speechRate]);

  // Track speaking state so VisionBus alerts don't interrupt maneuver TTS
  // ── Vision obstacle alerts during navigation ────────────────────────────────
  useEffect(() => {
    if (phase !== 'navigating') return;
    const unsub = VisionBus.subscribe((alert) => {
      if (alert.priority !== 'HIGH') return;
      if (isSpeakingRef.current) return; // maneuver TTS in progress

      // Suppress near waypoints (< 30 m) so turn instruction takes priority
      const pos = userLocationRef.current;
      const step = stepsRef.current[stepIdxRef.current];
      if (pos && step && haversineM(pos, step.endLocation) < 30) return;

      const name = appLang === 'ru' ? alert.label : alert.labelEn;
      speakWithTracking(appLang === 'ru' ? `Внимание: ${name}` : `Warning: ${name}`);
    });
    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, appLang, speechEnabled]);

  // ── GPS loss detection during navigation ─────────────────────────────────────
  useEffect(() => {
    if (phase !== 'navigating') return;
    const id = setInterval(() => {
      if (Date.now() - lastGpsRef.current > 30_000) {
        if (shouldAnnounceError('gps_lost')) {
          speakWithTracking(appLang === 'ru' ? 'GPS сигнал потерян' : 'GPS signal lost');
        }
      }
    }, 10_000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, appLang, speechEnabled]);

  const speakWithTracking = (text: string) => {
    if (!speechEnabled) return;
    isSpeakingRef.current = true;
    try {
      Speech.stop();
      (Speech as any).speak(text, {
        language: appLang === 'ru' ? 'ru-RU' : 'en-US',
        rate: speechRate,
        onDone:    () => { isSpeakingRef.current = false; },
        onStopped: () => { isSpeakingRef.current = false; },
        onError:   () => { isSpeakingRef.current = false; },
      });
    } catch { isSpeakingRef.current = false; }
  };

  const speakStep = (step: RouteStep) => speakWithTracking(step.instruction);

  // ── Build route ────────────────────────────────────────────────────────────
  const buildRoute = async (destText: string) => {
    const pos = userLocationRef.current;
    if (!pos) {
      Alert.alert(
        appLang === 'ru' ? 'GPS' : 'GPS',
        appLang === 'ru' ? 'Ожидаем координаты…' : 'Waiting for GPS…'
      );
      return;
    }
    setPhase('loading');
    setDestination(destText);
    try {
      const route = await getDirectionsWithFallback(pos, destText, routeMode === 'accessible', appLang);
      setSteps(route.steps);
      setCurrentStepIdx(0);
      stepIdxRef.current = 0;

      const distKm = (route.totalDistanceM / 1000).toFixed(1);
      const durMin = Math.ceil(route.totalDurationSec / 60);
      setTotalInfo(
        appLang === 'ru'
          ? `${distKm} км · ${durMin} мин`
          : `${distKm} km · ${durMin} min`
      );

      // Send route to map
      const polyPoints = decodePolyline(route.overviewPolyline).map((p) => ({ lat: p.lat, lng: p.lng }));
      const stepPoints = route.steps.map((s) => ({ lat: s.endLocation.lat, lng: s.endLocation.lng }));
      postToMap({ type: 'route', points: polyPoints, steps: stepPoints });
      postToMap({ type: 'step', idx: 0 });

      setPhase('navigating');
      // Announce ORS wheelchair routing when active
      if (route.source === 'ors' && speechEnabled) {
        setTimeout(() => speakWithTracking(appLang === 'ru' ? 'Маршрут для колясок' : 'Wheelchair route'), 300);
      }

      // Speak first step
      if (route.steps.length > 0) speakStep(route.steps[0]);

      if (route.warnings.length > 0 && speechEnabled) {
        setTimeout(() => speakWithTracking(route.warnings[0]), 3000);
      }
    } catch (e: any) {
      setPhase('idle');
      Alert.alert(appLang === 'ru' ? 'Ошибка маршрута' : 'Route error', e?.message ?? String(e));
    }
  };

  const cancelRoute = () => {
    setPhase('idle');
    setSteps([]);
    setCurrentStepIdx(0);
    setDestination('');
    setTotalInfo('');
    postToMap({ type: 'clear' });
    try { Speech.stop(); } catch {}
  };

  // ── Voice recording ────────────────────────────────────────────────────────
  const startRecording = async () => {
    if (recRef.current || holdTimerRef.current) return;
    holdTimerRef.current = setTimeout(async () => {
      holdTimerRef.current = null;
      try {
        const perm = await Audio.getPermissionsAsync();
        if (!perm.granted) {
          const p2 = await Audio.requestPermissionsAsync();
          if (!p2.granted) return;
        }
        await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
        const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
        recRef.current = recording;
        startedAtRef.current = Date.now();
        setListening(true);
      } catch { setListening(false); }
    }, HOLD_TO_RECORD_MS);
  };

  const stopAndSend = async () => {
    if (!recRef.current && holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
      setListening(false);
      return;
    }
    const rec = recRef.current;
    if (!rec) return;
    try { await rec.stopAndUnloadAsync(); } catch {}
    await new Promise((r) => setTimeout(r, 80));
    setListening(false);

    const uri = rec.getURI();
    recRef.current = null;
    if (!uri) return;

    const dur = startedAtRef.current ? Date.now() - startedAtRef.current : 0;
    startedAtRef.current = null;
    const info = await FileSystem.getInfoAsync(uri);
    if (dur < MIN_DURATION_MS || ((info as any)?.size ?? 0) < MIN_SIZE_BYTES) return;

    setUploading(true);
    try {
      const onFallback = () => {
        try {
          (Speech as any).speak(
            appLang === 'ru' ? 'Нет сети. Работаю офлайн.' : 'No network. Offline mode.',
            { language: appLang === 'ru' ? 'ru-RU' : 'en-US' },
          );
        } catch {}
      };
      const text = (await transcribeAudio(uri, appLang, onFallback)).trim();
      if (text) {
        if (phase === 'navigating') {
          const t = text.toLowerCase();
          if (t.includes('отмена') || t.includes('стоп') || t.includes('cancel') || t.includes('stop')) {
            cancelRoute();
            return;
          }
          if (t.includes('повтори') || t.includes('repeat') || steps[currentStepIdx]) {
            speakStep(steps[currentStepIdx]);
            return;
          }
        }
        await buildRoute(text);
      }
    } catch (e: any) {
      if (e?.message === 'WHISPER_NOT_DOWNLOADED') {
        Alert.alert(
          appLang === 'ru' ? 'Нет сети' : 'No network',
          appLang === 'ru'
            ? 'Нет сети и офлайн-распознавание не загружено. Скачайте его в «Настройках озвучки».'
            : 'No network and offline model not downloaded. Download it in Speech Settings.'
        );
      } else {
        Alert.alert(appLang === 'ru' ? 'Ошибка' : 'Error', e?.message ?? String(e));
      }
    } finally {
      setUploading(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <View style={styles.root}>
      {/* Map */}
      <WebView
        ref={webViewRef}
        style={styles.map}
        source={{ html: buildMapHtml(MAPS_KEY) }}
        javaScriptEnabled
        domStorageEnabled
        originWhitelist={['*']}
        mixedContentMode="always"
      />

      {/* Top overlay */}
      <View style={styles.topBar}>
        {/* Route mode toggle */}
        <View style={styles.modeRow}>
          <TouchableOpacity
            style={[styles.modeBtn, routeMode === 'normal' && styles.modeBtnActive]}
            onPress={() => setRouteMode('normal')}
            disabled={phase === 'navigating'}
          >
            <Ionicons name="walk-outline" size={16} color={routeMode === 'normal' ? '#fff' : '#aaa'} />
            <Text style={[styles.modeTxt, routeMode === 'normal' && styles.modeTxtActive]}>
              {appLang === 'ru' ? 'Обычный' : 'Normal'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeBtn, routeMode === 'accessible' && styles.modeBtnActive]}
            onPress={() => setRouteMode('accessible')}
            disabled={phase === 'navigating'}
          >
            <Ionicons name="accessibility-outline" size={16} color={routeMode === 'accessible' ? '#fff' : '#aaa'} />
            <Text style={[styles.modeTxt, routeMode === 'accessible' && styles.modeTxtActive]}>
              {appLang === 'ru' ? 'Доступный' : 'Accessible'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* GPS status */}
        <View style={[styles.gpsDot, userLocation ? styles.gpsDotGreen : styles.gpsDotRed]} />
      </View>

      {/* Loading overlay */}
      {phase === 'loading' && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#8666E9" />
          <Text style={styles.loadingTxt}>
            {appLang === 'ru' ? 'Строю маршрут…' : 'Building route…'}
          </Text>
        </View>
      )}

      {/* Active navigation panel */}
      {phase === 'navigating' && steps.length > 0 && (
        <View style={styles.navPanel}>
          <View style={styles.navHeader}>
            <Text style={styles.navDest} numberOfLines={1}>{destination}</Text>
            <Text style={styles.navTotal}>{totalInfo}</Text>
          </View>
          <ScrollView style={styles.stepScroll} showsVerticalScrollIndicator={false}>
            {steps.map((s, i) => (
              <View
                key={i}
                style={[styles.stepRow, i === currentStepIdx && styles.stepRowActive]}
              >
                <View style={[styles.stepDot, i === currentStepIdx && styles.stepDotActive]} />
                <Text style={[styles.stepTxt, i === currentStepIdx && styles.stepTxtActive]}
                  numberOfLines={2}>
                  {s.instruction}
                </Text>
                <Text style={styles.stepDist}>
                  {s.distanceM >= 1000
                    ? `${(s.distanceM / 1000).toFixed(1)} km`
                    : `${s.distanceM} m`}
                </Text>
              </View>
            ))}
          </ScrollView>
          <TouchableOpacity style={styles.cancelBtn} onPress={cancelRoute}>
            <Ionicons name="close-circle-outline" size={20} color="#ff6b6b" />
            <Text style={styles.cancelTxt}>
              {appLang === 'ru' ? 'Отмена' : 'Cancel'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Location error */}
      {locationError ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorTxt}>{locationError}</Text>
        </View>
      ) : null}

      {/* Bottom: mic button */}
      <View style={styles.bottomBar}>
        {phase !== 'navigating' && (
          <Text style={styles.prompt}>
            {appLang === 'ru'
              ? (uploading ? 'Ищу маршрут…' : listening ? 'Слушаю… отпусти' : 'Зажми и скажи пункт назначения')
              : (uploading ? 'Finding route…' : listening ? 'Listening… release' : 'Hold & say your destination')}
          </Text>
        )}
        {phase === 'navigating' && (
          <Text style={styles.prompt}>
            {appLang === 'ru' ? 'Скажи «повтори» или «стоп»' : 'Say "repeat" or "stop"'}
          </Text>
        )}
        <TouchableOpacity
          style={[
            styles.micBtn,
            listening && styles.micBtnListening,
            uploading && styles.micBtnUploading,
          ]}
          onPressIn={startRecording}
          onPressOut={stopAndSend}
          activeOpacity={0.85}
        >
          {uploading
            ? <ActivityIndicator color="#fff" />
            : <Ionicons name={listening ? 'radio-button-on' : 'mic'} size={32} color="#fff" />}
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0E0F24' },
  map: { flex: 1 },

  topBar: {
    position: 'absolute', top: 48, left: 16, right: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  modeRow: {
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 20, padding: 4, gap: 4,
  },
  modeBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16 },
  modeBtnActive: { backgroundColor: '#8666E9' },
  modeTxt: { color: '#aaa', fontSize: 13, fontWeight: '600' },
  modeTxtActive: { color: '#fff' },
  gpsDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: '#fff' },
  gpsDotGreen: { backgroundColor: '#3cce6a' },
  gpsDotRed: { backgroundColor: '#ff4444' },

  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(14,15,36,0.8)',
    alignItems: 'center', justifyContent: 'center', gap: 16,
  },
  loadingTxt: { color: '#fff', fontSize: 16 },

  navPanel: {
    position: 'absolute', bottom: 130, left: 12, right: 12,
    backgroundColor: 'rgba(14,15,36,0.94)',
    borderRadius: 20, padding: 14, maxHeight: 260,
    borderWidth: 1, borderColor: 'rgba(134,102,233,0.3)',
  },
  navHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10, alignItems: 'center' },
  navDest: { color: '#fff', fontSize: 15, fontWeight: '700', flex: 1, marginRight: 8 },
  navTotal: { color: '#8666E9', fontSize: 13, fontWeight: '600' },
  stepScroll: { maxHeight: 150 },
  stepRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, gap: 10 },
  stepRowActive: { backgroundColor: 'rgba(134,102,233,0.15)', borderRadius: 10, paddingHorizontal: 6 },
  stepDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#555', flexShrink: 0 },
  stepDotActive: { backgroundColor: '#8666E9', width: 10, height: 10, borderRadius: 5 },
  stepTxt: { color: '#aaa', fontSize: 13, flex: 1 },
  stepTxtActive: { color: '#fff', fontWeight: '600' },
  stepDist: { color: '#666', fontSize: 11, flexShrink: 0 },
  cancelBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10 },
  cancelTxt: { color: '#ff6b6b', fontSize: 14, fontWeight: '600' },

  errorBanner: {
    position: 'absolute', top: 100, alignSelf: 'center',
    backgroundColor: 'rgba(200,40,40,0.85)', borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 8,
  },
  errorTxt: { color: '#fff', fontSize: 13 },

  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingBottom: 36, paddingTop: 16,
    backgroundColor: 'rgba(14,15,36,0.95)',
    alignItems: 'center', gap: 10,
  },
  prompt: { color: 'rgba(255,255,255,0.7)', fontSize: 13, textAlign: 'center', paddingHorizontal: 24 },
  micBtn: {
    width: 70, height: 70, borderRadius: 35,
    backgroundColor: '#8666E9', alignItems: 'center', justifyContent: 'center',
    elevation: 6, shadowColor: '#8666E9', shadowOpacity: 0.5, shadowRadius: 10,
  },
  micBtnListening: { backgroundColor: '#c060ff', transform: [{ scale: 1.12 }] },
  micBtnUploading: { backgroundColor: '#555' },
});

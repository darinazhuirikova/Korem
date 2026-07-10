// Cityscapes 19 semantic classes — used by PIDNet-S
// Index matches argmax output of the model

export type CityLabel = {
  en: string;
  ru: string;
  color: [number, number, number, number]; // RGBA 0-255
};

export const CITYSCAPES_LABELS: CityLabel[] = [
  { en: 'road',           ru: 'дорога',              color: [128,  64, 128, 180] }, // 0
  { en: 'sidewalk',       ru: 'тротуар',             color: [244,  35, 232, 180] }, // 1
  { en: 'building',       ru: 'здание',              color: [ 70,  70,  70, 120] }, // 2
  { en: 'wall',           ru: 'стена',               color: [102, 102, 156, 120] }, // 3
  { en: 'fence',          ru: 'забор',               color: [190, 153, 153, 120] }, // 4
  { en: 'pole',           ru: 'столб',               color: [153, 153, 153, 140] }, // 5
  { en: 'traffic light',  ru: 'светофор',            color: [250, 170,  30, 180] }, // 6
  { en: 'traffic sign',   ru: 'дорожный знак',       color: [220, 220,   0, 180] }, // 7
  { en: 'vegetation',     ru: 'растительность',      color: [107, 142,  35, 120] }, // 8
  { en: 'terrain',        ru: 'газон',               color: [152, 251, 152, 140] }, // 9
  { en: 'sky',            ru: 'небо',                color: [ 70, 130, 180,  80] }, // 10
  { en: 'person',         ru: 'человек',             color: [220,  20,  60, 200] }, // 11
  { en: 'rider',          ru: 'велосипедист',        color: [255,   0,   0, 200] }, // 12
  { en: 'car',            ru: 'автомобиль',          color: [  0,   0, 142, 200] }, // 13
  { en: 'truck',          ru: 'грузовик',            color: [  0,   0,  70, 200] }, // 14
  { en: 'bus',            ru: 'автобус',             color: [  0,  60, 100, 200] }, // 15
  { en: 'train',          ru: 'поезд',               color: [  0,  80, 100, 200] }, // 16
  { en: 'motorcycle',     ru: 'мотоцикл',            color: [  0,   0, 230, 200] }, // 17
  { en: 'bicycle',        ru: 'велосипед',           color: [119,  11,  32, 200] }, // 18
];

// Navigation priority (for TTS decisions)
// DANGER: always announce if significant coverage
export const DANGER_CLASSES  = new Set([0, 13, 14, 15, 16, 17, 18]); // road + vehicles
// PEOPLE: announce if present in lower frame
export const PEOPLE_CLASSES  = new Set([11, 12]); // person, rider
// SAFE: user is on safe ground → silence
export const SAFE_CLASSES    = new Set([1, 9]);   // sidewalk, terrain
// ALERT: announce when seen
export const ALERT_CLASSES   = new Set([6, 7]);   // traffic light, sign

// Class thresholds (fraction of analysis zone pixels)
export const ROAD_THRESHOLD    = 0.25; // >25% road pixels → warn
export const PEOPLE_THRESHOLD  = 0.05; // >5%  people pixels → warn
export const DANGER_THRESHOLD  = 0.10; // >10% vehicle pixels → warn

export const NUM_CITY_CLASSES = 19;
// Model input size — must match convert_pidnet.py INPUT_W / INPUT_H
export const PIDNET_W = 256;
export const PIDNET_H = 128;

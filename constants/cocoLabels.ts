// COCO 80-class labels with Russian translations and priority flags for blind navigation

export type CocoLabel = { en: string; ru: string };

export const COCO_LABELS: CocoLabel[] = [
  { en: 'person',          ru: 'человек' },        // 0
  { en: 'bicycle',         ru: 'велосипед' },       // 1
  { en: 'car',             ru: 'автомобиль' },      // 2
  { en: 'motorcycle',      ru: 'мотоцикл' },        // 3
  { en: 'airplane',        ru: 'самолёт' },         // 4
  { en: 'bus',             ru: 'автобус' },         // 5
  { en: 'train',           ru: 'поезд' },           // 6
  { en: 'truck',           ru: 'грузовик' },        // 7
  { en: 'boat',            ru: 'лодка' },           // 8
  { en: 'traffic light',   ru: 'светофор' },        // 9
  { en: 'fire hydrant',    ru: 'гидрант' },         // 10
  { en: 'stop sign',       ru: 'знак стоп' },       // 11
  { en: 'parking meter',   ru: 'паркомат' },        // 12
  { en: 'bench',           ru: 'скамейка' },        // 13
  { en: 'bird',            ru: 'птица' },           // 14
  { en: 'cat',             ru: 'кот' },             // 15
  { en: 'dog',             ru: 'собака' },          // 16
  { en: 'horse',           ru: 'лошадь' },          // 17
  { en: 'sheep',           ru: 'овца' },            // 18
  { en: 'cow',             ru: 'корова' },          // 19
  { en: 'elephant',        ru: 'слон' },            // 20
  { en: 'bear',            ru: 'медведь' },         // 21
  { en: 'zebra',           ru: 'зебра' },           // 22
  { en: 'giraffe',         ru: 'жираф' },           // 23
  { en: 'backpack',        ru: 'рюкзак' },          // 24
  { en: 'umbrella',        ru: 'зонт' },            // 25
  { en: 'handbag',         ru: 'сумка' },           // 26
  { en: 'tie',             ru: 'галстук' },         // 27
  { en: 'suitcase',        ru: 'чемодан' },         // 28
  { en: 'frisbee',         ru: 'фрисби' },          // 29
  { en: 'skis',            ru: 'лыжи' },            // 30
  { en: 'snowboard',       ru: 'сноуборд' },        // 31
  { en: 'sports ball',     ru: 'мяч' },             // 32
  { en: 'kite',            ru: 'воздушный змей' },  // 33
  { en: 'baseball bat',    ru: 'бита' },            // 34
  { en: 'baseball glove',  ru: 'перчатка' },        // 35
  { en: 'skateboard',      ru: 'скейтборд' },       // 36
  { en: 'surfboard',       ru: 'сёрфборд' },        // 37
  { en: 'tennis racket',   ru: 'ракетка' },         // 38
  { en: 'bottle',          ru: 'бутылка' },         // 39
  { en: 'wine glass',      ru: 'бокал' },           // 40
  { en: 'cup',             ru: 'кружка' },          // 41
  { en: 'fork',            ru: 'вилка' },           // 42
  { en: 'knife',           ru: 'нож' },             // 43
  { en: 'spoon',           ru: 'ложка' },           // 44
  { en: 'bowl',            ru: 'тарелка' },         // 45
  { en: 'banana',          ru: 'банан' },           // 46
  { en: 'apple',           ru: 'яблоко' },          // 47
  { en: 'sandwich',        ru: 'бутерброд' },       // 48
  { en: 'orange',          ru: 'апельсин' },        // 49
  { en: 'broccoli',        ru: 'брокколи' },        // 50
  { en: 'carrot',          ru: 'морковь' },         // 51
  { en: 'hot dog',         ru: 'хот-дог' },         // 52
  { en: 'pizza',           ru: 'пицца' },           // 53
  { en: 'donut',           ru: 'пончик' },          // 54
  { en: 'cake',            ru: 'торт' },            // 55
  { en: 'chair',           ru: 'стул' },            // 56
  { en: 'couch',           ru: 'диван' },           // 57
  { en: 'potted plant',    ru: 'цветок' },          // 58
  { en: 'bed',             ru: 'кровать' },         // 59
  { en: 'dining table',    ru: 'стол' },            // 60
  { en: 'toilet',          ru: 'унитаз' },          // 61
  { en: 'tv',              ru: 'телевизор' },       // 62
  { en: 'laptop',          ru: 'ноутбук' },         // 63
  { en: 'mouse',           ru: 'мышь' },            // 64
  { en: 'remote',          ru: 'пульт' },           // 65
  { en: 'keyboard',        ru: 'клавиатура' },      // 66
  { en: 'cell phone',      ru: 'телефон' },         // 67
  { en: 'microwave',       ru: 'микроволновка' },   // 68
  { en: 'oven',            ru: 'плита' },           // 69
  { en: 'toaster',         ru: 'тостер' },          // 70
  { en: 'sink',            ru: 'раковина' },        // 71
  { en: 'refrigerator',    ru: 'холодильник' },     // 72
  { en: 'book',            ru: 'книга' },           // 73
  { en: 'clock',           ru: 'часы' },            // 74
  { en: 'vase',            ru: 'ваза' },            // 75
  { en: 'scissors',        ru: 'ножницы' },         // 76
  { en: 'teddy bear',      ru: 'мягкая игрушка' },  // 77
  { en: 'hair drier',      ru: 'фен' },             // 78
  { en: 'toothbrush',      ru: 'зубная щётка' },    // 79
];

// ── City navigation classes (appended after COCO-80, trained separately) ─────
// Indices: sidewalk=80, road=81, crosswalk=82, curb=83
export const CITY_CLASSES: { en: string; ru: string }[] = [
  { en: 'sidewalk',   ru: 'тротуар' },         // 80
  { en: 'road',       ru: 'проезжая часть' },   // 81
  { en: 'crosswalk',  ru: 'пешеходный переход' }, // 82
  { en: 'curb',       ru: 'бордюр' },           // 83
];

// Combined label table used by yolo.ts decoder
export const ALL_LABELS = [...COCO_LABELS, ...CITY_CLASSES];

// Classes that always trigger audio announcement (navigation-critical)
export const HIGH_PRIORITY_CLASSES = new Set([0, 1, 2, 3, 5, 7]);   // person, bicycle, car, motorcycle, bus, truck
// Classes announced only when bounding box is large (= object is close)
export const MEDIUM_PRIORITY_CLASSES = new Set([9, 11, 13, 56, 60]); // traffic light, stop sign, bench, chair, table
// City classes: always announce crosswalk; announce sidewalk/road/curb when close
export const CITY_HIGH_PRIORITY = new Set([82]);            // crosswalk
export const CITY_MEDIUM_PRIORITY = new Set([80, 81, 83]); // sidewalk, road, curb

export const NUM_CLASSES = 80;
export const INPUT_SIZE = 640;
export const CONF_THRESHOLD = 0.45;
export const IOU_THRESHOLD = 0.45;
// "Close" = object height covers more than 35% of frame height
export const CLOSE_THRESHOLD = 0.35;

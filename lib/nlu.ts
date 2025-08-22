// lib/nlu.ts
// Универсальный NLU-классификатор интентов на RU/EN/KK через LLM.
// Возвращает JSON { intent, confidence, slots } и работает с локальным
// фоллбеком, если сеть/ключ недоступны.

export type Intent =
  | 'OPEN_SETTINGS' | 'OPEN_LANGUAGE' | 'OPEN_SPEECH' | 'OPEN_INPUT' | 'OPEN_SUPPORT'
  | 'GO_BACK' | 'ACTIVATE_VOICE_NAV' | 'DEACTIVATE_VOICE_NAV'
  | 'SET_LANGUAGE' | 'SET_INPUT_METHOD' | 'SET_SPEECH_ENABLE' | 'SET_SPEECH_SPEED' | 'SET_WARNING'
  | 'UNKNOWN';

export type Slots = {
  language?: 'ru' | 'en' | 'kk' | null;
  method?: 'voice' | 'keyboard' | null;
  enable?: boolean | null;
  speed?: 'fast' | 'medium' | 'slow' | null;
  warning?: 'voice' | 'vibration' | 'none' | null;
};

export type NluResult = { intent: Intent; confidence: number; slots: Slots };

export const MIN_CONF = 0.55; // минимальная уверенность, с которой применяем действие

const SYSTEM_PROMPT = `You are an intent classifier for a mobile app for blind users.
Understand Russian, English and Kazakh. Reply with ONLY a compact JSON object.
Supported intents and slots:
- OPEN_SETTINGS
- OPEN_LANGUAGE
- OPEN_SPEECH
- OPEN_INPUT
- OPEN_SUPPORT
- GO_BACK
- ACTIVATE_VOICE_NAV
- DEACTIVATE_VOICE_NAV
- SET_LANGUAGE { slots: { language: one of ["ru","en","kk"] } }
- SET_INPUT_METHOD { slots: { method: one of ["voice","keyboard"] } }
- SET_SPEECH_ENABLE { slots: { enable: boolean } }
- SET_SPEECH_SPEED { slots: { speed: one of ["fast","medium","slow"] } }
- SET_WARNING { slots: { warning: one of ["voice","vibration","none"] } }
- UNKNOWN
Return strict JSON: {"intent":"...","confidence":0.0-1.0,"slots":{...}} with lowercase slot values.
Examples: "перейди в настройки языка" -> OPEN_LANGUAGE; "назад" -> GO_BACK;
"включи озвучку" -> SET_SPEECH_ENABLE {enable:true}; "медленная речь" -> SET_SPEECH_SPEED {speed:"slow"};
"выбери казахский" -> SET_LANGUAGE {language:"kk"}; "клавиатура" -> SET_INPUT_METHOD {method:"keyboard"};
If unclear, choose UNKNOWN with low confidence.`;

function localFallback(textRaw: string): NluResult {
  const t = textRaw.toLowerCase();
  const pick = (intent: Intent, confidence = 0.6, slots: Slots = {}) => ({ intent, confidence, slots });

  // простые очевидные правила на случай оффлайна
  if (/\bназад\b|\bback\b/.test(t)) return pick('GO_BACK');
  if (/(настройки языка|language settings|языки\b|\blanguage\b)/.test(t)) return pick('OPEN_LANGUAGE');
  if (/(озвучк|speech|voice|tts)/.test(t)) return pick('OPEN_SPEECH');
  if (/(ввод|клавиатур|input|keyboard|typing)/.test(t)) return pick('OPEN_INPUT');
  if (/(поддержк|help|support)/.test(t)) return pick('OPEN_SUPPORT');
  if (/(активируй .*навигац|аудио навигац|voice nav|audio navigation)/.test(t)) return pick('ACTIVATE_VOICE_NAV');
  if (/(выключи .*навигац|disable .*nav)/.test(t)) return pick('DEACTIVATE_VOICE_NAV');
  if (/(русск|russia|russian)/.test(t)) return pick('SET_LANGUAGE', 0.7, { language: 'ru' });
  if (/(англ|english)/.test(t)) return pick('SET_LANGUAGE', 0.7, { language: 'en' });
  if (/(казах|қазақ|kazakh|qazaq)/.test(t)) return pick('SET_LANGUAGE', 0.7, { language: 'kk' });
  if (/(голос(ом)?|voice|speech)/.test(t)) return pick('SET_INPUT_METHOD', 0.65, { method: 'voice' });
  if (/(клавиатур|keyboard|typing|type)/.test(t)) return pick('SET_INPUT_METHOD', 0.65, { method: 'keyboard' });
  if (/(включи .*озвучк|enable .*speech|turn on .*speech)/.test(t)) return pick('SET_SPEECH_ENABLE', 0.7, { enable: true });
  if (/(выключи .*озвучк|disable .*speech|turn off .*speech)/.test(t)) return pick('SET_SPEECH_ENABLE', 0.7, { enable: false });
  if (/(быстр(ая|о)|fast)/.test(t)) return pick('SET_SPEECH_SPEED', 0.65, { speed: 'fast' });
  if (/(средн(яя|е)|medium)/.test(t)) return pick('SET_SPEECH_SPEED', 0.65, { speed: 'medium' });
  if (/(медл(енная|енно)|slow)/.test(t)) return pick('SET_SPEECH_SPEED', 0.65, { speed: 'slow' });
  if (/(вибрац|vibration|vibrate)/.test(t)) return pick('SET_WARNING', 0.65, { warning: 'vibration' });
  if (/(голос(ов|овые)? предупрежд|voice(\s|-)warn)/.test(t)) return pick('SET_WARNING', 0.65, { warning: 'voice' });
  if (/(ничего|none|no\s+warning)/.test(t)) return pick('SET_WARNING', 0.65, { warning: 'none' });

  return { intent: 'UNKNOWN', confidence: 0, slots: {} };
}

export async function classifyCommandLLM(text: string): Promise<NluResult> {
  const body = {
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: text }
    ],
    temperature: 0,
  } as const;

  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY ?? ''}`,
      },
      body: JSON.stringify(body),
    });

    const data = await resp.json();
    const content = (data?.choices?.[0]?.message?.content || '{}').trim();
    const parsed = JSON.parse(content);
    const result: NluResult = {
      intent: (parsed.intent ?? 'UNKNOWN') as Intent,
      confidence: Number(parsed.confidence ?? 0),
      slots: parsed.slots ?? {},
    };

    // простая валидация
    if (!result.intent) return localFallback(text);
    return result;
  } catch (e) {
    // сеть/ключ/парсинг — используем локальный фоллбек
    return localFallback(text);
  }
}

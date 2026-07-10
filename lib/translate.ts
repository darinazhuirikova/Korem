/**
 * Google Cloud Translation API v2 (Basic).
 * Requires "Cloud Translation API" enabled in GCP for the same key.
 * Free tier: 500 000 chars/month.
 */

const TRANSLATE_KEY = process.env.EXPO_PUBLIC_GOOGLE_KEY ?? '';
const TRANSLATE_URL = 'https://translation.googleapis.com/language/translate/v2';

export type SupportedLang = 'ru' | 'en' | 'kk';

/**
 * Translate text to targetLang. source language is auto-detected.
 * Returns the translated string.
 */
export async function translateText(
  text: string,
  targetLang: SupportedLang
): Promise<string> {
  if (!text.trim()) return text;

  const url = `${TRANSLATE_URL}?key=${TRANSLATE_KEY}`;
  const body = {
    q: text,
    target: targetLang,
    format: 'text',
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Translate API HTTP ${res.status}`);
  const json = await res.json();

  const translated: string =
    json?.data?.translations?.[0]?.translatedText ?? text;
  return translated;
}

/**
 * Detect the language of a given text.
 * Returns ISO 639-1 code (e.g. "ru", "en").
 */
export async function detectLanguage(text: string): Promise<string> {
  if (!text.trim()) return 'und';

  const url = `${TRANSLATE_URL}/detect?key=${TRANSLATE_KEY}`;
  const body = { q: text };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) return 'und';
  const json = await res.json();
  return json?.data?.detections?.[0]?.[0]?.language ?? 'und';
}

/**
 * OCR via Google Cloud Vision API v1 — TEXT_DETECTION feature.
 * Performance: Perf key "ocr_rtt" = round-trip to Vision API.
 * Returns the full recognized text block as a single string.
 * Requires Cloud Vision API enabled in the same GCP project as the key.
 */

import { Perf } from './perf';
import { withTimeout, withRetry } from './errorHandler';

const VISION_KEY = process.env.EXPO_PUBLIC_GOOGLE_KEY ?? '';
const VISION_URL = 'https://vision.googleapis.com/v1/images:annotate';

export type OcrResult = {
  text: string;        // full recognized text
  locale: string;     // detected language (e.g. "ru", "en")
  words: { text: string; confidence: number }[];
};

/** Pass a base64-encoded JPEG/PNG image (no data-URI prefix). */
export async function recognizeText(base64Image: string): Promise<OcrResult> {
  return withRetry(async () => {
  const tOcr = Perf.start();
  const body = {
    requests: [
      {
        image: { content: base64Image },
        features: [{ type: 'TEXT_DETECTION', maxResults: 1 }],
        imageContext: { languageHints: ['ru', 'en', 'kk'] },
      },
    ],
  };

  const res = await withTimeout(
    fetch(`${VISION_URL}?key=${VISION_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    10_000,
  );

  Perf.end('ocr_rtt', tOcr);
  if (!res.ok) throw new Error(`Vision API HTTP ${res.status}`);
  const json = await res.json();

  const annotation = json?.responses?.[0]?.fullTextAnnotation;
  const textAnnotations = json?.responses?.[0]?.textAnnotations ?? [];
  const error = json?.responses?.[0]?.error;
  if (error) throw new Error(error.message ?? 'Vision API error');

  const fullText: string = annotation?.text ?? textAnnotations[0]?.description ?? '';
  const locale: string = annotation?.pages?.[0]?.property?.detectedLanguages?.[0]?.languageCode
    ?? textAnnotations[0]?.locale
    ?? 'und';

  // Individual word confidences from fullTextAnnotation
  const words: { text: string; confidence: number }[] = [];
  for (const page of annotation?.pages ?? []) {
    for (const block of page.blocks ?? []) {
      for (const para of block.paragraphs ?? []) {
        for (const word of para.words ?? []) {
          const wordText = (word.symbols ?? []).map((s: any) => s.text).join('');
          const conf: number = word.confidence ?? 1.0;
          words.push({ text: wordText, confidence: conf });
        }
      }
    }
  }

  return { text: fullText.trim(), locale, words };
  }, 1, 1_000);
}

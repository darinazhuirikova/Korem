/**
 * Unified STT module — cloud-first with local whisper-base fallback.
 *
 * Strategy (per call):
 *   1. Check network (expo-network).
 *   2. Online  → race cloud whisper-1 vs 4 s timeout.
 *               Success → return.  Fail → fall through.
 *   3. Offline → local whisper-base (ggml-base.bin, ~142 MB).
 *               Model not downloaded → throw Error('WHISPER_NOT_DOWNLOADED').
 *
 * Perf keys added here:
 *   stt_path_chosen  — record(0)=cloud, record(1)=local
 *   stt_local_infer  — whisper.cpp inference time (inside transcribeOffline)
 *   stt_local_total  — total local path (network-check + ctx-load + infer)
 *
 * stt_cloud_rtt is recorded inside lib/transcribe.ts (upload + API time).
 */

import * as FileSystem from 'expo-file-system';
import * as Network from 'expo-network';
import { initWhisper, WhisperContext } from 'whisper.rn';
import { Perf } from './perf';
import { transcribeWithOpenAI } from './transcribe';

// ── Config ─────────────────────────────────────────────────────────────────

const CLOUD_TIMEOUT_MS = 4_000;

/** ggml-base (multilingual) — supports ru/en/kk, 142 MB */
const MODEL_URL =
  'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin';
const MODEL_DIR  = `${FileSystem.documentDirectory}whisper/`;
const MODEL_PATH = `${MODEL_DIR}ggml-base.bin`;
// Fallback total when server omits Content-Length
const MODEL_SIZE_APPROX = 148_000_000;

// ── Types ──────────────────────────────────────────────────────────────────

export type DownloadProgress = {
  bytesWritten: number;
  bytesTotal: number;
  /** 0–1 */
  fraction: number;
};

// ── Model state ────────────────────────────────────────────────────────────

let _ctx: WhisperContext | null = null;
let _ctxPromise: Promise<WhisperContext> | null = null;

// ── Model management ───────────────────────────────────────────────────────

/** Returns true if the local ggml-base.bin is present. */
export async function isWhisperModelReady(): Promise<boolean> {
  const info = await FileSystem.getInfoAsync(MODEL_PATH);
  return info.exists;
}

/**
 * Download ggml-base.bin (~142 MB) to app's document directory.
 * Idempotent — returns immediately if already present.
 * Throws on HTTP error or filesystem failure.
 */
export async function downloadWhisperModel(
  onProgress?: (p: DownloadProgress) => void,
): Promise<void> {
  if (await isWhisperModelReady()) return;

  await FileSystem.makeDirectoryAsync(MODEL_DIR, { intermediates: true });

  const dl = FileSystem.createDownloadResumable(
    MODEL_URL,
    MODEL_PATH,
    {},
    ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
      const total =
        totalBytesExpectedToWrite > 0
          ? totalBytesExpectedToWrite
          : MODEL_SIZE_APPROX;
      onProgress?.({
        bytesWritten: totalBytesWritten,
        bytesTotal: total,
        fraction: Math.min(totalBytesWritten / total, 1),
      });
    },
  );

  const res = await dl.downloadAsync();
  if (!res || res.status !== 200) {
    await FileSystem.deleteAsync(MODEL_PATH, { idempotent: true });
    throw new Error(`Model download failed (HTTP ${res?.status ?? 'unknown'})`);
  }
}

/** Lazy-load WhisperContext singleton. Throws 'WHISPER_NOT_DOWNLOADED' if absent. */
async function getCtx(): Promise<WhisperContext> {
  if (_ctx) return _ctx;
  if (_ctxPromise) return _ctxPromise;

  if (!(await isWhisperModelReady())) throw new Error('WHISPER_NOT_DOWNLOADED');

  _ctxPromise = initWhisper({ filePath: MODEL_PATH });
  try {
    _ctx = await _ctxPromise;
    return _ctx;
  } catch (e) {
    _ctxPromise = null;
    throw e;
  }
}

// ── Local transcription ────────────────────────────────────────────────────

async function transcribeOffline(
  uri: string,
  lang: 'ru' | 'en' | 'kk',
): Promise<string> {
  const ctx = await getCtx();
  const t = Perf.start();

  // Kazakh: use 'auto' — whisper-base has limited kk training data;
  // auto-detection outperforms forcing 'kk' for short utterances.
  const { promise } = ctx.transcribe(uri, {
    language: lang === 'kk' ? 'auto' : lang,
    maxLen: 0,
    tokenTimestamps: false,
  });

  const { result } = await promise;
  Perf.end('stt_local_infer', t);

  // Strip leading [timestamp] / (noise) annotations whisper sometimes adds
  return result.replace(/^\s*[\[(][^\])\n]{0,40}[\])]\s*/, '').trim();
}

// ── Unified entry point ────────────────────────────────────────────────────

/**
 * Transcribe audio — drop-in replacement for transcribeWithOpenAI.
 *
 * @param uri        Audio file URI (.m4a produced by expo-av)
 * @param lang       App language, used as hint for local model
 * @param onFallback Called synchronously before local inference begins,
 *                   when the cloud path was skipped or timed out.
 *                   Use it to announce degraded-mode to the user via TTS.
 *
 * @throws Error('WHISPER_NOT_DOWNLOADED')
 *         when offline and ggml-base.bin is not present.
 *         Caller should prompt user to download via downloadWhisperModel().
 */
export async function transcribeAudio(
  uri: string,
  lang: 'ru' | 'en' | 'kk' = 'ru',
  onFallback?: () => void,
): Promise<string> {
  const tLocal = Perf.start();

  // ── 1. Network check ────────────────────────────────────────────────────
  let hasNetwork = false;
  try {
    const state = await Network.getNetworkStateAsync();
    hasNetwork =
      (state.isConnected ?? false) && (state.isInternetReachable !== false);
  } catch {
    // getNetworkStateAsync can throw on some devices; assume connected
    hasNetwork = true;
  }

  // ── 2. Cloud attempt (with timeout) ────────────────────────────────────
  if (hasNetwork) {
    try {
      const text = await Promise.race<string>([
        transcribeWithOpenAI(uri),
        new Promise<never>((_, rej) =>
          setTimeout(
            () => rej(new Error('CLOUD_TIMEOUT')),
            CLOUD_TIMEOUT_MS,
          ),
        ),
      ]);
      Perf.record('stt_path_chosen', 0); // 0 = cloud
      return text;
    } catch {
      // timeout or HTTP error — fall through to local
    }
  }

  // ── 3. Local fallback ───────────────────────────────────────────────────
  Perf.record('stt_path_chosen', 1); // 1 = local
  onFallback?.();
  const text = await transcribeOffline(uri, lang);
  Perf.end('stt_local_total', tLocal);
  return text;
}

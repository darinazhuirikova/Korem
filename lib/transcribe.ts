// app/lib/transcribe.ts
import * as FileSystem from 'expo-file-system';
import { Perf } from './perf';

const PROXY_URL = process.env.EXPO_PUBLIC_WHISPER_URL ?? 'https://6d4a221dbaf8.ngrok-free.app/transcribe';

export async function transcribeWithOpenAI(uri: string): Promise<string> {
  const tStt = Perf.start();
  // отправляем .m4a как multipart (поле "file" должно совпадать с upload.single('file'))
  const res = await FileSystem.uploadAsync(PROXY_URL, uri, {
    httpMethod: 'POST',
    uploadType: FileSystem.FileSystemUploadType.MULTIPART,
    fieldName: 'file',
    headers: { Accept: 'application/json' },
  });

  let data: any = {};
  try { data = JSON.parse(res.body || '{}'); } catch {}

  if (res.status === 200 && data?.text) {
    Perf.end('stt_cloud_rtt', tStt);
    return String(data.text);
  }

  const err = data?.error?.message || data?.error || data?.raw || res.body;
  throw new Error(`Transcription failed: ${err ?? 'unknown error'}`);
}

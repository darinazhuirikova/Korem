// app/lib/transcribe.ts
import * as FileSystem from 'expo-file-system';

// поставь сюда свой публичный адрес сервера (ngrok / хостинг)
const PROXY_URL = 'https://6d4a221dbaf8.ngrok-free.app/transcribe';

export async function transcribeWithOpenAI(uri: string): Promise<string> {
  // отправляем .m4a как multipart (поле "file" должно совпадать с upload.single('file'))
  const res = await FileSystem.uploadAsync(PROXY_URL, uri, {
    httpMethod: 'POST',
    uploadType: FileSystem.FileSystemUploadType.MULTIPART,
    fieldName: 'file',
    headers: { Accept: 'application/json' },
  });

  let data: any = {};
  try { data = JSON.parse(res.body || '{}'); } catch {}

  if (res.status === 200 && data?.text) return String(data.text);

  const err = data?.error?.message || data?.error || data?.raw || res.body;
  throw new Error(`Transcription failed: ${err ?? 'unknown error'}`);
}

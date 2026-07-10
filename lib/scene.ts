import * as ImageManipulator from 'expo-image-manipulator';

const OPENAI_KEY = process.env.EXPO_PUBLIC_OPENAI_KEY ?? '';

const PROMPTS: Record<string, string> = {
  ru: 'Ты помощник для незрячего человека. Кратко опиши что перед ним: объекты, препятствия, возможные пути. 2-3 предложения, без лишних слов.',
  en: 'You are an assistant for a blind person. Briefly describe what is in front of them: objects, obstacles, possible paths. 2-3 sentences.',
  kk: 'Сіз соқыр адамға көмекшісіз. Алдында не тұрғанын қысқаша сипаттаңыз: заттар, кедергілер, жолдар. 2-3 сөйлем.',
};

export async function describeScene(photoUri: string, language = 'ru'): Promise<string> {
  const resized = await ImageManipulator.manipulateAsync(
    photoUri,
    [{ resize: { width: 512 } }],
    { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }
  );

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 120,
      temperature: 0.3,
      messages: [
        { role: 'system', content: PROMPTS[language] ?? PROMPTS['ru'] },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${resized.base64}`,
                detail: 'low',
              },
            },
          ],
        },
      ],
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.message ?? `HTTP ${res.status}`;
    console.error('[Scene API error]', res.status, msg);
    throw new Error(msg);
  }
  return data?.choices?.[0]?.message?.content?.trim() ?? '';
}

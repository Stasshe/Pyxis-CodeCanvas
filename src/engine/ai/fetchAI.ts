// src/utils/ai/geminiClient.ts
const GEMINI_API_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta/models';

export async function generateCodeEdit(prompt: string, apiKey: string, modelId?: string): Promise<string> {
  if (!apiKey) throw new Error('Gemini API key is missing');

  const model = modelId || 'gemini-2.0-flash';
  const apiUrl = `${GEMINI_API_BASE_URL}/${model}:generateContent`;

  try {
    const response = await fetch(`${apiUrl}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1, // より確実な回答のため温度を下げる
          maxOutputTokens: 4096,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    const result = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    console.log('[original response]', result);

    if (!result) {
      throw new Error('No response from Gemini API');
    }

    return result;
  } catch (error) {
    throw new Error('Gemini API error: ' + (error as Error).message);
  }
}

export async function generateChatResponse(
  message: string,
  context: string[],
  apiKey: string,
  modelId?: string
): Promise<string> {
  if (!apiKey) throw new Error('Gemini API key is missing');

  const model = modelId || 'gemini-2.0-flash-exp';
  const apiUrl = `${GEMINI_API_BASE_URL}/${model}:generateContent`;

  const contextText = context.length > 0 ? `\n\n参考コンテキスト:\n${context.join('\n---\n')}` : '';

  const prompt = `${message}${contextText}`;

  try {
    const response = await fetch(`${apiUrl}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 2048,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    const result = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!result) {
      throw new Error('No response from Gemini API');
    }
    console.log('[original response]', result);

    return result;
  } catch (error) {
    throw new Error('Gemini API error: ' + (error as Error).message);
  }
}

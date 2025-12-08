// src/utils/ai/geminiClient.ts
const GEMINI_API_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

// Retry with exponential backoff for rate limit errors
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 3
): Promise<Response> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      
      // 429 (Rate Limit) の場合はリトライ
      if (response.status === 429 && attempt < maxRetries) {
        const waitTime = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
        console.warn(`[Gemini API] Rate limit hit, retrying in ${waitTime}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      
      return response;
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxRetries) {
        const waitTime = Math.pow(2, attempt) * 1000;
        console.warn(`[Gemini API] Request failed, retrying in ${waitTime}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }
  
  throw lastError || new Error('Max retries exceeded');
}

export async function generateCodeEdit(prompt: string, apiKey: string): Promise<string> {
  if (!apiKey) throw new Error('Gemini API key is missing');

  console.log('[generateCodeEdit] API call started');
  
  try {
    const response = await fetchWithRetry(`${GEMINI_API_URL}?key=${apiKey}`, {
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

    console.log('[generateCodeEdit] API response status:', response.status);

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error('Rate limit exceeded. Please wait a moment and try again. (Gemini API free tier: 15 requests/minute)');
      }
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
    console.error('[generateCodeEdit] API error:', error);
    throw new Error('Gemini API error: ' + (error as Error).message);
  }
}

export async function generateChatResponse(
  message: string,
  context: string[],
  apiKey: string
): Promise<string> {
  if (!apiKey) throw new Error('Gemini API key is missing');

  const contextText = context.length > 0 ? `\n\n参考コンテキスト:\n${context.join('\n---\n')}` : '';

  const prompt = `${message}${contextText}`;

  console.log('[generateChatResponse] API call started');

  try {
    const response = await fetchWithRetry(`${GEMINI_API_URL}?key=${apiKey}`, {
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

    console.log('[generateChatResponse] API response status:', response.status);

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error('Rate limit exceeded. Please wait a moment and try again. (Gemini API free tier: 15 requests/minute)');
      }
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
    console.error('[generateChatResponse] API error:', error);
    throw new Error('Gemini API error: ' + (error as Error).message);
  }
}

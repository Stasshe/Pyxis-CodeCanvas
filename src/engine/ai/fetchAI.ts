// src/utils/ai/geminiClient.ts
const GEMINI_STREAM_API_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent';

/**
 * Stream chat response from Gemini API
 * @param message - User message
 * @param context - Context strings
 * @param apiKey - Gemini API key
 * @param onChunk - Callback for each chunk of text
 */
export async function streamChatResponse(
  message: string,
  context: string[],
  apiKey: string,
  onChunk: (chunk: string) => void
): Promise<void> {
  if (!apiKey) throw new Error('Gemini API key is missing');

  const contextText = context.length > 0 ? `\n\n参考コンテキスト:\n${context.join('\n---\n')}` : '';
  const prompt = `${message}${contextText}`;

  try {
    const response = await fetch(`${GEMINI_STREAM_API_URL}?key=${apiKey}&alt=sse`, {
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

    if (!response.body) {
      throw new Error('Response body is null');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) {
              onChunk(text);
            }
          } catch (e) {
            console.warn('[streamChatResponse] Failed to parse chunk:', e);
          }
        }
      }
    }
  } catch (error) {
    throw new Error('Gemini API streaming error: ' + (error as Error).message);
  }
}

/**
 * Stream code edit response from Gemini API
 * @param prompt - Edit prompt
 * @param apiKey - Gemini API key
 * @param onChunk - Callback for each chunk of text
 */
export async function streamCodeEdit(
  prompt: string,
  apiKey: string,
  onChunk: (chunk: string) => void
): Promise<void> {
  if (!apiKey) throw new Error('Gemini API key is missing');

  try {
    const response = await fetch(`${GEMINI_STREAM_API_URL}?key=${apiKey}&alt=sse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 4096,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    if (!response.body) {
      throw new Error('Response body is null');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) {
              onChunk(text);
            }
          } catch (e) {
            console.warn('[streamCodeEdit] Failed to parse chunk:', e);
          }
        }
      }
    }
  } catch (error) {
    throw new Error('Gemini API streaming error: ' + (error as Error).message);
  }
}

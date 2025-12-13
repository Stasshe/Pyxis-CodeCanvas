// src/utils/ai/geminiClient.ts
const GEMINI_STREAM_API_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-live-001:streamGenerateContent';

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
    const response = await fetch(`${GEMINI_STREAM_API_URL}?key=${apiKey}`, {
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
      
      // Split by lines and process complete JSON objects
      const lines = buffer.split('\n');
      
      // Keep the last incomplete line in the buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;

        try {
          const parsed = JSON.parse(trimmedLine);
          const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            onChunk(text);
          }
        } catch (e) {
          // Skip invalid JSON lines
          console.warn('[streamChatResponse] Failed to parse chunk:', trimmedLine.substring(0, 100));
        }
      }
    }

    // Process any remaining buffer
    if (buffer.trim()) {
      try {
        const parsed = JSON.parse(buffer.trim());
        const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          onChunk(text);
        }
      } catch (e) {
        console.warn('[streamChatResponse] Failed to parse final chunk');
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
    const response = await fetch(`${GEMINI_STREAM_API_URL}?key=${apiKey}`, {
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
      
      // Split by lines and process complete JSON objects
      const lines = buffer.split('\n');
      
      // Keep the last incomplete line in the buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;

        try {
          const parsed = JSON.parse(trimmedLine);
          const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            onChunk(text);
          }
        } catch (e) {
          // Skip invalid JSON lines
          console.warn('[streamCodeEdit] Failed to parse chunk:', trimmedLine.substring(0, 100));
        }
      }
    }

    // Process any remaining buffer
    if (buffer.trim()) {
      try {
        const parsed = JSON.parse(buffer.trim());
        const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          onChunk(text);
        }
      } catch (e) {
        console.warn('[streamCodeEdit] Failed to parse final chunk');
      }
    }
  } catch (error) {
    throw new Error('Gemini API streaming error: ' + (error as Error).message);
  }
}

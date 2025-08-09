// Gemini API クライアント（既存のgemini.tsを拡張）

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

export async function generateCommitMessage(diff: string, apiKey: string): Promise<string> {
  if (!apiKey) throw new Error('Gemini API key is missing');

  const prompt = `以下のgit diff内容からコミットメッセージを30字以上で日本語で生成してください。具体的にコードの何を変えたか、どういう処理を変更したかを簡潔に追加してください。\n\n${diff}`;

  try {
    const response = await fetch(
      `${GEMINI_API_URL}?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      }
    );
    const data = await response.json();
    const result = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return result || '';
  } catch (error) {
    throw new Error('Gemini API error: ' + (error as Error).message);
  }
}

export async function generateCodeEdit(prompt: string, apiKey: string): Promise<string> {
  if (!apiKey) throw new Error('Gemini API key is missing');

  try {
    const response = await fetch(
      `${GEMINI_API_URL}?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1, // より確実な回答のため温度を下げる
            maxOutputTokens: 4096,
          }
        })
      }
    );
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    const result = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!result) {
      throw new Error('No response from Gemini API');
    }
    
    return result;
  } catch (error) {
    throw new Error('Gemini API error: ' + (error as Error).message);
  }
}

export async function generateChatResponse(message: string, context: string[], apiKey: string): Promise<string> {
  if (!apiKey) throw new Error('Gemini API key is missing');

  const contextText = context.length > 0 
    ? `\n\n参考コンテキスト:\n${context.join('\n---\n')}`
    : '';

  const prompt = `${message}${contextText}`;

  try {
    const response = await fetch(
      `${GEMINI_API_URL}?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 2048,
          }
        })
      }
    );
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    const result = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!result) {
      throw new Error('No response from Gemini API');
    }
    
    return result;
  } catch (error) {
    throw new Error('Gemini API error: ' + (error as Error).message);
  }
}

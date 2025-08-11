
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

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

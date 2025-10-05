/**
 * 暗号化ユーティリティ
 * Web Crypto APIを使用してトークンを暗号化/復号化
 */

/**
 * ランダムな暗号化キーを生成
 * localStorageに保存してブラウザを閉じても維持
 */
async function getEncryptionKey(): Promise<CryptoKey> {
  // localStorageからキーを取得（既存の場合）
  const storedKey = localStorage.getItem('__pyxis_encryption_key');
  
  if (storedKey) {
    const keyData = JSON.parse(storedKey);
    return await crypto.subtle.importKey(
      'jwk',
      keyData,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
  }

  // 新しいキーを生成
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );

  // localStorageに保存（ブラウザを閉じても維持）
  const exportedKey = await crypto.subtle.exportKey('jwk', key);
  localStorage.setItem('__pyxis_encryption_key', JSON.stringify(exportedKey));

  return key;
}

/**
 * テキストを暗号化
 */
export async function encryptText(text: string): Promise<string> {
  try {
    const key = await getEncryptionKey();
    const iv = crypto.getRandomValues(new Uint8Array(12)); // 初期化ベクトル
    const encoder = new TextEncoder();
    const data = encoder.encode(text);

    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      data
    );

    // IVと暗号化データを結合してBase64エンコード
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), iv.length);

    return btoa(String.fromCharCode(...combined));
  } catch (error) {
    console.error('[Crypto] Encryption failed:', error);
    throw new Error('Failed to encrypt data');
  }
}

/**
 * 暗号化されたテキストを復号化
 */
export async function decryptText(encryptedText: string): Promise<string> {
  try {
    const key = await getEncryptionKey();
    
    // Base64デコード
    const combined = Uint8Array.from(atob(encryptedText), c => c.charCodeAt(0));
    
    // IVと暗号化データを分離
    const iv = combined.slice(0, 12);
    const data = combined.slice(12);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      data
    );

    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  } catch (error) {
    console.error('[Crypto] Decryption failed:', error);
    throw new Error('Failed to decrypt data');
  }
}

/**
 * 暗号化キーをクリア（サインアウト時）
 */
export function clearEncryptionKey(): void {
  localStorage.removeItem('__pyxis_encryption_key');
}

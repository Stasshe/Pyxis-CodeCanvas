/**
 * GitHub Device Flow 認証
 * Client Secret不要、完全クライアントサイドで動作
 * https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow
 */

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface AccessTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

export interface GitHubUser {
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
  id: number;
}

/**
 * Step 1: デバイスコードを取得
 */
export async function requestDeviceCode(clientId: string): Promise<DeviceCodeResponse> {
  const response = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: clientId,
      scope: 'repo user', // リポジトリ操作とユーザー情報
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to request device code: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Step 2: アクセストークンをポーリング取得
 */
export async function pollForAccessToken(
  clientId: string,
  deviceCode: string,
  interval: number,
  onProgress?: (message: string) => void
): Promise<string> {
  const maxAttempts = 60; // 最大10分（10秒間隔 x 60回）
  let attempts = 0;

  while (attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, interval * 1000));
    attempts++;

    if (onProgress) {
      onProgress(`認証待機中... (${attempts}/${maxAttempts})`);
    }

    try {
      const response = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: clientId,
          device_code: deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
      });

      if (!response.ok) {
        throw new Error(`Token request failed: ${response.statusText}`);
      }

      const data = await response.json();

      // エラーハンドリング
      if (data.error) {
        if (data.error === 'authorization_pending') {
          // まだ認証待ち、次のループへ
          continue;
        } else if (data.error === 'slow_down') {
          // レート制限、インターバルを増やす
          interval += 5;
          continue;
        } else if (data.error === 'expired_token') {
          throw new Error('デバイスコードの有効期限が切れました。もう一度お試しください。');
        } else if (data.error === 'access_denied') {
          throw new Error('ユーザーが認証をキャンセルしました。');
        } else {
          throw new Error(`認証エラー: ${data.error_description || data.error}`);
        }
      }

      // 成功
      if (data.access_token) {
        return data.access_token;
      }
    } catch (error) {
      console.error('[Device Flow] Polling error:', error);
      throw error;
    }
  }

  throw new Error('認証がタイムアウトしました。もう一度お試しください。');
}

/**
 * Step 3: ユーザー情報を取得
 */
export async function fetchGitHubUser(accessToken: string): Promise<GitHubUser> {
  const response = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github.v3+json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch user info: ${response.statusText}`);
  }

  const userData = await response.json();

  // メールアドレスを取得（publicでない場合）
  let email = userData.email;
  if (!email) {
    try {
      const emailResponse = await fetch('https://api.github.com/user/emails', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github.v3+json',
        },
      });

      if (emailResponse.ok) {
        const emails = await emailResponse.json();
        const primaryEmail = emails.find((e: any) => e.primary);
        email = primaryEmail?.email || emails[0]?.email || null;
      }
    } catch (error) {
      console.warn('[Device Flow] Failed to fetch email:', error);
    }
  }

  return {
    login: userData.login,
    name: userData.name,
    email,
    avatar_url: userData.avatar_url,
    id: userData.id,
  };
}

/**
 * 完全なDevice Flow認証プロセス
 */
export async function authenticateWithDeviceFlow(
  clientId: string,
  onProgress?: (message: string) => void
): Promise<{ accessToken: string; user: GitHubUser }> {
  // Step 1: デバイスコードを取得
  if (onProgress) onProgress('デバイスコードを取得中...');
  const deviceCodeData = await requestDeviceCode(clientId);

  // Step 2: ユーザーに認証URLを表示
  if (onProgress) {
    onProgress(
      `ブラウザで以下のURLにアクセスし、コードを入力してください:\n${deviceCodeData.verification_uri}\n\nコード: ${deviceCodeData.user_code}`
    );
  }

  // 認証URLを自動的に開く
  window.open(deviceCodeData.verification_uri, '_blank');

  // Step 3: アクセストークンをポーリング
  const accessToken = await pollForAccessToken(
    clientId,
    deviceCodeData.device_code,
    deviceCodeData.interval,
    onProgress
  );

  // Step 4: ユーザー情報を取得
  if (onProgress) onProgress('ユーザー情報を取得中...');
  const user = await fetchGitHubUser(accessToken);

  if (onProgress) onProgress('認証完了！');

  return { accessToken, user };
}

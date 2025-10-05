/**
 * AuthRepository - GitHub認証情報管理
 * LocalStorageにPersonal Access Token (PAT)を暗号化して保存
 */

import { encryptText, decryptText, clearEncryptionKey } from './crypto';

export interface GitHubUser {
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
  id: number;
}

export interface GitHubAuthData {
  accessToken: string;
  user: GitHubUser;
  expiresAt?: number; // タイムスタンプ（将来的なトークン更新用）
  createdAt: number;
}

// 内部ストレージ用の暗号化データ型
interface EncryptedAuthData {
  encryptedToken: string;
  user: GitHubUser;
  expiresAt?: number;
  createdAt: number;
}

export class AuthRepository {
  private dbName = 'PyxisAuth';
  private version = 1;
  private db: IDBDatabase | null = null;
  private static instance: AuthRepository | null = null;

  private constructor() {}

  /**
   * シングルトンインスタンス取得
   */
  static getInstance(): AuthRepository {
    if (!AuthRepository.instance) {
      AuthRepository.instance = new AuthRepository();
    }
    return AuthRepository.instance;
  }

  /**
   * データベース初期化
   */
  async init(): Promise<void> {
    if (this.db) return; // 既に初期化済み

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => {
        console.error('[AuthRepository] Database initialization failed:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log('[AuthRepository] Database initialized successfully');
        resolve();
      };

      request.onupgradeneeded = event => {
        const db = (event.target as IDBOpenDBRequest).result;

        // 認証情報ストア（単一レコードのみ保存）
        if (!db.objectStoreNames.contains('auth')) {
          const store = db.createObjectStore('auth', { keyPath: 'id' });
          console.log('[AuthRepository] Created "auth" object store');
        }
      };
    });
  }

  /**
   * GitHub認証情報を暗号化して保存
   */
  async saveAuth(authData: GitHubAuthData): Promise<void> {
    await this.init();

    try {
      // アクセストークンを暗号化
      const encryptedToken = await encryptText(authData.accessToken);

      return new Promise((resolve, reject) => {
        const transaction = this.db!.transaction(['auth'], 'readwrite');
        const store = transaction.objectStore('auth');
        
        // 暗号化されたトークンと共に保存
        const record: EncryptedAuthData & { id: string } = {
          id: 'github',
          encryptedToken,
          user: authData.user,
          expiresAt: authData.expiresAt,
          createdAt: authData.createdAt,
        };

        const request = store.put(record);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          console.log('[AuthRepository] Auth data saved successfully (encrypted)');
          resolve();
        };
      });
    } catch (error) {
      console.error('[AuthRepository] Failed to encrypt token:', error);
      throw new Error('Failed to save auth data');
    }
  }

  /**
   * GitHub認証情報を取得（復号化）
   */
  async getAuth(): Promise<GitHubAuthData | null> {
    await this.init();

    return new Promise(async (resolve, reject) => {
      const transaction = this.db!.transaction(['auth'], 'readonly');
      const store = transaction.objectStore('auth');
      const request = store.get('github');

      request.onerror = () => reject(request.error);
      request.onsuccess = async () => {
        const result = request.result as (EncryptedAuthData & { id: string }) | undefined;
        if (result) {
          try {
            // トークンを復号化
            const accessToken = await decryptText(result.encryptedToken);
            
            resolve({
              accessToken,
              user: result.user,
              expiresAt: result.expiresAt,
              createdAt: result.createdAt,
            });
          } catch (error) {
            console.error('[AuthRepository] Failed to decrypt token:', error);
            // 復号化失敗時は認証情報をクリア
            await this.clearAuth();
            resolve(null);
          }
        } else {
          resolve(null);
        }
      };
    });
  }

  /**
   * GitHub認証情報を削除（サインアウト）
   */
  async clearAuth(): Promise<void> {
    await this.init();

    // 暗号化キーもクリア
    clearEncryptionKey();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['auth'], 'readwrite');
      const store = transaction.objectStore('auth');
      const request = store.delete('github');

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        console.log('[AuthRepository] Auth data cleared successfully');
        resolve();
      };
    });
  }

  /**
   * 認証状態をチェック
   */
  async isAuthenticated(): Promise<boolean> {
    const auth = await this.getAuth();
    return auth !== null;
  }

  /**
   * アクセストークンを取得
   */
  async getAccessToken(): Promise<string | null> {
    const auth = await this.getAuth();
    return auth?.accessToken || null;
  }

  /**
   * ユーザー情報を取得
   */
  async getUser(): Promise<GitHubUser | null> {
    const auth = await this.getAuth();
    return auth?.user || null;
  }
}

// シングルトンインスタンスをエクスポート
export const authRepository = AuthRepository.getInstance();

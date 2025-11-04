/**
 * pnpm-test
 * 
 */

import React, { useState, useEffect } from 'react';
import type { ExtensionContext, ExtensionActivation } from '../_shared/types';

// カスタムタブコンポーネント
function PnpmTestTabComponent({ tab, isActive }: { tab: any; isActive: boolean }) {
  const [data, setData] = useState((tab as any).data || {});

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        padding: '16px',
        background: '#1e1e1e',
        color: '#d4d4d4',
      }}
    >
      <h2>pnpm-test Tab</h2>
      <p>タブID: {tab.id}</p>
      <p>アクティブ: {isActive ? 'Yes' : 'No'}</p>
      {/* ここにタブのコンテンツを追加 */}
    </div>
  );
}

// サイドバーパネルコンポーネント
function createPnpmTestPanel(context: ExtensionContext) {
  return function PnpmTestPanel({ extensionId, panelId, isActive, state }: any) {
    const [items, setItems] = useState<any[]>([]);

    useEffect(() => {
      if (isActive) {
        // パネルがアクティブになった時の処理
        context.logger?.info('Panel activated');
      }
    }, [isActive]);

    // タブを開く関数
    // Note: id を指定すると、同じ id のタブがあれば再利用されます（TabStore の openTab と同じ挙動）
    const openTab = () => {
      if (context.tabs) {
        const tabId = context.tabs.createTab({
          id: 'main', // extension:pnpm-test:main として識別される
          title: 'pnpm-test',
          activateAfterCreate: true,
        });
        context.logger?.info(`Tab opened: ${tabId}`);
      }
    };

    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          padding: '8px',
          background: '#1e1e1e',
          color: '#d4d4d4',
          overflow: 'auto',
        }}
      >
        <div style={{ marginBottom: '8px', fontWeight: 'bold' }}>
          pnpm-test
        </div>
        
        {/* タブを開くボタン */}
        <button
          onClick={openTab}
          style={{
            width: '100%',
            padding: '8px',
            marginBottom: '8px',
            background: '#007acc',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '12px',
          }}
        >
          Open pnpm-test Tab
        </button>
        
        
        {/* ここにパネルのコンテンツを追加 */}
        <div style={{ fontSize: '12px', color: '#888' }}>
          パネルID: {panelId}
        </div>
      </div>
    );
  };
}

/**
 * 拡張機能のactivate関数
 */
export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  context.logger?.info('pnpm-test activating...');

  // タブタイプを登録
  if (context.tabs) {
    // タブタイプとして登録（pnpm-testというタイプ名で識別される）
    context.tabs.registerTabType(PnpmTestTabComponent);
    context.logger?.info('Tab type "pnpm-test" registered');
    
    
  }

  // サイドバーパネルを登録
  if (context.sidebar) {
    const Panel = createPnpmTestPanel(context);
    
    context.sidebar.createPanel({
      id: 'pnpm-test-panel',
      title: 'pnpm-test',
      icon: 'Package',
      component: Panel,
      order: 50,
    });

    context.sidebar.onPanelActivate('pnpm-test-panel', async (panelId: string) => {
      context.logger?.info(`Panel activated: ${panelId}`);
    });

    context.logger?.info('Sidebar panel registered');
  }

  return {};
}

/**
 * 拡張機能のdeactivate関数
 */
export async function deactivate(): Promise<void> {
  console.log('pnpm-test deactivated');
}

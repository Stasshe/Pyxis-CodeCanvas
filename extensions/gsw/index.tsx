/**
 * awrg
 * wr
 */

import React, { useState, useEffect } from 'react';
import type { ExtensionContext, ExtensionActivation } from '../_shared/types';



// サイドバーパネルコンポーネント
function createGswPanel(context: ExtensionContext) {
  return function GswPanel({ extensionId, panelId, isActive, state }: any) {
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
          id: 'main', // extension:gsw:main として識別される
          title: 'awrg',
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
          awrg
        </div>
        
        
        
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
  context.logger?.info('awrg activating...');



// サイドバーパネルを登録
if (context.sidebar) {
  const Panel = createGswPanel(context);
  
  context.sidebar.createPanel({
    id: 'gsw-panel',
    title: 'awrg',
    icon: 'Package',
    component: Panel,
    order: 50,
  });

  context.sidebar.onPanelActivate('gsw-panel', async (panelId: string) => {
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
  console.log('awrg deactivated');
}

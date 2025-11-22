/**
 * react-preview
 * 
 */

import React, { useState, useEffect } from 'react';
import type { ExtensionContext, ExtensionActivation } from '../_shared/types';

// カスタムタブコンポーネント
function ReactPreviewTabComponent({ tab, isActive }: { tab: any; isActive: boolean }) {
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
      <h2>react-preview Tab</h2>
      <p>タブID: {tab.id}</p>
      <p>アクティブ: {isActive ? 'Yes' : 'No'}</p>
      {/* ここにタブのコンテンツを追加 */}
    </div>
  );
}




/**
 * 拡張機能のactivate関数
 */
export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  context.logger.info('react-preview activating...');

  // タブタイプを登録
  context.tabs.registerTabType(ReactPreviewTabComponent);
  context.logger.info(`Tab type "react-preview" registered`);
  



  return {};
}

/**
 * 拡張機能のdeactivate関数
 */
export async function deactivate(): Promise<void> {
  console.log('react-preview deactivated');
}

/**
 * Test Multi-File Extension Entry Point
 * このエントリーファイルは他のモジュールをimportして使用する
 */

import React, { useState } from 'react';
import { helperFunction, HelperClass, helperConstant } from './helper';
import utils from './utils';
import { add, multiply } from './utils';

import type { ExtensionContext, ExtensionActivation } from '../_shared/types';

/**
 * テストパネルコンポーネント
 */
function TestMultiFilePanel() {
  const [testResults, setTestResults] = useState<any>(null);
  
  const runTests = () => {
    console.log('[test-multi-file] Running tests...');
    
    // helper.tsの関数を使用
    const helperResult = helperFunction();
    console.log('[test-multi-file] Helper function result:', helperResult);
    
    // helper.tsのクラスを使用
    const helperInstance = new HelperClass('Test message');
    const helperMessage = helperInstance.getMessage();
    console.log('[test-multi-file] Helper class result:', helperMessage);
    
    // helper.tsの定数を使用
    console.log('[test-multi-file] Helper constant:', helperConstant);
    
    // utils.tsのdefault exportを使用
    console.log('[test-multi-file] Utils version:', utils.version);
    
    // utils.tsの名前付きexportを使用
    const sum = add(5, 3);
    const product = multiply(5, 3);
    console.log('[test-multi-file] Math results:', { sum, product });
    
    // utils経由でも使用
    const sum2 = utils.add(10, 20);
    console.log('[test-multi-file] Utils.add result:', sum2);
    
    const results = {
      helperResult,
      helperMessage,
      helperConstant,
      utilsVersion: utils.version,
      mathResults: { sum, product, sum2 },
      timestamp: new Date().toISOString()
    };
    
    setTestResults(results);
    console.log('[test-multi-file] All tests completed:', results);
  };
  
  return (
    <div
      style={{
        padding: '16px',
        height: '100%',
        overflow: 'auto',
        backgroundColor: 'var(--vscode-editor-background)',
        color: 'var(--vscode-editor-foreground)'
      }}
    >
      <h2 style={{ marginTop: 0 }}>Multi-File Extension Test</h2>
      <p>このパネルは複数ファイルに渡る拡張機能のテストです。</p>
      <p>
        エントリーファイル(index.tsx)が他のモジュール(helper.ts, utils.ts)をimportして使用しています。
      </p>
      
      <button
        onClick={runTests}
        style={{
          padding: '8px 16px',
          marginTop: '16px',
          backgroundColor: 'var(--vscode-button-background)',
          color: 'var(--vscode-button-foreground)',
          border: 'none',
          borderRadius: '2px',
          cursor: 'pointer',
          fontSize: '14px'
        }}
      >
        テストを実行
      </button>
      
      {testResults && (
        <div
          style={{
            marginTop: '16px',
            padding: '12px',
            backgroundColor: 'var(--vscode-textBlockQuote-background)',
            borderRadius: '4px',
            fontFamily: 'monospace',
            fontSize: '12px'
          }}
        >
          <h3 style={{ marginTop: 0 }}>テスト結果:</h3>
          <div>✅ Helper関数: {testResults.helperResult}</div>
          <div>✅ Helperクラス: {testResults.helperMessage}</div>
          <div>✅ Helper定数: {testResults.helperConstant}</div>
          <div>✅ Utilsバージョン: {testResults.utilsVersion}</div>
          <div>✅ 足し算 (5+3): {testResults.mathResults.sum}</div>
          <div>✅ 掛け算 (5*3): {testResults.mathResults.product}</div>
          <div>✅ Utilsから足し算 (10+20): {testResults.mathResults.sum2}</div>
          <div style={{ marginTop: '8px', opacity: 0.7 }}>
            実行時刻: {testResults.timestamp}
          </div>
        </div>
      )}
    </div>
  );
}

export function activate(context: ExtensionContext): ExtensionActivation {
  console.log('[test-multi-file] Activating extension...');
  console.log('[test-multi-file] Context:', context);

  // サイドバーパネルを登録
  if (context.sidebar) {
    context.sidebar.createPanel({
      id: 'test-multi-file-panel',
      title: 'Multi-File Test',
      icon: 'TestTube',
      component: TestMultiFilePanel,
    });

    context.sidebar.onPanelActivate('test-multi-file-panel', async (panelId: string) => {
      context.logger.info(`Multi-File Test panel activated: ${panelId}`);
    });

    context.logger.info('Multi-File Test sidebar panel registered');
  }

  // UI拡張機能なので、services/commandsは不要
  // テスト用の関数は残しておくが、返却する必要はない
  return {};
}

export function deactivate(): void {
  console.log('[test-multi-file] Deactivating extension...');
}

/**
 * LaTeX Calculator
 * 
 */

import React, { useState, useEffect } from 'react';
import type { ExtensionContext, ExtensionActivation } from '../_shared/types';
import { parseLatex, analyze } from 'latexium';
import * as katex from 'katex';



// サイドバーパネルコンポーネント
function createCalcPanel(context: ExtensionContext) {
  return function CalcPanel({ extensionId, panelId, isActive, state }: any) {
    const [input, setInput] = useState<string>('2^3 + 1');
    const [task, setTask] = useState<'evaluate'|'distribute'|'factor'>('evaluate');
    const [displayMode, setDisplayMode] = useState<boolean>(false);
    const [resultHtml, setResultHtml] = useState<string>('');
    const [steps, setSteps] = useState<string[]>([]);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
      if (isActive) {
        context.logger.info('Panel activated');
      }
    }, [isActive]);

    // カスタムタブを開く関数
    //　レフトサイドバーのものではないことに注意してください。
    // Note: id を指定すると、同じ id のタブがあれば再利用されます（TabStore の openTab と同じ挙動）
    // 詳しくは__shared/types.tsのコメントを参照してください
    // 実装部分は、TabAPIと、TabStoreのcreateTabを参照してください

    const openTab = () => {
      const tabId = context.tabs.createTab({
        id: 'calc:main', // extension-specific stable id
        title: 'LaTeX Calculator',
        activateAfterCreate: true,
      });
      context.logger.info(`Tab opened: ${tabId}`);
    };

    const evaluateInput = () => {
      setError(null);
      setResultHtml('');
      setSteps([]);
      try {
        const parseResult = parseLatex(input);
        const analyzeResult = analyze(parseResult.ast, { task });
        const value = analyzeResult.value ?? '';
        // value is often a LaTeX-style string or numeric string; render with KaTeX
        const html = katex.renderToString(String(value), { throwOnError: false, displayMode });
        setResultHtml(html);
        if (Array.isArray(analyzeResult.steps)) setSteps(analyzeResult.steps as string[]);
      } catch (err: any) {
        setError(err?.message ?? String(err));
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
          LaTeX Calculator
        </div>

        <div style={{ margin: '8px 0' }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <select value={task} onChange={(e) => setTask(e.target.value as any)} style={{ background: '#252526', color: '#d4d4d4', border: '1px solid #333', padding: '6px', borderRadius: 4 }}>
              <option value="evaluate">Evaluate</option>
              <option value="distribute">Distribute (expand)</option>
              <option value="factor">Factor</option>
            </select>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#d4d4d4' }}>
              <input type="checkbox" checked={displayMode} onChange={(e) => setDisplayMode(e.target.checked)} /> display mode
            </label>
          </div>

          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={3}
            style={{ width: '100%', background: '#252526', color: '#d4d4d4', border: '1px solid #333', padding: '8px', borderRadius: 4 }}
          />
          <div style={{ marginTop: 8 }}>
            <button onClick={evaluateInput} style={{ padding: '6px 10px', borderRadius: 4, background: '#0e639c', color: '#fff', border: 'none' }}>
              Run
            </button>
            <button onClick={() => { setInput(''); setResultHtml(''); setSteps([]); setError(null); }} style={{ marginLeft: 8, padding: '6px 10px', borderRadius: 4, background: '#333', color: '#fff', border: 'none' }}>
              Clear
            </button>
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, color: '#9cdcfe', marginBottom: 6 }}>Result</div>
          <div style={{ minHeight: 28 }}>
            {error ? (
              <div style={{ color: '#f48771' }}>{error}</div>
            ) : (
              <div>
                <div style={{ color: '#c5c5c5', fontSize: 12, marginBottom: 6 }}>Raw value</div>
                <div style={{ color: '#e6e6e6', marginBottom: 8 }}>{resultHtml ? '' : ''}</div>
                <div dangerouslySetInnerHTML={{ __html: resultHtml }} />
              </div>
            )}
          </div>
        </div>

        {steps && steps.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, color: '#9cdcfe', marginBottom: 6 }}>Steps</div>
            <ol style={{ paddingLeft: 18, color: '#c5c5c5', fontSize: 12 }}>
              {steps.map((s, i) => (
                <li key={i} style={{ marginBottom: 6 }} dangerouslySetInnerHTML={{ __html: katex.renderToString(String(s), { throwOnError: false, displayMode: false }) }} />
              ))}
            </ol>
          </div>
        )}
        
        
        
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
  context.logger.info('LaTeX Calculator activating...');



  // サイドバーパネルを登録
  // Sidebar API が存在するかどうかをチェックして安全に呼び出します
  const Panel = createCalcPanel(context);

  context.sidebar.createPanel({
    id: 'calc-panel',
    title: 'LaTeX Calculator',
    icon: 'Package',
    component: Panel,
  });

  context.sidebar.onPanelActivate('calc-panel', async (panelId: string) => {
    context.logger.info(`Panel activated: ${panelId}`);
  });

  context.logger.info('Sidebar panel registered');


  return {};
}

/**
 * 拡張機能のdeactivate関数
 */
export async function deactivate(): Promise<void> {
  console.log('LaTeX Calculator deactivated');
}

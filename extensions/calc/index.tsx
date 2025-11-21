/**
 * LaTeX Calculator - 改善版
 * iPad対応、Markdown出力、履歴管理、コマンド対応
 */

import React, { useState, useEffect, useRef } from 'react';
import type { ExtensionContext, ExtensionActivation } from '../_shared/types';
import { parseLatex, analyze } from 'latexium';

// 計算履歴の型
interface CalculationHistory {
  id: string;
  input: string;
  task: 'evaluate' | 'distribute' | 'factor';
  result: string;
  steps: string;
  timestamp: number;
}

// よく使う記号のプリセット
const LATEX_SYMBOLS = [
  { label: 'x²', latex: 'x^{2}' },
  { label: '√', latex: '\\sqrt{}' },
  { label: '∫', latex: '\\int' },
  { label: '∑', latex: '\\sum' },
  { label: 'α', latex: '\\alpha' },
  { label: 'β', latex: '\\beta' },
  { label: '±', latex: '\\pm' },
  { label: '≠', latex: '\\neq' },
  { label: '≤', latex: '\\leq' },
  { label: '≥', latex: '\\geq' },
  { label: '∞', latex: '\\infty' },
  { label: 'π', latex: '\\pi' },
];

// プリセット数式
const PRESETS = [
  { label: '二次方程式', latex: 'ax^{2} + bx + c' },
  { label: '因数分解例', latex: 'x^{2} + 5x + 6' },
  { label: '展開例', latex: '(x+2)(x+3)' },
  { label: '三次式', latex: 'x^{3} + 2x^{2} - 3x' },
];

// サイドバーパネルコンポーネント
function createCalcPanel(context: ExtensionContext) {
  return function CalcPanel({ extensionId, panelId, isActive }: any) {
    const [input, setInput] = useState<string>('x^{2} + 5x + 6');
    const [task, setTask] = useState<'evaluate' | 'distribute' | 'factor'>('factor');
    const [result, setResult] = useState<string>('');
    const [stepsMarkdown, setStepsMarkdown] = useState<string>('');
    const [error, setError] = useState<string | null>(null);
    const [history, setHistory] = useState<CalculationHistory[]>([]);
    const [showHistory, setShowHistory] = useState(false);
    const [showSymbols, setShowSymbols] = useState(false);
    const [showMdDebug, setShowMdDebug] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // 履歴を読み込み
    useEffect(() => {
      const stored = localStorage.getItem('latexium-history');
      if (stored) {
        try {
          setHistory(JSON.parse(stored));
        } catch (e) {
          console.error('Failed to load history', e);
        }
      }
    }, []);

    // 履歴を保存
    const saveHistory = (item: CalculationHistory) => {
      const newHistory = [item, ...history].slice(0, 50); // 最新50件まで
      setHistory(newHistory);
      localStorage.setItem('latexium-history', JSON.stringify(newHistory));
    };

    // 計算実行（非同期化して parseLatex/analyze を await）
    const evaluateInput = async () => {
      setError(null);
      setResult('');
      setStepsMarkdown('');

      try {
        const parseResult = await parseLatex(input);
        const analyzeResult = await analyze(parseResult.ast, { task });
        const value = String(analyzeResult.value || '');

        // 結果はLatex文字列のまま
        setResult(value);
        setStepsMarkdown(JSON.stringify(analyzeResult.steps));

        // 履歴に保存
        saveHistory({
          id: Date.now().toString(),
          input,
          task,
          result: value,
          steps: JSON.stringify(analyzeResult.steps),
          timestamp: Date.now(),
        });
      } catch (err: any) {
        setError(err?.message ?? String(err));
      }
    };

    // 記号挿入
    const insertSymbol = (latex: string) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newValue = input.slice(0, start) + latex + input.slice(end);
      setInput(newValue);

      // カーソル位置を調整
      setTimeout(() => {
        textarea.focus();
        const newPos = start + latex.length;
        textarea.setSelectionRange(newPos, newPos);
      }, 0);
    };

    // プリセット挿入
    const insertPreset = (latex: string) => {
      setInput(latex);
      textareaRef.current?.focus();
    };

    // 履歴から復元
    const restoreFromHistory = (item: CalculationHistory) => {
      setInput(item.input);
      setTask(item.task);
      setResult(item.result);
      setStepsMarkdown(item.steps);
      setShowHistory(false);
    };

    useEffect(() => {
      if (stepsMarkdown) {
        console.debug('CalcPanel stepsMarkdown changed:', stepsMarkdown);
      }
    }, [stepsMarkdown]);

    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          padding: '12px',
          background: '#1e1e1e',
          color: '#d4d4d4',
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        {/* ヘッダー */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 'bold', fontSize: '16px' }}>LaTeX Calculator</div>
          <button
            onClick={() => setShowHistory(!showHistory)}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              background: '#333',
              color: '#fff',
              border: 'none',
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            {showHistory ? '入力に戻る' : '履歴'}
          </button>
        </div>

        {/* 履歴表示 */}
        {showHistory ? (
          <div style={{ flex: 1, overflow: 'auto' }}>
            {history.length === 0 ? (
              <div style={{ color: '#888', padding: '20px', textAlign: 'center' }}>
                履歴がありません
              </div>
            ) : (
              history.map((item) => (
                <div
                  key={item.id}
                  onClick={() => restoreFromHistory(item)}
                  style={{
                    padding: '12px',
                    marginBottom: '8px',
                    background: '#252526',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    border: '1px solid #333',
                  }}
                >
                  <div style={{ fontSize: '12px', color: '#888', marginBottom: '4px' }}>
                    {new Date(item.timestamp).toLocaleString()} - {item.task}
                  </div>
                  <div style={{ fontFamily: 'monospace', fontSize: '14px' }}>{item.input}</div>
                  <div style={{ fontSize: '12px', color: '#4ade80', marginTop: '4px' }}>
                    → {item.result}
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          <>
            {/* タスク選択 */}
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {(['evaluate', 'distribute', 'factor'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTask(t)}
                  style={{
                    flex: 1,
                    minWidth: '80px',
                    padding: '10px',
                    borderRadius: '6px',
                    background: task === t ? '#0e639c' : '#333',
                    color: '#fff',
                    border: 'none',
                    fontSize: '14px',
                    cursor: 'pointer',
                    fontWeight: task === t ? 'bold' : 'normal',
                  }}
                >
                  {t === 'evaluate' ? '計算' : t === 'distribute' ? '展開' : '因数分解'}
                </button>
              ))}
            </div>

            {/* プリセット */}
            <div>
              <div style={{ fontSize: '12px', color: '#888', marginBottom: '6px' }}>
                プリセット
              </div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => insertPreset(preset.latex)}
                    style={{
                      padding: '6px 10px',
                      borderRadius: '4px',
                      background: '#252526',
                      color: '#9cdcfe',
                      border: '1px solid #333',
                      fontSize: '12px',
                      cursor: 'pointer',
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 記号パレット */}
            <div>
              <button
                onClick={() => setShowSymbols(!showSymbols)}
                style={{
                  padding: '6px 10px',
                  borderRadius: '4px',
                  background: '#252526',
                  color: '#d4d4d4',
                  border: '1px solid #333',
                  fontSize: '12px',
                  cursor: 'pointer',
                  marginBottom: '6px',
                }}
              >
                {showSymbols ? '記号を隠す' : '記号を表示'}
              </button>
              {showSymbols && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '6px' }}>
                  {LATEX_SYMBOLS.map((sym) => (
                    <button
                      key={sym.label}
                      onClick={() => insertSymbol(sym.latex)}
                      style={{
                        padding: '12px',
                        borderRadius: '6px',
                        background: '#252526',
                        color: '#d4d4d4',
                        border: '1px solid #333',
                        fontSize: '16px',
                        cursor: 'pointer',
                        minHeight: '48px',
                      }}
                    >
                      {sym.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 入力エリア */}
            <div>
              <div style={{ fontSize: '12px', color: '#888', marginBottom: '6px' }}>
                LaTeX入力
              </div>
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                rows={4}
                style={{
                  width: '100%',
                  background: '#252526',
                  color: '#d4d4d4',
                  border: '1px solid #333',
                  padding: '12px',
                  borderRadius: '6px',
                  fontFamily: 'monospace',
                  fontSize: '14px',
                  resize: 'vertical',
                }}
                placeholder="例: x^{2} + 5x + 6"
              />
            </div>

            {/* 実行ボタン */}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={evaluateInput}
                style={{
                  flex: 1,
                  padding: '14px',
                  borderRadius: '6px',
                  background: '#0e639c',
                  color: '#fff',
                  border: 'none',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                }}
              >
                実行
              </button>
              <button
                onClick={() => {
                  setInput('');
                  setResult('');
                  setStepsMarkdown('');
                  setError(null);
                }}
                style={{
                  padding: '14px',
                  borderRadius: '6px',
                  background: '#333',
                  color: '#fff',
                  border: 'none',
                  fontSize: '14px',
                  cursor: 'pointer',
                }}
              >
                クリア
              </button>
            </div>

            {/* エラー表示 */}
            {error && (
              <div
                style={{
                  padding: '12px',
                  background: '#3d1f1f',
                  border: '1px solid #f48771',
                  borderRadius: '6px',
                  color: '#f48771',
                  fontSize: '14px',
                }}
              >
                {error}
              </div>
            )}

            {/* 結果表示 */}
            {result && (
              <div>
                <div style={{ fontSize: '12px', color: '#9cdcfe', marginBottom: '6px' }}>
                  結果（LaTeX）
                </div>
                <div
                  style={{
                    padding: '12px',
                    background: '#252526',
                    border: '1px solid #333',
                    borderRadius: '6px',
                    fontFamily: 'monospace',
                    fontSize: '14px',
                    wordBreak: 'break-all',
                    userSelect: 'all',
                  }}
                >
                  $${result}$$
                </div>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(`$$${result}$$`);
                  }}
                  style={{
                    marginTop: '6px',
                    padding: '6px 10px',
                    borderRadius: '4px',
                    background: '#0e639c',
                    color: '#fff',
                    border: 'none',
                    fontSize: '12px',
                    cursor: 'pointer',
                  }}
                >
                  コピー
                </button>
              </div>
            )}

            {/* Steps表示（Markdown） */}
            {stepsMarkdown && (
              <div>
                <div style={{ fontSize: '12px', color: '#9cdcfe', marginBottom: '6px' }}>
                  計算ステップ（Markdown）
                </div>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <div style={{ fontSize: '12px', color: '#9cdcfe' }}>計算ステップ（Markdown）</div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        onClick={() => setShowMdDebug((s) => !s)}
                        style={{ padding: '6px 10px', borderRadius: '4px', background: '#252526', color: '#d4d4d4', border: '1px solid #333', fontSize: '12px', cursor: 'pointer' }}
                      >
                        {showMdDebug ? 'Hide MD Debug' : 'Show MD Debug'}
                      </button>
                    </div>
                  </div>

                  <div
                    style={{
                      padding: '12px',
                      background: '#252526',
                      border: '1px solid #333',
                      borderRadius: '6px',
                      fontSize: '14px',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      maxHeight: '300px',
                      overflow: 'auto',
                    }}
                  >
                    {(() => {
                      // Prefer host-provided markdown/math libs (injected by ExtensionManager)
                      const hostMd =
                        typeof window !== 'undefined' && (window as any).__PYXIS_MARKDOWN__
                          ? (window as any).__PYXIS_MARKDOWN__
                          : null;

                      const ReactMarkdownComp = hostMd?.ReactMarkdown;
                      const remarkPlugins = [hostMd?.remarkGfm, hostMd?.remarkMath].filter(Boolean);
                      const rehypePlugins = [hostMd?.rehypeKatex].filter(Boolean);

                      if (ReactMarkdownComp) {
                        const Comp = ReactMarkdownComp;
                        return (
                          <Comp
                            key={String(stepsMarkdown?.length ?? 0) + (showMdDebug ? '-dbg' : '')}
                            remarkPlugins={remarkPlugins}
                            rehypePlugins={rehypePlugins}
                          >
                            {stepsMarkdown}
                          </Comp>
                        );
                      }

                      // Fallback: plain preformatted text when host libs are not available
                      return <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{stepsMarkdown}</pre>;
                    })()}

                    {showMdDebug && (
                      <div style={{ marginTop: '12px', padding: '8px', background: '#1f1f1f', borderRadius: '6px', border: '1px dashed #333' }}>
                        <div style={{ fontSize: '12px', color: '#9cdcfe', marginBottom: '6px' }}>Raw Markdown</div>
                        <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '12px' }}>{stepsMarkdown}</pre>

                        <div style={{ fontSize: '12px', color: '#9cdcfe', marginTop: '8px' }}>Plugins</div>
                        <pre style={{ margin: 0, fontSize: '12px' }}>{JSON.stringify({ remarkPlugins: ['gfm', 'math'], rehypePlugins: ['katex'] }, null, 2)}</pre>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
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
  const Panel = createCalcPanel(context);
  context.sidebar.createPanel({
    id: 'calc-panel',
    title: 'LaTeX Calc',
    icon: 'Calculator',
    component: Panel,
  });

  // latexiumコマンドを登録
  context.commands.registerCommand('latexium', async (args, ctx) => {
    if (args.length === 0) {
      return `Usage: latexium "<expression>" [--task=evaluate|distribute|factor]

Examples:
  latexium "x^{2} + 5x + 6" --task=factor
  latexium "(x+2)(x+3)" --task=distribute
  latexium "2^3 + 1" --task=evaluate

Options:
  --task=<task>  Task to perform (default: evaluate)`;
    }

    const expression = args[0];
    let task: 'evaluate' | 'distribute' | 'factor' = 'evaluate';

    // --task=xxx オプションを解析
    const taskArg = args.find((arg) => arg.startsWith('--task='));
    if (taskArg) {
      const t = taskArg.split('=')[1] as 'evaluate' | 'distribute' | 'factor';
      if (['evaluate', 'distribute', 'factor'].includes(t)) {
        task = t;
      }
    }

    try {
      const parseResult = await parseLatex(expression);
      const analyzeResult = await analyze(parseResult.ast, { task });
      const value = String(analyzeResult.value || '');

      // CLI出力はユーザー指定のフォーマット
      const resultLabel = task === 'factor' ? 'Factor Result' : 'Result';
      const stepsJson = JSON.stringify(analyzeResult.steps || [], null, 2);
      const output = `${resultLabel}: ${value}\n\nSteps (JSON):\n${stepsJson}`;

      return output;
    } catch (err: any) {
      return `Error: ${err?.message ?? String(err)}`;
    }
  });

  context.logger.info('LaTeX Calculator activated');
  return {};
}

/**
 * 拡張機能のdeactivate関数
 */
export async function deactivate(): Promise<void> {
  console.log('LaTeX Calculator deactivated');
}

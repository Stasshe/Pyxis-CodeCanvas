import clsx from 'clsx';
import { Play, Square, Code, Trash2 } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

import OperationWindow from '@/components/OperationWindow';
import { LOCALSTORAGE_KEY } from '@/context/config';
import { useTranslation } from '@/context/I18nContext';
import { useTheme } from '@/context/ThemeContext';
import { parseGitignore, isPathIgnored } from '@/engine/core/gitignore';
import { initPyodide, runPythonWithSync, setCurrentProject } from '@/engine/runtime/pyodideRuntime';
import { runtimeRegistry } from '@/engine/runtime/RuntimeRegistry';

interface RunPanelProps {
  currentProject: { id: string; name: string } | null;
  files: any[];
}

interface OutputEntry {
  id: string;
  content: string;
  type: 'log' | 'error' | 'input';
  timestamp: Date;
}

export default function RunPanel({ currentProject, files }: RunPanelProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [isRunning, setIsRunning] = useState(false);
  const [output, setOutput] = useState<OutputEntry[]>([]);
  const [inputCode, setInputCode] = useState('');
  const [selectedFile, setSelectedFile] = useState<string>('');
  const [isPyodideReady, setIsPyodideReady] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);

  // Pyodideプロジェクト設定
  useEffect(() => {
    if (currentProject) {
      setCurrentProject(currentProject.id, currentProject.name).then(() => {
        setIsPyodideReady(true);
      });
    }
  }, [currentProject]);

  // 出力エリアの自動スクロール
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  // 拡張子で自動判別: 登録されているすべてのランタイムの実行可能ファイルを取得
  const getExecutableFiles = () => {
    // RuntimeRegistryから動的に対応拡張子を取得
    const allRuntimes = runtimeRegistry.getAllRuntimes();
    const supportedExtensions: string[] = [];
    const extensionToLang: Map<string, string> = new Map();
    
    // Node.jsは特別扱い（ビルトイン）
    const nodeExts = ['.js', '.ts', '.mjs', '.cjs'];
    nodeExts.forEach(ext => {
      supportedExtensions.push(ext);
      extensionToLang.set(ext, 'node');
    });
    
    // 登録済みランタイムの拡張子を追加
    allRuntimes.forEach(runtime => {
      runtime.supportedExtensions.forEach(ext => {
        if (!supportedExtensions.includes(ext)) {
          supportedExtensions.push(ext);
          extensionToLang.set(ext, runtime.id);
        }
      });
    });

    const flattenFiles = (items: any[], parentPath = ''): any[] => {
      return items.reduce((acc, item) => {
        const fullPath = parentPath ? `${parentPath}/${item.name}` : item.name;
        if (item.type === 'file') {
          // Check if file has supported extension
          const matchedExt = supportedExtensions.find(ext => item.name.endsWith(ext));
          if (matchedExt) {
            const lang = extensionToLang.get(matchedExt) || 'unknown';
            acc.push({
              ...item,
              path: fullPath,
              uniqueKey: `${fullPath}-${item.id || Math.random().toString(36).substr(2, 9)}`,
              lang,
            });
          }
        }
        if (item.children) {
          acc.push(...flattenFiles(item.children, fullPath));
        }
        return acc;
      }, []);
    };

    // .gitignore をプロジェクトツリーから探してパースする
    const findGitignoreContent = (items: any[], parentPath = ''): string | null => {
      for (const item of items) {
        const fullPath = parentPath ? `${parentPath}/${item.name}` : item.name;
        if (item.type === 'file' && item.name === '.gitignore') {
          return item.content ?? null;
        }
        if (item.children) {
          const found = findGitignoreContent(item.children, fullPath);
          if (found) return found;
        }
      }
      return null;
    };

    const gitignoreContent = findGitignoreContent(files);
    const gitignoreRules = gitignoreContent ? parseGitignore(gitignoreContent) : null;

    const all = flattenFiles(files);
    if (!gitignoreRules) return all;

    // ルールに従って除外
    return all.filter(f => {
      try {
        return !isPathIgnored(gitignoreRules, f.path, false);
      } catch (e) {
        return true;
      }
    });
  };

  // OperationWindowによるファイル選択モーダル
  const [isOperationOpen, setIsOperationOpen] = useState(false);
  const executableFiles = getExecutableFiles();

  // OperationWindow に渡すための木構造ではないフラットなfile items
  const projectFilesForOperation = executableFiles.map(f => ({
    id: f.id || f.uniqueKey || f.path,
    name: f.name,
    path: f.path,
    content: f.content,
    type: 'file' as const,
  }));

  // 初期化時にlocalStorageから復元
  useEffect(() => {
    const last = localStorage.getItem(LOCALSTORAGE_KEY.LAST_EXECUTE_FILE);
    if (last && executableFiles.some(f => f.path === last)) {
      setSelectedFile(last);
    }
  }, [currentProject, files.length]);

  // 出力を追加
  const addOutput = (content: string, type: 'log' | 'error' | 'input') => {
    setOutput(prev => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        content,
        type,
        timestamp: new Date(),
      },
    ]);
  };

  // デバッグコンソールを作成
  const createDebugConsole = () => ({
    log: (...args: unknown[]) => {
      const content = args
        .map(arg => (typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)))
        .join(' ');
      addOutput(content, 'log');
    },
    error: (...args: unknown[]) => {
      const content = args
        .map(arg => (typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)))
        .join(' ');
      addOutput(content, 'error');
    },
    warn: (...args: unknown[]) => {
      const content = args
        .map(arg => (typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)))
        .join(' ');
      addOutput(content, 'log');
    },
    clear: () => {
      setOutput([]);
    },
  });

  // 入力コールバックを作成（readline用 - DebugConsoleAPI使用）
  const createOnInput = () => {
    return (prompt: string, callback: (input: string) => void) => {
      // DebugConsoleAPIを使って入力を受け取る
      const { DebugConsoleAPI } = require('@/components/Bottom/DebugConsoleAPI');

      // プロンプトを表示
      addOutput(prompt, 'log');
      DebugConsoleAPI.write(prompt);

      // DebugConsoleからの入力を待つ
      const unsubscribe = DebugConsoleAPI.onInput((input: string) => {
        unsubscribe();
        addOutput(input, 'input');
        callback(input);
      });
    };
  };

  // コードを実行（自動判別: .pyならPython, それ以外はNode.js）
  const executeCode = async () => {
    if (!inputCode.trim() || !currentProject) return;
    setIsRunning(true);
    addOutput(`> ${inputCode}`, 'input');
    try {
      // 入力欄の先頭行に#!pythonがあればPython、それ以外はNode.js
      const isPython =
        inputCode.trimStart().startsWith('#!python') ||
        inputCode.trimStart().startsWith('import ') ||
        inputCode.trimStart().startsWith('print(');

      if (isPython) {
        if (!isPyodideReady) {
          addOutput(t('run.runtimeNotReady'), 'error');
          return;
        }
        const pyodide = await initPyodide();
        const cleanCode = inputCode.replace(/^#!python\s*/, '');
        const pythonResult = await pyodide.runPythonAsync(cleanCode);
        addOutput(String(pythonResult), 'log');
      } else {
        // Node.js実行 - RuntimeRegistryを使用
        const runtime = runtimeRegistry.getRuntime('nodejs');
        if (!runtime) {
          addOutput('Node.js runtime not available', 'error');
          return;
        }
        
        const result = await runtime.executeCode?.(inputCode, {
          projectId: currentProject.id,
          projectName: currentProject.name,
          filePath: '/temp-code.js',
          debugConsole: createDebugConsole(),
          onInput: createOnInput(),
        });

        if (result?.stderr) {
          addOutput(result.stderr, 'error');
        }
      }
    } catch (error) {
      addOutput(`Error: ${(error as Error).message}`, 'error');
    } finally {
      setIsRunning(false);
      setInputCode('');
    }
  };

  // ファイルを実行（拡張子で自動判別）
  const executeFile = async () => {
    if (!selectedFile || !currentProject) return;
    setIsRunning(true);
    const filePath = `/${selectedFile}`;
    
    // RuntimeRegistryからランタイムを取得
    const runtime = runtimeRegistry.getRuntimeForFile(filePath);
    
    if (!runtime) {
      addOutput(`No runtime found for ${selectedFile}`, 'error');
      setIsRunning(false);
      return;
    }

    addOutput(`> ${runtime.name} ${selectedFile}`, 'input');
    localStorage.setItem(LOCALSTORAGE_KEY.LAST_EXECUTE_FILE, selectedFile);
    
    try {
      const result = await runtime.execute({
        projectId: currentProject.id,
        projectName: currentProject.name,
        filePath,
        debugConsole: createDebugConsole(),
        onInput: createOnInput(),
      });

      if (result.stderr) {
        addOutput(result.stderr, 'error');
      } else if (result.stdout) {
        addOutput(result.stdout, 'log');
      }
      // Don't show "no output" message - if there's no output, show nothing
    } catch (error) {
      addOutput(`Error: ${(error as Error).message}`, 'error');
    } finally {
      setIsRunning(false);
    }
  };

  // 実行を停止
  const stopExecution = () => {
    setIsRunning(false);
    addOutput(t('run.executionStopped'), 'log');
  };

  // 出力をクリア
  const clearOutput = () => {
    setOutput([]);
  };

  if (!currentProject) {
    return (
      <div
        className="h-full flex items-center justify-center"
        style={{ color: colors.mutedFg }}
      >
        <div className="text-center">
          <Code
            size={48}
            style={{ margin: '0 auto 1rem', color: colors.mutedFg }}
          />
          <p>{t('run.noProject')}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="h-full flex flex-col"
      style={{ background: colors.background }}
    >
      {/* ヘッダー */}
      <div
        className="border-b p-3"
        style={{ borderBottom: `1px solid ${colors.border}` }}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Code
              size={16}
              style={{ color: colors.primary }}
            />
            <span
              className="font-semibold"
              style={{ color: colors.foreground }}
            >
              {t('run.title')}
            </span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={clearOutput}
              className="p-1.5 hover:bg-accent rounded"
              style={{ color: colors.mutedFg }}
              title={t('run.clearOutput')}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        {/* ファイル実行セクション（OperationWindowを使う） */}
        {executableFiles.length > 0 && (
          <div className="flex gap-2 mb-3 items-center">
            <div className="flex-1">
              <button
                onClick={() => setIsOperationOpen(true)}
                className="w-full text-left px-3 py-1 border rounded text-sm"
                style={{
                  background: colors.background,
                  color: colors.foreground,
                  border: `1px solid ${colors.border}`,
                }}
              >
                {selectedFile ? selectedFile : t('run.selectFile')}
              </button>
            </div>
            <button
              onClick={executeFile}
              disabled={!selectedFile || isRunning}
              className={clsx('px-3 py-1 rounded text-sm flex items-center gap-1')}
              style={{
                background: selectedFile && !isRunning ? colors.primary : colors.mutedBg,
                color: selectedFile && !isRunning ? colors.background : colors.mutedFg,
                cursor: selectedFile && !isRunning ? 'pointer' : 'not-allowed',
              }}
            >
              <Play size={12} />
              {t('run.execute')}
            </button>
          </div>
        )}
      </div>

      {/* 出力エリア */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div
          ref={outputRef}
          className="flex-1 p-3 overflow-y-auto font-mono text-sm"
          style={{ background: colors.background, color: colors.foreground }}
        >
          {output.length === 0 ? (
            <div style={{ color: colors.mutedFg }}>{t('run.outputHint')}</div>
          ) : (
            output.map(entry => (
              <div
                key={entry.id}
                className={clsx(
                  'mb-1 whitespace-pre-wrap',
                  entry.type === 'input' && 'font-semibold'
                )}
                style={{
                  color:
                    entry.type === 'error'
                      ? colors.red
                      : entry.type === 'input'
                        ? colors.primary
                        : colors.foreground,
                }}
              >
                {entry.content}
              </div>
            ))
          )}
        </div>

        {/* 入力エリア */}
        <div
          className="border-t p-3"
          style={{ borderTop: `1px solid ${colors.border}` }}
        >
          <div className="flex gap-2">
            <textarea
              value={inputCode}
              onChange={e => setInputCode(e.target.value)}
              placeholder={t('run.inputPlaceholder')}
              className="flex-1 px-3 py-2 border rounded font-mono text-sm resize-none"
              style={{
                background: colors.background,
                color: colors.foreground,
                border: `1px solid ${colors.border}`,
              }}
              rows={3}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  executeCode();
                }
              }}
            />
            <div className="flex flex-col gap-2">
              <button
                onClick={executeCode}
                disabled={!inputCode.trim() || isRunning}
                className={clsx('px-4 py-2 rounded flex items-center gap-2')}
                style={{
                  background: inputCode.trim() && !isRunning ? colors.primary : colors.mutedBg,
                  color: inputCode.trim() && !isRunning ? colors.background : colors.mutedFg,
                  cursor: inputCode.trim() && !isRunning ? 'pointer' : 'not-allowed',
                }}
              >
                <Play size={14} />
                {t('run.execute')}
              </button>
              {isRunning && (
                <button
                  onClick={stopExecution}
                  className="px-4 py-2 rounded flex items-center gap-2"
                  style={{ background: colors.red, color: 'white' }}
                >
                  <Square size={14} />
                  {t('run.stop')}
                </button>
              )}
            </div>
          </div>
          <div
            className="text-xs mt-2"
            style={{ color: colors.mutedFg }}
          >
            {t('run.executeHint')}
          </div>
        </div>
      </div>
      {isOperationOpen && (
        <OperationWindow
          isVisible={isOperationOpen}
          onClose={() => setIsOperationOpen(false)}
          projectFiles={projectFilesForOperation}
          onFileSelect={(file: any, preview?: boolean) => {
            const path = file?.path ?? file?.name;
            if (path) {
              setSelectedFile(path);
              localStorage.setItem(LOCALSTORAGE_KEY.LAST_EXECUTE_FILE, path);
            }
            setIsOperationOpen(false);
          }}
          initialView="files"
        />
      )}
    </div>
  );
}

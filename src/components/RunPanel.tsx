import { useState, useRef, useEffect } from 'react';
import { Play, Square, FileText, Code, Settings, Trash2 } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import clsx from 'clsx';
import { NodeJSRuntime } from '../utils/nodeRuntime';

interface RunPanelProps {
  currentProject: string | null;
  files: any[];
  onFileOperation?: (path: string, type: 'file' | 'folder' | 'delete', content?: string, isNodeRuntime?: boolean) => Promise<void>;
}

interface OutputEntry {
  id: string;
  content: string;
  type: 'log' | 'error' | 'input';
  timestamp: Date;
}

export default function RunPanel({ currentProject, files, onFileOperation }: RunPanelProps) {
  const { colors } = useTheme();
  const [isRunning, setIsRunning] = useState(false);
  const [output, setOutput] = useState<OutputEntry[]>([]);
  const [inputCode, setInputCode] = useState('');
  const [selectedFile, setSelectedFile] = useState<string>('');
  const [runtime, setRuntime] = useState<NodeJSRuntime | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);

  // ランタイムの初期化
  useEffect(() => {
    if (currentProject) {
      const newRuntime = new NodeJSRuntime(
        currentProject,
        (output, type) => {
          addOutput(output, type);
        },
        onFileOperation
      );
      setRuntime(newRuntime);
    }
  }, [currentProject, onFileOperation]);

  // 出力エリアの自動スクロール
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  // 実行可能なファイルを取得（.js, .ts, .mjs ファイル、node_modules除外）
  const getExecutableFiles = () => {
    const executableExtensions = ['.js', '.ts', '.mjs', '.cjs'];
    const flattenFiles = (items: any[], parentPath = ''): any[] => {
      return items.reduce((acc, item) => {
        const fullPath = parentPath ? `${parentPath}/${item.name}` : item.name;
        // node_modules配下は除外
        if (fullPath.startsWith('node_modules/')) return acc;
        if (item.type === 'file' && executableExtensions.some(ext => item.name.endsWith(ext))) {
          acc.push({
            ...item,
            path: fullPath,
            uniqueKey: `${fullPath}-${item.id || Math.random().toString(36).substr(2, 9)}`
          });
        }
        if (item.children) {
          acc.push(...flattenFiles(item.children, fullPath));
        }
        return acc;
      }, []);
    };
    return flattenFiles(files);
  };

  // ファイル名サーチ用
  const [fileSearch, setFileSearch] = useState('');
  const [fileSuggestOpen, setFileSuggestOpen] = useState(false);
  const executableFiles = getExecutableFiles();
  const filteredFiles = fileSearch
    ? executableFiles.filter(f => f.path.toLowerCase().includes(fileSearch.toLowerCase()))
    : executableFiles;

  // localStorageキー
  const LS_KEY = 'pyxis_last_executed_file';

  // 初期化時にlocalStorageから復元
  useEffect(() => {
    const last = localStorage.getItem(LS_KEY);
    if (last && executableFiles.some(f => f.path === last)) {
      setSelectedFile(last);
      setFileSearch(last);
    }
  }, [currentProject, files.length]);

  // 出力を追加
  const addOutput = (content: string, type: 'log' | 'error' | 'input') => {
    setOutput(prev => [...prev, {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      content,
      type,
      timestamp: new Date()
    }]);
  };

  // コードを実行
  const executeCode = async () => {
    if (!runtime || !inputCode.trim()) return;

    setIsRunning(true);
    addOutput(`> ${inputCode}`, 'input');

    try {
      const result = await runtime.executeNodeJS(inputCode);
      if (result.success && result.output) {
        addOutput(result.output, 'log');
      } else if (result.error) {
        addOutput(result.error, 'error');
      }
    } catch (error) {
      addOutput(`Error: ${(error as Error).message}`, 'error');
    } finally {
      setIsRunning(false);
      setInputCode('');
    }
  };

  // ファイルを実行
  const executeFile = async () => {
    if (!runtime || !selectedFile) return;
    setIsRunning(true);
    addOutput(`> node ${selectedFile}`, 'input');
    localStorage.setItem(LS_KEY, selectedFile);
    try {
      const result = await runtime.executeFile(selectedFile);
      if (result.error) {
        addOutput(result.error, 'error');
      }
    } catch (error) {
      addOutput(`Error: ${(error as Error).message}`, 'error');
    } finally {
      setIsRunning(false);
    }
  };

  // 実行を停止
  const stopExecution = () => {
    setIsRunning(false);
    addOutput('Execution stopped', 'log');
  };

  // 出力をクリア
  const clearOutput = () => {
    setOutput([]);
  };

  // サンプルコードを挿入
  const insertSampleCode = (type: string) => {
    const samples = {
      'hello': 'console.log("Hello, World!");',
      'file-read': `const fs = require('fs');

async function readFile() {
  try {
    const content = await fs.readFile('trivia.json');
    console.log('File content:', content);
  } catch (error) {
    console.error('Error reading file:', error.message);
  }
}

readFile();`,
      'file-write': `const fs = require('fs');

async function writeFile() {
  try {
    await fs.writeFile('test.txt', 'Hello from Node.js!');
    console.log('File written successfully');
  } catch (error) {
    console.error('Error writing file:', error.message);
  }
}

writeFile();`,
      'path-example': `const path = require('path');

const filePath = '/users/documents/file.txt';
console.log('Directory:', path.dirname(filePath));
console.log('Filename:', path.basename(filePath));
console.log('Extension:', path.extname(filePath));
console.log('Joined path:', path.join('/users', 'documents', 'file.txt'));`
    };
    setInputCode(samples[type as keyof typeof samples] || '');
  };

  if (!currentProject) {
    return (
      <div className="h-full flex items-center justify-center" style={{ color: colors.mutedFg }}>
        <div className="text-center">
          <Code size={48} style={{ margin: '0 auto 1rem', color: colors.mutedFg }} />
          <p>プロジェクトを開いてNode.jsコードを実行してください</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col" style={{ background: colors.background }}>
      {/* ヘッダー */}
  <div className="border-b p-3" style={{ borderBottom: `1px solid ${colors.border}` }}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold flex items-center gap-2" style={{ color: colors.foreground }}>
            <Code size={16} style={{ color: colors.primary }} />
            Node.js 実行環境(開発中)
          </h3>
          <div className="flex gap-2">
            <button
              onClick={clearOutput}
              className="p-1.5 hover:bg-accent rounded"
              style={{ color: colors.mutedFg }}
              title="出力をクリア"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        {/* ファイル実行セクション */}
        {executableFiles.length > 0 && (
          <div className="flex gap-2 mb-3 relative">
            <div className="flex-1 relative">
              <input
                type="text"
                value={fileSearch}
                onChange={e => {
                  setFileSearch(e.target.value);
                  setFileSuggestOpen(true);
                }}
                onFocus={() => setFileSuggestOpen(true)}
                onBlur={() => setTimeout(() => setFileSuggestOpen(false), 150)}
                placeholder="実行するファイル名を検索..."
                className="w-full px-2 py-1 border rounded text-sm"
                style={{ background: colors.background, color: colors.foreground, border: `1px solid ${colors.border}` }}
                autoComplete="off"
              />
              {fileSuggestOpen && filteredFiles.length > 0 && (
                <ul className="absolute z-10 left-0 right-0 border rounded shadow max-h-48 overflow-y-auto mt-1" style={{ background: colors.cardBg, border: `1px solid ${colors.border}` }}>
                  {filteredFiles.slice(0, 20).map(file => (
                    <li
                      key={file.uniqueKey || file.path}
                      className={clsx(
                        'px-2 py-1 cursor-pointer text-sm',
                        selectedFile === file.path && 'font-bold'
                      )}
                      style={{ background: selectedFile === file.path ? colors.primary : 'transparent', color: selectedFile === file.path ? colors.background : colors.foreground }}
                      onMouseDown={() => {
                        setSelectedFile(file.path);
                        setFileSearch(file.path);
                        setFileSuggestOpen(false);
                      }}
                    >
                      {file.path}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button
              onClick={executeFile}
              disabled={!selectedFile || isRunning}
              className={clsx('px-3 py-1 rounded text-sm flex items-center gap-1')}
              style={{
                background: selectedFile && !isRunning ? colors.primary : colors.mutedBg,
                color: selectedFile && !isRunning ? colors.background : colors.mutedFg,
                cursor: selectedFile && !isRunning ? 'pointer' : 'not-allowed'
              }}
            >
              <Play size={12} />
              実行
            </button>
          </div>
        )}

        {/* サンプルコード */}
        <div className="flex gap-1 mb-3">
          <span className="text-xs text-muted-foreground py-1">サンプル:</span>
          {[
            { key: 'hello', label: 'Hello' },
            { key: 'file-read', label: 'ファイル読み取り' },
            { key: 'file-write', label: 'ファイル書き込み' },
            { key: 'path-example', label: 'Path' }
          ].map(sample => (
            <button
              key={sample.key}
              onClick={() => insertSampleCode(sample.key)}
              className="px-2 py-1 text-xs rounded"
              style={{ background: colors.mutedBg, color: colors.mutedFg }}
            >
              {sample.label}
            </button>
          ))}
        </div>
      </div>

      {/* 出力エリア */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div
          ref={outputRef}
          className="flex-1 p-3 overflow-y-auto font-mono text-sm"
          style={{ background: colors.background, color: colors.foreground }}
        >
          {output.length === 0 ? (
            <div style={{ color: colors.mutedFg }}>
              Node.jsコードを実行すると、ここに結果が表示されます。ただし、console.logやalertなどは、実際のブラウザネイティブのものに反映されます。
            </div>
          ) : (
            output.map((entry) => (
              <div
                key={entry.id}
                className={clsx('mb-1 whitespace-pre-wrap', entry.type === 'input' && 'font-semibold')}
                style={{
                  color:
                    entry.type === 'error' ? colors.red :
                    entry.type === 'input' ? colors.primary :
                    colors.foreground
                }}
              >
                {entry.content}
              </div>
            ))
          )}
        </div>

        {/* 入力エリア */}
  <div className="border-t p-3" style={{ borderTop: `1px solid ${colors.border}` }}>
          <div className="flex gap-2">
            <textarea
              value={inputCode}
              onChange={(e) => setInputCode(e.target.value)}
              placeholder="Node.jsコードを入力してください..."
              className="flex-1 px-3 py-2 border rounded font-mono text-sm resize-none"
              style={{ background: colors.background, color: colors.foreground, border: `1px solid ${colors.border}` }}
              rows={3}
              onKeyDown={(e) => {
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
                  cursor: inputCode.trim() && !isRunning ? 'pointer' : 'not-allowed'
                }}
              >
                <Play size={14} />
                実行
              </button>
              {isRunning && (
                <button
                  onClick={stopExecution}
                  className="px-4 py-2 rounded flex items-center gap-2"
                  style={{ background: colors.red, color: 'white' }}
                >
                  <Square size={14} />
                  停止
                </button>
              )}
            </div>
          </div>
          <div className="text-xs mt-2" style={{ color: colors.mutedFg }}>
            Ctrl+Enter (Cmd+Enter) で実行
          </div>
        </div>
      </div>
    </div>
  );
}

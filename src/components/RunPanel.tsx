import { useState, useRef, useEffect } from 'react';
import { Play, Square, FileText, Code, Settings, Trash2 } from 'lucide-react';
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

  // 実行可能なファイルを取得（.js, .ts, .mjs ファイル）
  const getExecutableFiles = () => {
    const executableExtensions = ['.js', '.ts', '.mjs', '.cjs'];
    const flattenFiles = (items: any[], parentPath = ''): any[] => {
      return items.reduce((acc, item) => {
        const fullPath = parentPath ? `${parentPath}/${item.name}` : item.name;
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
    const content = await fs.readFile('package.json');
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

  const executableFiles = getExecutableFiles();

  if (!currentProject) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <Code size={48} className="mx-auto mb-4" />
          <p>プロジェクトを開いてNode.jsコードを実行してください</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background">
      {/* ヘッダー */}
      <div className="border-b border-border p-3">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold flex items-center gap-2">
            <Code size={16} />
            Node.js 実行環境
          </h3>
          <div className="flex gap-2">
            <button
              onClick={clearOutput}
              className="p-1.5 hover:bg-accent rounded text-muted-foreground"
              title="出力をクリア"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        {/* ファイル実行セクション */}
        {executableFiles.length > 0 && (
          <div className="flex gap-2 mb-3">
            <select
              value={selectedFile}
              onChange={(e) => setSelectedFile(e.target.value)}
              className="flex-1 px-2 py-1 border rounded text-sm bg-background"
            >
              <option value="">実行するファイルを選択...</option>
              {executableFiles.map((file) => (
                <option key={file.uniqueKey || file.path} value={file.path}>
                  {file.path}
                </option>
              ))}
            </select>
            <button
              onClick={executeFile}
              disabled={!selectedFile || isRunning}
              className={clsx(
                'px-3 py-1 rounded text-sm flex items-center gap-1',
                selectedFile && !isRunning
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'bg-muted text-muted-foreground cursor-not-allowed'
              )}
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
              className="px-2 py-1 text-xs bg-muted hover:bg-accent rounded"
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
          className="flex-1 p-3 overflow-y-auto font-mono text-sm bg-background"
        >
          {output.length === 0 ? (
            <div className="text-muted-foreground">
              Node.jsコードを実行すると、ここに結果が表示されます。
            </div>
          ) : (
            output.map((entry) => (
              <div
                key={entry.id}
                className={clsx(
                  'mb-1 whitespace-pre-wrap',
                  entry.type === 'error' && 'text-red-500',
                  entry.type === 'input' && 'text-blue-500 font-semibold',
                  entry.type === 'log' && 'text-foreground'
                )}
              >
                {entry.content}
              </div>
            ))
          )}
        </div>

        {/* 入力エリア */}
        <div className="border-t border-border p-3">
          <div className="flex gap-2">
            <textarea
              value={inputCode}
              onChange={(e) => setInputCode(e.target.value)}
              placeholder="Node.jsコードを入力してください..."
              className="flex-1 px-3 py-2 border rounded font-mono text-sm resize-none bg-background"
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
                className={clsx(
                  'px-4 py-2 rounded flex items-center gap-2',
                  inputCode.trim() && !isRunning
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                    : 'bg-muted text-muted-foreground cursor-not-allowed'
                )}
              >
                <Play size={14} />
                実行
              </button>
              {isRunning && (
                <button
                  onClick={stopExecution}
                  className="px-4 py-2 rounded flex items-center gap-2 bg-red-500 text-white hover:bg-red-600"
                >
                  <Square size={14} />
                  停止
                </button>
              )}
            </div>
          </div>
          <div className="text-xs text-muted-foreground mt-2">
            Ctrl+Enter (Cmd+Enter) で実行
          </div>
        </div>
      </div>
    </div>
  );
}

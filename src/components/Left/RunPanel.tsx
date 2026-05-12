import type { FileItem } from '@/types';
import clsx from 'clsx';
import { Code, Play, Square, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import OperationWindow from '@/components/Top/OperationWindow/OperationWindow';
import { LOCALSTORAGE_KEY } from '@/constants/config';
import { useTranslation } from '@/context/I18nContext';
import { useTheme } from '@/context/ThemeContext';
import { terminalProcessBridge } from '@/engine/cmd/terminalProcessBridge';
import { isPathIgnored, parseGitignore } from '@/engine/core/gitignore';
import { runtimeRegistry } from '@/engine/runtime/core/RuntimeRegistry';

interface RunPanelProps {
  currentProject: { id: string; name: string } | null;
  files: FileItem[];
}

interface OutputEntry {
  id: string;
  content: string;
  type: 'log' | 'error' | 'input';
  timestamp: Date;
}

function buildExecutableProjectFiles(files: FileItem[]): FileItem[] {
  const supportedExtensions = new Set(['.js', '.ts', '.mjs', '.cjs']);
  for (const runtime of runtimeRegistry.getAllRuntimes()) {
    for (const ext of runtime.supportedExtensions) {
      supportedExtensions.add(ext);
    }
  }
  const supportedExtensionsList = Array.from(supportedExtensions);

  const findGitignoreContent = (items: FileItem[]): string | null => {
    for (const item of items) {
      if (item.type === 'file' && item.name === '.gitignore') {
        return item.content ?? null;
      }
      if (item.children) {
        const found = findGitignoreContent(item.children);
        if (found) return found;
      }
    }
    return null;
  };

  const gitignoreContent = findGitignoreContent(files);
  const gitignoreRules = gitignoreContent ? parseGitignore(gitignoreContent) : null;
  const executableFiles: FileItem[] = [];

  const walk = (items: FileItem[], parentPath = '') => {
    for (const item of items) {
      const fullPath = parentPath ? `${parentPath}/${item.name}` : item.name;

      if (item.type === 'file') {
        const isSupported = supportedExtensionsList.some(ext => item.name.endsWith(ext));
        if (isSupported) {
          try {
            if (!gitignoreRules || !isPathIgnored(gitignoreRules, fullPath, false)) {
              executableFiles.push({
                id: item.id || fullPath,
                name: item.name,
                path: fullPath,
                content: item.content,
                type: 'file',
              });
            }
          } catch (e) {
            executableFiles.push({
              id: item.id || fullPath,
              name: item.name,
              path: fullPath,
              content: item.content,
              type: 'file',
            });
          }
        }
      }

      if (item.children) {
        walk(item.children, fullPath);
      }
    }
  };

  walk(files);
  return executableFiles;
}

export default function RunPanel({ currentProject, files }: RunPanelProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [isRunning, setIsRunning] = useState(false);
  const [output, setOutput] = useState<OutputEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>('');
  const [interactiveInput, setInteractiveInput] = useState('');
  const [isOperationOpen, setIsOperationOpen] = useState(false);
  const [projectFilesForOperation, setProjectFilesForOperation] = useState<FileItem[]>([]);
  const outputRef = useRef<HTMLDivElement>(null);
  const interactiveInputRef = useRef<HTMLInputElement>(null);
  const outputCount = output.length;

  // 出力エリアの自動スクロール
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
    // 新しい出力が来たときにインタラクティブ入力フィールドにフォーカス
    if (isRunning) {
      interactiveInputRef.current?.focus();
    }
  }, [outputCount, isRunning]);

  // 初期化時にlocalStorageから復元
  useEffect(() => {
    const last = localStorage.getItem(LOCALSTORAGE_KEY.LAST_EXECUTE_FILE);
    if (last) {
      setSelectedFile(last);
    }
  }, [currentProject?.id]);

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
  const createOutputConsole = () => ({
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

    terminalProcessBridge.activate();
    try {
      const result = await runtime.execute({
        projectId: currentProject.id,
        projectName: currentProject.name,
        filePath,
        debugConsole: createOutputConsole(),
        processStdin: terminalProcessBridge.stdin,
      });

      if (result.stderr) {
        addOutput(result.stderr, 'error');
      } else if (result.stdout) {
        addOutput(result.stdout, 'log');
      }
    } catch (error) {
      addOutput(`Error: ${(error as Error).message}`, 'error');
    } finally {
      terminalProcessBridge.deactivate();
      setIsRunning(false);
    }
  };

  // 実行中のインタラクティブ入力を送信
  const submitInteractiveInput = () => {
    const line = interactiveInput;
    setInteractiveInput('');
    addOutput(`> ${line}`, 'input');
    terminalProcessBridge.submitLine(line);
  };

  // 実行を停止
  const stopExecution = () => {
    terminalProcessBridge.deactivate();
    setIsRunning(false);
    addOutput(t('run.executionStopped'), 'log');
  };

  // 出力をクリア
  const clearOutput = () => {
    setOutput([]);
  };

  const openFileSelector = () => {
    setProjectFilesForOperation(buildExecutableProjectFiles(files));
    setIsOperationOpen(true);
  };

  if (!currentProject) {
    return (
      <div className="h-full flex items-center justify-center" style={{ color: colors.mutedFg }}>
        <div className="text-center">
          <Code size={48} style={{ margin: '0 auto 1rem', color: colors.mutedFg }} />
          <p>{t('run.noProject')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col" style={{ background: colors.background }}>
      {/* ヘッダー */}
      <div className="border-b p-3" style={{ borderBottom: `1px solid ${colors.border}` }}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Code size={16} style={{ color: colors.primary }} />
            <span className="font-semibold" style={{ color: colors.foreground }}>
              {t('run.title')}
            </span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
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
        <div className="flex gap-2 mb-3 items-center">
          <div className="flex-1">
            <button
              type="button"
              onClick={openFileSelector}
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
            type="button"
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

        {/* インタラクティブ入力エリア（実行中のみ表示） */}
        {isRunning && (
          <div
            className="border-t px-3 py-2 flex items-center gap-2"
            style={{ borderTop: `1px solid ${colors.border}`, background: colors.background }}
          >
            <span className="font-mono text-xs" style={{ color: colors.primary }}>
              {'>'}
            </span>
            <input
              ref={interactiveInputRef}
              type="text"
              value={interactiveInput}
              onChange={e => setInteractiveInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submitInteractiveInput();
                }
              }}
              className="flex-1 bg-transparent outline-none font-mono text-sm"
              style={{ color: colors.foreground }}
            />
          </div>
        )}
        {isRunning && (
          <div className="border-t p-3" style={{ borderTop: `1px solid ${colors.border}` }}>
            <button
              type="button"
              onClick={stopExecution}
              className="px-4 py-2 rounded flex items-center gap-2"
              style={{ background: colors.red, color: 'white' }}
            >
              <Square size={14} />
              {t('run.stop')}
            </button>
          </div>
        )}
      </div>
      {isOperationOpen && (
        <OperationWindow
          onClose={() => setIsOperationOpen(false)}
          projectFiles={projectFilesForOperation}
          onFileSelect={(file: FileItem) => {
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

// チャットメッセージ表示コンポーネント

'use client';

import React from 'react';
import { useTheme } from '@/context/ThemeContext';
import type { AIMessage, AIEditResponse, ChatSpaceMessage } from '@/types';
import ChangedFilesList from './ChangedFilesList';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ChatMessageProps {
  message: AIMessage | ChatSpaceMessage;
  onOpenReview?: (filePath: string, originalContent: string, suggestedContent: string) => void;
  onApplyChanges?: (filePath: string, newContent: string) => void;
  onDiscardChanges?: (filePath: string) => void;
  showEditActions?: boolean;
  compact?: boolean;
}

export default function ChatMessage({ 
  message, 
  onOpenReview, 
  onApplyChanges, 
  onDiscardChanges, 
  showEditActions = false, 
  compact = false 
}: ChatMessageProps) {
  const { colors } = useTheme();

  const isUser = message.type === 'user';

  // ChatSpaceMessageの型からeditResponseを取得
  const editResponse = (message as any).editResponse as AIEditResponse | undefined;

  return (
    <div className="w-full">
      <div 
        className="w-full rounded px-2 py-1.5"
        style={{
          background: isUser ? colors.accent : colors.mutedBg,
          color: isUser ? colors.accentFg : colors.foreground,
          border: `1px solid ${isUser ? colors.accent : colors.border}`,
        }}
      >
        {/* メッセージ内容 */}
        <div className={`${compact ? 'text-xs' : 'text-sm'} leading-relaxed`}>
          <ReactMarkdown 
            remarkPlugins={[remarkGfm]}
            components={{
              // カスタムコンポーネントでスタイルを調整
              p: ({ children }) => <div className="mb-2 last:mb-0">{children}</div>,
              code: ({ children, ...props }) => {
                const inline = !props.className?.includes('language-');
                return (
                  <code 
                    className={`${inline ? 'px-1 py-0.5 rounded text-xs' : 'block p-2 rounded text-xs'}`}
                    style={{ 
                      background: 'rgba(0, 0, 0, 0.1)', 
                      color: isUser ? colors.accentFg : colors.foreground,
                      fontFamily: 'monospace'
                    }}
                  >
                    {children}
                  </code>
                );
              },
              pre: ({ children }) => (
                <pre className="overflow-x-auto mb-2" style={{ fontSize: '11px' }}>
                  {children}
                </pre>
              ),
              h1: ({ children }) => <h1 className="text-lg font-bold mb-2">{children}</h1>,
              h2: ({ children }) => <h2 className="text-base font-bold mb-2">{children}</h2>,
              h3: ({ children }) => <h3 className="text-sm font-bold mb-1">{children}</h3>,
              ul: ({ children }) => <ul className="list-disc list-inside mb-2">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal list-inside mb-2">{children}</ol>,
              li: ({ children }) => <li className="mb-1">{children}</li>,
            }}
          >
            {message.content}
          </ReactMarkdown>
        </div>

        {/* 編集結果の表示（編集モードでAIの応答の場合） */}
        {!isUser && editResponse && editResponse.changedFiles.length > 0 && showEditActions && onOpenReview && onApplyChanges && onDiscardChanges && (
          <div className="mt-2 pt-2 border-t border-opacity-20">
            <div 
              className="text-xs mb-1 font-medium flex items-center gap-1"
              style={{ color: colors.foreground }}
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              編集提案 ({editResponse.changedFiles.length})
            </div>
            <ChangedFilesList
              changedFiles={editResponse.changedFiles}
              onOpenReview={onOpenReview}
              onApplyChanges={onApplyChanges}
              onDiscardChanges={onDiscardChanges}
              compact={compact}
            />
          </div>
        )}

        {/* 編集結果の読み取り専用表示（Askモードの場合） */}
        {!isUser && editResponse && editResponse.changedFiles.length > 0 && !showEditActions && (
          <div className="mt-2 pt-2 border-t border-opacity-20">
            <div 
              className="text-xs mb-1 font-medium flex items-center gap-1"
              style={{ color: colors.foreground }}
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              編集結果: {editResponse.changedFiles.length}ファイル
            </div>
            <div className="space-y-1">
              {editResponse.changedFiles.map((file, index) => (
                <div 
                  key={index}
                  className="text-xs p-1.5 rounded border"
                  style={{ 
                    borderColor: colors.border, 
                    background: 'rgba(0, 0, 0, 0.03)' 
                  }}
                >
                  <div className="font-medium text-xs flex items-center gap-1">
                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    {file.path.split('/').pop()}
                  </div>
                  {file.explanation && (
                    <div className="text-xs mt-0.5" style={{ color: colors.mutedFg }}>
                      {file.explanation}
                    </div>
                  )}
                  <div 
                    className="text-xs mt-0.5 flex items-center gap-1"
                    style={{ color: colors.mutedFg }}
                  >
                    <span>{file.originalContent.split('\n').length}行</span>
                    <svg className="w-2 h-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    <span>{file.suggestedContent.split('\n').length}行</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ファイルコンテキスト表示 */}
        {message.fileContext && message.fileContext.length > 0 && !compact && (
          <div className="mt-1.5 pt-1.5 border-t border-opacity-20">
            <div 
              className="text-xs mb-1 flex items-center gap-1"
              style={{ color: isUser ? colors.accentFg : colors.mutedFg }}
            >
              <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              参照ファイル:
            </div>
            <div className="flex flex-wrap gap-1">
              {message.fileContext.map((filePath, index) => (
                <span
                  key={index}
                  className="text-xs px-1.5 py-0.5 rounded"
                  style={{
                    background: isUser 
                      ? 'rgba(255, 255, 255, 0.15)' 
                      : 'rgba(0, 0, 0, 0.05)',
                    color: isUser ? colors.accentFg : colors.mutedFg,
                    border: `1px solid ${isUser ? 'rgba(255, 255, 255, 0.2)' : colors.border}`,
                  }}
                >
                  {filePath.split('/').pop()}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* コンパクト表示でのファイルコンテキスト */}
        {message.fileContext && message.fileContext.length > 0 && compact && (
          <div className="mt-1">
            <span 
              className="text-xs opacity-70 flex items-center gap-1"
              style={{ color: isUser ? colors.accentFg : colors.mutedFg }}
            >
              <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2H5a2 2 0 00-2-2z" />
              </svg>
              {message.fileContext.length}個のファイル
            </span>
          </div>
        )}

        {/* タイムスタンプ */}
        <div 
          className={`text-xs mt-1 opacity-60 ${compact ? 'text-xs' : ''}`}
          style={{ color: isUser ? colors.accentFg : colors.mutedFg }}
        >
          {message.timestamp.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  );
}

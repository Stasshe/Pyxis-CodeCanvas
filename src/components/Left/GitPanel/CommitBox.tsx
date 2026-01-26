'use client';
import React from 'react';

export default function CommitBox({
  gitRepo,
  commitMessage,
  setCommitMessage,
  handleGenerateCommitMessage,
  handleCommit,
  apiKey,
  handleApiKeyChange,
  isGenerating,
  generateError,
  isCommitting,
  colors,
  t,
  hasApiKey,
  uiError,
}: any) {
  return (
    <div style={{ padding: '0.3rem', borderBottom: `1px solid ${colors.border}` }}>
      {!hasApiKey && (
        <input
          type="text"
          value={apiKey}
          onChange={handleApiKeyChange}
          placeholder={t('git.apiKeyPlaceholder')}
          style={{
            width: '100%',
            marginBottom: '0.5rem',
            fontSize: '0.75rem',
            border: `1px solid ${colors.border}`,
            borderRadius: '0.375rem',
            padding: '0.25rem 0.5rem',
            background: colors.background,
            color: colors.foreground,
          }}
        />
      )}
      <textarea
        value={commitMessage}
        onChange={(e: any) => setCommitMessage(e.target.value)}
        placeholder={t('git.commitMessagePlaceholder')}
        style={{
          width: '100%',
          height: '4rem',
          fontSize: '0.75rem',
          border: `1px solid ${colors.border}`,
          borderRadius: '0.375rem',
          padding: '0.25rem 0.5rem',
          resize: 'none',
          background: colors.background,
          color: colors.foreground,
        }}
        className="select-text"
      />
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
        <button
          onClick={handleGenerateCommitMessage}
          disabled={!apiKey || isGenerating}
          style={{
            flex: 1,
            background: '#22c55e',
            color: 'white',
            borderRadius: '0.375rem',
            padding: '0.5rem 1rem',
            fontSize: '0.75rem',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
            border: 'none',
            cursor: isGenerating || !apiKey ? 'not-allowed' : 'pointer',
            opacity: isGenerating || !apiKey ? 0.5 : 1,
          }}
          className="select-none"
        >
          {t('git.generateCommitMessage')}
        </button>
        <button
          onClick={handleCommit}
          disabled={!commitMessage.trim() || isCommitting}
          style={{
            flex: 1,
            background: colors.primary,
            color: colors.background,
            borderRadius: '0.375rem',
            padding: '0.5rem 1rem',
            fontSize: '0.75rem',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
            border: 'none',
            cursor: isCommitting || !commitMessage.trim() ? 'not-allowed' : 'pointer',
            opacity: isCommitting || !commitMessage.trim() ? 0.5 : 1,
          }}
          className="select-none"
        >
          {t('git.commit')}
        </button>
      </div>
      {generateError && (
        <div
          style={{
            marginTop: '0.5rem',
            padding: '0.5rem',
            background: `${colors.red}20`,
            border: `1px solid ${colors.red}`,
            borderRadius: '0.375rem',
            fontSize: '0.75rem',
            color: colors.red,
          }}
        >
          {generateError}
        </div>
      )}

      {uiError && (
        <div
          style={{
            marginTop: '0.5rem',
            padding: '0.5rem',
            background: `${colors.red}10`,
            border: `1px solid ${colors.red}`,
            borderRadius: '0.375rem',
            fontSize: '0.75rem',
            color: colors.red,
          }}
        >
          {uiError}
        </div>
      )}
    </div>
  );
}

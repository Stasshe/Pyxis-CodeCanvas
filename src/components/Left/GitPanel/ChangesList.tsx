'use client';
import React, { memo } from 'react';
import FileItem from './FileItem';
import { useTranslation } from '@/context/I18nContext';

export default function ChangesList({
  gitRepo,
  hasChanges,
  iconColors,
  plusIcon,
  minusIcon,
  discardIcon,
  handleStageAll,
  handleUnstageAll,
  handleStageFile,
  handleUnstageFile,
  handleDiscardChanges,
  handleStagedFileClick,
  handleUnstagedFileClick,
  colors,
}: any) {
  const { t } = useTranslation();

  return (
    <div
      style={{
        padding: '0.75rem',
        borderBottom: `1px solid ${colors.border}`,
        maxHeight: '45%',
        overflowY: 'auto',
        minHeight: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '0.5rem',
        }}
      >
        <h4 style={{ fontSize: '0.875rem', fontWeight: 500, color: colors.foreground }}>
          {t('git.changes')}
        </h4>
        {hasChanges && (
          <div style={{ display: 'flex', gap: '0.25rem' }}>
            <button
              onClick={handleStageAll}
              style={{
                padding: '0.25rem',
                background: 'transparent',
                borderRadius: '0.375rem',
                border: 'none',
                fontSize: '0.75rem',
                cursor: 'pointer',
              }}
              title={t('git.stageAll')}
              className="select-none"
            >
              {t('git.stageAll')}
            </button>
            <button
              onClick={handleUnstageAll}
              style={{
                padding: '0.25rem',
                background: 'transparent',
                borderRadius: '0.375rem',
                border: 'none',
                fontSize: '0.75rem',
                cursor: 'pointer',
              }}
              title={t('git.unstageAll')}
              className="select-none"
            >
              {t('git.unstageAll')}
            </button>
          </div>
        )}
      </div>

      {!hasChanges ? (
        <p style={{ fontSize: '0.75rem', color: colors.mutedFg }}>{t('git.noChanges')}</p>
      ) : (
        <div>
          {(gitRepo?.status?.staged?.length || 0) > 0 && (
            <div>
              <p style={{ fontSize: '0.75rem', color: '#22c55e', marginBottom: '0.25rem' }}>
                {t('git.staged')} ({gitRepo?.status?.staged?.length || 0})
              </p>
              {(gitRepo?.status?.staged || []).map((file: string) => (
                <FileItem
                  key={`staged-${file}`}
                  file={file}
                  color="#22c55e"
                  onPrimaryAction={handleUnstageFile}
                  onFileClick={handleStagedFileClick}
                  primaryIcon={minusIcon}
                  primaryTitle={t('git.unstage')}
                  fileClickTitle={t('git.viewDiffReadonly')}
                  colors={iconColors}
                />
              ))}
            </div>
          )}

          {(gitRepo?.status?.unstaged?.length || 0) > 0 && (
            <div>
              <p style={{ fontSize: '0.75rem', color: '#f59e42', marginBottom: '0.25rem' }}>
                {t('git.unstaged')} ({gitRepo?.status?.unstaged?.length || 0})
              </p>
              {(gitRepo?.status?.unstaged || []).map((file: string) => (
                <FileItem
                  key={`unstaged-${file}`}
                  file={file}
                  color="#f59e42"
                  onPrimaryAction={handleStageFile}
                  onSecondaryAction={handleDiscardChanges}
                  onFileClick={handleUnstagedFileClick}
                  primaryIcon={plusIcon}
                  secondaryIcon={discardIcon}
                  primaryTitle={t('git.stage')}
                  secondaryTitle={t('git.discard')}
                  fileClickTitle={t('git.viewDiffEditable')}
                  colors={iconColors}
                />
              ))}
            </div>
          )}

          {(gitRepo?.status?.deleted?.length || 0) > 0 && (
            <div>
              <p style={{ fontSize: '0.75rem', color: colors.red, marginBottom: '0.25rem' }}>
                {t('git.deleted')} ({gitRepo?.status?.deleted?.length || 0})
              </p>
              {(gitRepo?.status?.deleted || []).map((file: string) => (
                <FileItem
                  key={`deleted-${file}`}
                  file={file}
                  color={colors.red}
                  onPrimaryAction={handleStageFile}
                  onSecondaryAction={handleDiscardChanges}
                  onFileClick={handleUnstagedFileClick}
                  primaryIcon={plusIcon}
                  secondaryIcon={discardIcon}
                  primaryTitle={t('git.stageDelete')}
                  secondaryTitle={t('git.discard')}
                  fileClickTitle={t('git.viewDiffEditable')}
                  colors={iconColors}
                />
              ))}
            </div>
          )}

          {(gitRepo?.status?.untracked?.length || 0) > 0 && (
            <div>
              <p style={{ fontSize: '0.75rem', color: colors.primary, marginBottom: '0.25rem' }}>
                {t('git.untracked')} ({gitRepo?.status?.untracked?.length || 0})
              </p>
              {(gitRepo?.status?.untracked || []).map((file: string) => (
                <FileItem
                  key={`untracked-${file}`}
                  file={file}
                  color={colors.primary}
                  onPrimaryAction={handleStageFile}
                  onSecondaryAction={handleDiscardChanges}
                  primaryIcon={plusIcon}
                  primaryTitle={t('git.stage')}
                  fileClickTitle={t('git.viewDiffEditable')}
                  colors={iconColors}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

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
  handleDiscardAllUnstaged,
  handleDiscardAllStaged,
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
      {/* Staged group header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '0.25rem',
        }}
      >
        <h4 style={{ fontSize: '0.8125rem', fontWeight: 600, color: colors.foreground, display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {t('git.staged')} ({gitRepo?.status?.staged?.length || 0})
        </h4>
        <div style={{ display: 'flex', gap: '0.25rem' }}>
          {(gitRepo?.status?.staged?.length || 0) > 0 && (
            <>
              <button
                onClick={handleUnstageAll}
                style={{
                  padding: '0.25rem',
                  background: 'transparent',
                  borderRadius: '0.375rem',
                  border: 'none',
                  cursor: 'pointer',
                }}
                title={t('git.unstageAll')}
                className="select-none"
              >
                {minusIcon}
              </button>
              <button
                onClick={handleDiscardAllStaged}
                style={{
                  padding: '0.25rem',
                  background: 'transparent',
                  borderRadius: '0.375rem',
                  border: 'none',
                  cursor: 'pointer',
                }}
                title={t('git.discardAll')}
                className="select-none"
              >
                {discardIcon}
              </button>
            </>
          )}
        </div>
      </div>

      {(gitRepo?.status?.staged?.length || 0) > 0 && (
        <div style={{ marginBottom: '0.5rem' }}>
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

      {/* Changes group header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '0.25rem',
        }}
      >
        <h4 style={{ fontSize: '0.8125rem', fontWeight: 600, color: colors.foreground, display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {t('git.changes')} ({(gitRepo?.status?.unstaged?.length || 0) + (gitRepo?.status?.deleted?.length || 0) + (gitRepo?.status?.untracked?.length || 0)})
        </h4>
        <div style={{ display: 'flex', gap: '0.25rem' }}>
          {((gitRepo?.status?.unstaged?.length || 0) + (gitRepo?.status?.deleted?.length || 0) + (gitRepo?.status?.untracked?.length || 0)) > 0 && (
            <>
              <button
                onClick={handleStageAll}
                style={{
                  padding: '0.25rem',
                  background: 'transparent',
                  borderRadius: '0.375rem',
                  border: 'none',
                  cursor: 'pointer',
                }}
                title={t('git.stageAll')}
                className="select-none"
              >
                {plusIcon}
              </button>
              <button
                onClick={handleDiscardAllUnstaged}
                style={{
                  padding: '0.25rem',
                  background: 'transparent',
                  borderRadius: '0.375rem',
                  border: 'none',
                  cursor: 'pointer',
                }}
                title={t('git.discardAll')}
                className="select-none"
              >
                {discardIcon}
              </button>
            </>
          )}
        </div>
      </div>

      {((gitRepo?.status?.unstaged?.length || 0) + (gitRepo?.status?.deleted?.length || 0) + (gitRepo?.status?.untracked?.length || 0)) === 0 && (gitRepo?.status?.staged?.length || 0) === 0 ? (
        <p style={{ fontSize: '0.75rem', color: colors.mutedFg }}>{t('git.noChanges')}</p>
      ) : (
        <div>
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

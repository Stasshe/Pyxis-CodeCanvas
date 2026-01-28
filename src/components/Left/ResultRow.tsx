import { Edit3 } from 'lucide-react';
import { memo, PropsWithChildren } from 'react';
import type { ResultRowProps } from './SearchPanel';

const ResultRow = memo(function ResultRow({
  result,
  globalIndex,
  isSelected,
  resultKey,
  colors,
  hoveredResultKey,
  onHoverChange,
  onClick,
  onReplace,
  replaceQuery,
  children,
}: PropsWithChildren<ResultRowProps>) {
  const showResultReplace = result.line !== 0 && (isSelected || hoveredResultKey === resultKey);
  return (
    <div
      onClick={() => onClick(result, globalIndex)}
      style={{
        padding: '0.12rem',
        borderRadius: '0.2rem',
        cursor: 'pointer',
        background: isSelected ? colors.accentBg : 'transparent',
        display: 'flex',
        alignItems: 'center',
        gap: '0.32rem',
      }}
      onMouseEnter={() => onHoverChange(resultKey)}
      onMouseLeave={() => onHoverChange(null)}
    >
      <div
        style={{
          display: 'flex',
          gap: '0.32rem',
          alignItems: 'center',
          flex: 1,
          minWidth: 0,
        }}
      >
        <span
          style={{
            color: colors.mutedFg,
            width: '2.6rem',
            flexShrink: 0,
            fontSize: '0.62rem',
          }}
        >
          {result.line}:{result.column}
        </span>
        <code
          style={{
            background: colors.mutedBg,
            padding: '0.08rem 0.26rem',
            borderRadius: '0.2rem',
            color: colors.foreground,
            display: 'block',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: 'calc(100% - 6rem)',
          }}
          title={result.content}
        >
          {/* highlight match */}
          {(() => {
            const before = result.content.substring(0, result.matchStart);
            const match = result.content.substring(result.matchStart, result.matchEnd);
            const after = result.content.substring(result.matchEnd);
            return (
              <>
                {before}
                <span
                  style={{
                    background: colors.primary,
                    color: colors.background,
                    padding: '0.125rem 0.25rem',
                    borderRadius: '0.25rem',
                  }}
                >
                  {match}
                </span>
                {after}
              </>
            );
          })()}
        </code>
      </div>

      {showResultReplace && (
        <button
          onClick={e => {
            e.stopPropagation();
            onReplace(result, replaceQuery);
          }}
          title="Replace"
          style={{
            padding: '0.08rem',
            borderRadius: '0.22rem',
            border: `1px solid ${colors.border}`,
            background: colors.mutedBg,
            color: colors.foreground,
            cursor: 'pointer',
            fontSize: '0.6rem',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <Edit3 size={12} />
        </button>
      )}
    </div>
  );
});

export default ResultRow;

interface BottomPanelProps {
  height: number;
  onResize: (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => void;
}

export default function BottomPanel({ height, onResize }: BottomPanelProps) {
  return (
    <>
      {/* Bottom Resizer */}
      <div
        className="resizer resizer-horizontal"
        onMouseDown={onResize}
        onTouchStart={onResize}
      />

      {/* Bottom Panel (Terminal placeholder) */}
      <div 
        className="bg-card border-t border-border"
        style={{ height }}
      >
        <div className="h-8 bg-muted border-b border-border flex items-center px-3">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            ターミナル
          </span>
        </div>
        <div className="h-full p-4 overflow-auto">
          <p className="text-sm text-muted-foreground">ターミナル機能は準備中です</p>
        </div>
      </div>
    </>
  );
}

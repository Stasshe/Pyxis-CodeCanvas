import Terminal from './Terminal';

interface BottomPanelProps {
  height: number;
  currentProject?: string;
  onResize: (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => void;
}

export default function BottomPanel({ height, currentProject, onResize }: BottomPanelProps) {
  return (
    <>
      {/* Bottom Resizer */}
      <div
        className="resizer resizer-horizontal"
        onMouseDown={onResize}
        onTouchStart={onResize}
      />

      {/* Bottom Panel (Terminal) */}
      <div 
        className="bg-card border-t border-border flex flex-col"
        style={{ height }}
      >
        <div className="h-8 bg-muted border-b border-border flex items-center px-3 flex-shrink-0">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            ターミナル
          </span>
          {currentProject && (
            <span className="ml-2 text-xs text-muted-foreground">
              - {currentProject}
            </span>
          )}
        </div>
        <div className="flex-1 overflow-hidden">
          <Terminal height={height} currentProject={currentProject} />
        </div>
      </div>
    </>
  );
}

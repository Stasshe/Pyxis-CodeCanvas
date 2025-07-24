import React from 'react';

interface WelcomeTabProps {
  projectName: string;
  description?: string;
}

export default function WelcomeTab({ projectName, description }: WelcomeTabProps) {
  return (
    <div 
      className="h-full flex flex-col items-center text-muted-foreground overflow-hidden"
      style={{
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        MozUserSelect: 'none',
        msUserSelect: 'none',
        touchAction: 'manipulation'
      }}
    >
      <div className="max-w-2xl w-full h-full overflow-auto px-8 py-6">
        <div className="pb-24"> {/* 下部に余白を追加 */}
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold mb-3">ようこそ！</h1>
            <h2 className="text-2xl mb-4 text-primary">{projectName}</h2>
            {description && <p className="mb-4 text-base leading-relaxed">{description}</p>}
          </div>

          <div className="bg-card p-6 rounded-lg shadow-lg text-sm mb-8">
            <p className="mb-2 text-base">このプロジェクトのファイルはIndexedDBに保存されています。</p>
            <p className="mt-3 font-mono bg-muted px-3 py-2 rounded">
              パス: ./{projectName}/~$
            </p>
          </div>

          <section className="mb-8">
            <h3 className="text-xl font-semibold mb-4 pb-2 border-b">Pyxisの主な特徴</h3>
            <ul className="space-y-2 text-base">
              <li className="flex items-center gap-2">
                <span className="w-2 h-2 bg-primary rounded-full flex-shrink-0"></span>
                完全クライアントサイドIDE（サーバー不要・静的ホスティング）
              </li>
              <li className="flex items-center gap-2">
                <span className="w-2 h-2 bg-primary rounded-full flex-shrink-0"></span>
                Node.jsランタイム・npm・Unixコマンド・Gitをブラウザで利用可能
              </li>
              <li className="flex items-center gap-2">
                <span className="w-2 h-2 bg-primary rounded-full flex-shrink-0"></span>
                VS Codeライクな編集体験・Monaco Editor搭載
              </li>
              <li className="flex items-center gap-2">
                <span className="w-2 h-2 bg-primary rounded-full flex-shrink-0"></span>
                Git履歴・ブランチ管理・コミットグラフ表示
              </li>
              <li className="flex items-center gap-2">
                <span className="w-2 h-2 bg-primary rounded-full flex-shrink-0"></span>
                iPadにも最適化されたレスポンシブUI
              </li>
              <li className="flex items-center gap-2">
                <span className="w-2 h-2 bg-primary rounded-full flex-shrink-0"></span>
                Markdown/LaTeX/HTML/CSS/JavaScript/Pythonなど多言語対応
              </li>
              <li className="flex items-center gap-2">
                <span className="w-2 h-2 bg-primary rounded-full flex-shrink-0"></span>
                Mermaid記法でフローチャートやシーケンス図をリアルタイム描画
              </li>
            </ul>
          </section>

          <section>
            <h3 className="text-xl font-semibold mb-4 pb-2 border-b">主要機能</h3>
            <ul className="space-y-2 text-base">
              <li className="flex items-center gap-2">
                <span className="w-2 h-2 bg-primary rounded-full flex-shrink-0"></span>
                LaTeX数式レンダリング・Mermaid記法対応
              </li>
              <li className="flex items-center gap-2">
                <span className="w-2 h-2 bg-primary rounded-full flex-shrink-0"></span>
                ファイルのインポート・ダウンロード・zipエクスポート
              </li>
              <li className="flex items-center gap-2">
                <span className="w-2 h-2 bg-primary rounded-full flex-shrink-0"></span>
                テーマカラー変更・複数モニター対応
              </li>
              <li className="flex items-center gap-2">
                <span className="w-2 h-2 bg-primary rounded-full flex-shrink-0"></span>
                Git/プロジェクトファイルのダウンロード
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

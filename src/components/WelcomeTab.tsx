import React from 'react';

interface WelcomeTabProps {
  projectName: string;
  description?: string;
}

export default function WelcomeTab({ projectName, description }: WelcomeTabProps) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-8">
      <h1 className="text-2xl font-bold mb-2">ようこそ！</h1>
      <h2 className="text-xl mb-4">{projectName}</h2>
      {description && <p className="mb-4 text-base">{description}</p>}
      <div className="bg-card p-4 rounded shadow text-sm max-w-xl">
        <p>このプロジェクトのファイルはIndexedDBに保存されています。</p>
        <p className="mt-2">パス: <code>./{projectName}/~$</code></p>
      </div>
      <div className="mt-8 w-full max-w-2xl">
        <h3 className="text-lg font-semibold mb-2">Pyxisの主な特徴</h3>
        <ul className="list-disc pl-6 mb-4 text-sm">
          <li>完全クライアントサイドIDE（サーバー不要・静的ホスティング）</li>
          <li>Node.jsランタイム・npm・Unixコマンド・Gitをブラウザで利用可能</li>
          <li>VS Codeライクな編集体験・Monaco Editor搭載</li>
          <li>Git履歴・ブランチ管理・コミットグラフ表示</li>
          <li>iPadにも最適化されたレスポンシブUI</li>
          <li>Markdown/LaTeX/HTML/CSS/JavaScript/Pythonなど多言語対応</li>
          <li>Mermaid記法でフローチャートやシーケンス図をリアルタイム描画</li>
        </ul>
        <h3 className="text-lg font-semibold mb-2">主要機能</h3>
        <ul className="list-disc pl-6 mb-4 text-sm">
          <li>LaTeX数式レンダリング・Mermaid記法対応</li>
          <li>ファイルのインポート・ダウンロード・zipエクスポート</li>
          <li>テーマカラー変更・複数モニター対応</li>
          <li>Git/プロジェクトファイルのダウンロード</li>
        </ul>
      </div>
    </div>
  );
}

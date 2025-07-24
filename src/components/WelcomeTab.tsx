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
        <p className="mt-2">左サイドバーからファイルを開くか、新規作成してください。</p>
      </div>
    </div>
  );
}

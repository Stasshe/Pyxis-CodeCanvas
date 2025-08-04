const pages = {
  about: `<div style="color:#222;"><h2>Pyxisとは</h2>
    <p>Pyxisは、完全にクライアントサイドで動作するIDEです。Node.jsランタイムとGitをブラウザ上で利用でき、サーバー不要で本格的な開発環境を実現します。</p>
    <ul>
      <li>Node.jsアプリをブラウザで実行</li>
      <li>VS Code風のUIとタブ・ファイル管理</li>
      <li>Git操作も全てローカルで完結</li>
      <li>iPadやモバイルにも最適化</li>
    </ul></div>`,
  features: `<div style="color:#222;"><h2>主な特徴</h2>
    <ul>
      <li><b>Node.jsランタイム</b> - npmコマンドやrequireが使える</li>
      <li><b>VS Code風エディタ</b> - シンタックスハイライト・補完・エラー表示</li>
      <li><b>Git統合</b> - init, add, commit, branch, merge, checkout等</li>
      <li><b>マルチプラットフォーム</b> - iPad/モバイル/PC対応</li>
      <li><b>LaTeX/Markdown/Mermaid対応</b></li>
      <li><b>ダウンロード/インポート機能</b></li>
    </ul></div>`,
  tech: `<div style="color:#222;"><h2>技術スタック</h2>
    <ul>
      <li>Next.js (React) <span style="color:#888">※Pyxis本体はNext.js製</span></li>
      <li>TypeScript, Tailwind CSS</li>
      <li>Monaco Editor, xterm.js</li>
      <li>Lightning FS, QuickJS, node-stdlib-browser</li>
      <li>isomorphic-git, @gitgraph/react</li>
    </ul></div>`,
  usage: `<div style="color:#222;"><h2>使い方</h2>
    <ol>
      <li>Pyxisを開く</li>
      <li>新規プロジェクト作成 or 既存プロジェクトを開く</li>
      <li>Node.jsコードを編集・実行</li>
      <li>Gitでバージョン管理</li>
      <li>必要に応じてダウンロード/インポート</li>
    </ol>
    <h3>サンプル</h3>
    <pre><code>// app.js
const fs = require('fs');
fs.writeFileSync('hello.txt', 'Hello from Pyxis!');
console.log(fs.readFileSync('hello.txt', 'utf8'));
</code></pre>
    <h3>Git操作例</h3>
    <pre><code>git init
git add .
git commit -m "Initial commit"
git checkout -b feature/new-feature
git merge feature/new-feature
</code></pre></div>`
};

function setPage(page) {
  const main = document.getElementById('main-content');
  main.classList.remove('animate__fadeIn'); // 既存のアニメーションをリセット
  main.classList.add('animate__fadeOut'); // フェードアウトアニメーションを追加

  setTimeout(() => {
    main.innerHTML = pages[page] || pages.about;
    main.classList.remove('animate__fadeOut'); // フェードアウトをリセット
    main.classList.add('animate__fadeIn'); // フェードインアニメーションを追加
  }, 500); // アニメーションの時間に合わせて調整
}

document.addEventListener('DOMContentLoaded', () => {
  setPage('about');
  document.querySelectorAll('nav button').forEach(btn => {
    btn.addEventListener('click', e => {
      setPage(btn.dataset.page);
    });
  });
});

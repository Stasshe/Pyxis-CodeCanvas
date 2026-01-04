// IndexedDBデータを新規about:blankタブにエクスポートし、結果メッセージを返す
export async function exportIndexeddbHtmlWithWindow(
  writeOutput: (msg: string) => Promise<void>,
  win: Window | null
) {
  if (!win) {
    await writeOutput('about:blankの新規タブを開けませんでした。');
    return;
  }
  try {
    const html = await exportIndexeddbHtml();
    win.document.write(html);
    win.document.close();
    await writeOutput('IndexedDBのデータを新規タブにエクスポートしました。');
  } catch (e) {
    let msg = '';
    if (typeof e === 'object' && e !== null && 'message' in e) {
      msg = (e as any).message;
    } else {
      msg = String(e);
    }
    await writeOutput(`IndexedDBエクスポート失敗: ${msg}`);
  }
}

export async function exportIndexeddbHtml(): Promise<string> {
  const dbs = await (window.indexedDB.databases ? window.indexedDB.databases() : []);
  const allData: DbDump[] = [];
  for (const dbInfo of dbs) {
    const dbName = dbInfo.name;
    if (!dbName) continue;
    // pyxis-fs系DBは除外
    if (dbName.startsWith('pyxis-fs')) continue;
    const req = window.indexedDB.open(dbName);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const objectStoreNames = Array.from(db.objectStoreNames);
    const dbDump: DbDump = { name: dbName, version: db.version, stores: [] };
    for (const storeName of objectStoreNames) {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const getAllReq = store.getAll();
      const items = await new Promise<any[]>((resolve, reject) => {
        getAllReq.onsuccess = () => resolve(getAllReq.result);
        getAllReq.onerror = () => reject(getAllReq.error);
      });
      dbDump.stores.push({ name: storeName, items });
    }
    allData.push(dbDump);
    db.close();
  }
  // HTML生成（見やすさ・大量データ対応強化）
  // TypeScript側でJSON構造を色分けする関数
  // JSON構造を色分けし、オブジェクトや配列は展開/縮小可能なHTMLに変換
  function syntaxHighlight(json: any, path = ''): string {
    if (json === null) return `<span class='json-null'>null</span>`;
    if (Array.isArray(json)) {
      const id = `item-${path}`;
      return `<span class='json-array-toggle' onclick="toggleItem('${id}',this)"><span class='arrow'>▶</span> [Array(${json.length})]</span> <div class='json-array json-collapsible collapsed' id='${id}'>${json.map((v, i) => `<div class='json-array-item'>[${i}] ${syntaxHighlight(v, `${path}-${i}`)}</div>`).join('')}</div>`;
    }
    if (typeof json === 'object') {
      const keys = Object.keys(json);
      const id = `item-${path}`;
      return `<span class='json-object-toggle' onclick="toggleItem('${id}',this)"><span class='arrow'>▶</span> {Object(${keys.length})}</span> <div class='json-object json-collapsible collapsed' id='${id}'>${keys.map(k => `<div class='json-object-item'><span class='json-key'>"${k}"</span>: ${syntaxHighlight(json[k], `${path}-${k}`)}</div>`).join('')}</div>`;
    }
    if (typeof json === 'string') {
      return `<span class='json-string'>"${json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}"</span>`;
    }
    if (typeof json === 'number') {
      return `<span class='json-number'>${json}</span>`;
    }
    if (typeof json === 'boolean') {
      return `<span class='json-boolean'>${json}</span>`;
    }
    return String(json);
  }

  const html = `<!DOCTYPE html><html lang='ja'><head><meta charset='utf-8'><title>IndexedDB Export</title>
    <style>
      body {
        font-family: 'Menlo', 'Monaco', 'Consolas', 'monospace';
        background: #222;
        color: #eee;
        padding: 1em;
        margin: 0;
        overflow-x: auto;
      }
      h1 {
        color: #8cf;
        margin-bottom: 0.5em;
        font-size: 2em;
      }
      .db {
        border: 1px solid #444;
        border-radius: 6px;
        margin-bottom: 0.7em;
        background: #282c34;
        box-shadow: 0 1px 4px #0004;
        padding: 0.5em;
      }
      .db-header {
        cursor: pointer;
        font-size: 1em;
        color: #8cf;
        margin-bottom: 0.2em;
        user-select: none;
        padding: 0.2em 0.3em;
        display: flex;
        align-items: center;
      }
      .arrow {
        display: inline-block;
        width: 1em;
        text-align: center;
        margin-right: 0.2em;
        color: #fc8;
        font-weight: bold;
        transition: transform 0.2s;
      }
      .json-collapsible {
        margin-left: 0.7em;
        max-height: 0;
        overflow: hidden;
        transition: max-height 0.3s cubic-bezier(.4,0,.2,1);
      }
      .json-collapsible:not(.collapsed) {
        max-height: 1000px;
        overflow: auto;
      }
      .items {
        max-height: 0;
        overflow: hidden;
        transition: max-height 0.3s cubic-bezier(.4,0,.2,1);
      }
      .items:not(.collapsed) {
        max-height: 300px;
        overflow: auto;
      }
      .db-content {
        max-height: 0;
        overflow: hidden;
        transition: max-height 0.3s cubic-bezier(.4,0,.2,1);
      }
      .db-content:not(.collapsed) {
        max-height: 2000px;
        overflow: auto;
      }
      .store {
        border-left: 2px solid #fc8;
        margin-bottom: 0.4em;
        padding-left: 0.5em;
        background: #23272e;
        border-radius: 2px;
      }
      .store-header {
        cursor: pointer;
        color: #fc8;
        font-size: 0.95em;
        margin-bottom: 0.1em;
        user-select: none;
        padding: 0.1em 0.2em;
      }
      .items {
        max-height: 300px;
        overflow-y: auto;
        margin-bottom: 0.2em;
      }
      .item {
        margin-left: 0.5em;
        padding: 0.1em 0.2em;
        border-bottom: 1px solid #333;
        background: #222;
        color: #b8e986;
        font-size: 0.92em;
        white-space: pre-wrap;
      }
      .item:nth-child(even) {
        background: #252525;
      }
      .collapsed {
        display: none;
      }
      .count {
        color: #aaa;
        font-size: 0.85em;
        margin-left: 0.3em;
      }
      .json-key {
        color: #8cf;
      }
      .json-string {
        color: #fc8;
      }
      .json-number {
        color: #8f8;
      }
      .json-boolean {
        color: #f88;
      }
      .json-null {
        color: #888;
      }
      .json-array-toggle, .json-object-toggle {
        cursor: pointer;
        color: #8cf;
        font-weight: bold;
        margin-right: 0.2em;
        font-size: 0.92em;
      }
      .json-collapsible {
        margin-left: 0.7em;
      }
      .json-array-item, .json-object-item {
        margin-bottom: 0.1em;
      }
      .footer {
        margin-top: 1em;
        color: #888;
        font-size: 0.85em;
        text-align: right;
      }
      ::-webkit-scrollbar {
        width: 6px;
        background: #222;
      }
      ::-webkit-scrollbar-thumb {
        background: #444;
        border-radius: 3px;
      }
    </style>
  </head><body>
    <h1>IndexedDB Export</h1>
    <div style='margin-bottom:0.5em;'>
      <button onclick='expandAll()' style='margin-right:0.5em;padding:0.2em 0.5em;'>すべて展開</button>
      <button onclick='collapseAll()' style='padding:0.2em 0.5em;'>すべて閉じる</button>
    </div>
    <div id='dbs'>
      ${allData
        .map(
          (db, dbIdx) => `
        <div class='db'>
          <div class='db-header' onclick='toggleDb(${dbIdx}, this)'><span class='arrow'>▶</span>DB: ${db.name} (v${db.version}) <span class='count'>[${db.stores.length} stores]</span></div>
          <div class='db-content collapsed'>
            ${db.stores
              .map(
                (store, storeIdx) => `
              <div class='store'>
                <div class='store-header' onclick='toggleStore(${dbIdx},${storeIdx}, this)'><span class='arrow'>▶</span>Store: ${store.name} <span class='count'>[${store.items.length} items]</span></div>
                <div class='items collapsed' id='items-${dbIdx}-${storeIdx}'>
                  ${store.items.length === 0 ? `<div class='item'>No items</div>` : store.items.map((item, idx) => `<div class='item'>[${idx}] ${syntaxHighlight(item, `${dbIdx}-${storeIdx}-${idx}`)}</div>`).join('')}
                </div>
              </div>
            `
              )
              .join('')}
          </div>
        </div>
      `
        )
        .join('')}
    </div>
    <div class='footer'>Generated at ${new Date().toLocaleString('ja-JP')}</div>
    <script>
      function toggleDb(dbIdx, el) {
        const db = document.querySelectorAll('.db')[dbIdx];
        const content = db.querySelector('.db-content');
        content.classList.toggle('collapsed');
        const arrow = el.querySelector('.arrow');
        if (arrow) arrow.style.transform = content.classList.contains('collapsed') ? '' : 'rotate(90deg)';
      }
      function toggleStore(dbIdx, storeIdx, el) {
        const items = document.getElementById('items-' + dbIdx + '-' + storeIdx);
        if (items) items.classList.toggle('collapsed');
        const arrow = el.querySelector('.arrow');
        if (arrow) arrow.style.transform = items.classList.contains('collapsed') ? '' : 'rotate(90deg)';
      }
      function toggleItem(id, el) {
        const elTarget = document.getElementById(id);
        if (elTarget) elTarget.classList.toggle('collapsed');
        const arrow = el.querySelector('.arrow');
        if (arrow) arrow.style.transform = elTarget.classList.contains('collapsed') ? '' : 'rotate(90deg)';
      }
      function expandAll() {
        document.querySelectorAll('.collapsed').forEach(e => e.classList.remove('collapsed'));
        document.querySelectorAll('.arrow').forEach(e => e.style.transform = 'rotate(90deg)');
      }
      function collapseAll() {
        document.querySelectorAll('.db-content, .items, .json-collapsible').forEach(e => e.classList.add('collapsed'));
        document.querySelectorAll('.arrow').forEach(e => e.style.transform = '');
      }
      // 初期状態: すべて閉じる
      window.onload = () => { collapseAll(); };
    </script>
  </body></html>`;
  return html;
}

// IndexedDBの全データを取得してHTML文字列として返すユーティリティ
export type StoreDump = { name: string; items: any[] };
export type DbDump = { name: string; version: number; stores: StoreDump[] };

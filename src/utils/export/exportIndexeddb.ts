// IndexedDBデータを新規about:blankタブにエクスポートし、結果メッセージを返す
export async function exportIndexeddbHtmlWithWindow(writeOutput: (msg: string) => Promise<void>, win: Window | null) {
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
    await writeOutput('IndexedDBエクスポート失敗: ' + msg);
  }
}
// IndexedDBの全データを取得してHTML文字列として返すユーティリティ
export type StoreDump = { name: string; items: any[] };
export type DbDump = { name: string; version: number; stores: StoreDump[] };

export async function exportIndexeddbHtml(): Promise<string> {
  const dbs = await (window.indexedDB.databases ? window.indexedDB.databases() : []);
  let allData: DbDump[] = [];
  for (const dbInfo of dbs) {
    const dbName = dbInfo.name;
    if (!dbName) continue;
    const req = window.indexedDB.open(dbName);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const objectStoreNames = Array.from(db.objectStoreNames);
    let dbDump: DbDump = { name: dbName, version: db.version, stores: [] };
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
  // HTML生成
  const html = `<html><head><title>IndexedDB Export</title><style>body{font-family:monospace;white-space:pre-wrap;background:#222;color:#eee;padding:1em;} h2{color:#8cf;} h3{color:#fc8;} .store{margin-bottom:1em;} .item{margin-left:2em;} </style></head><body>` +
    `<h1>IndexedDB Export</h1>` +
    allData.map((db) =>
      `<h2>DB: ${db.name} (v${db.version})</h2>` +
      db.stores.map((store: StoreDump) =>
        `<div class='store'><h3>Store: ${store.name}</h3>` +
        store.items.map((item: any, idx: number) => `<div class='item'>[${idx}] ${JSON.stringify(item, null, 2)}</div>`).join('') +
        `</div>`
      ).join('')
    ).join('') +
    `</body></html>`;
  return html;
}

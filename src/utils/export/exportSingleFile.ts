// 単一ファイルのエクスポート（ダウンロード）ユーティリティ
export function exportSingleFile(file: { 
  name: string; 
  content: string; 
  isBufferArray?: boolean; 
  bufferContent?: ArrayBuffer 
}) {
  let blob: Blob;
  
  // バイナリファイル（bufferContent）がある場合
  if (file.isBufferArray && file.bufferContent) {
    blob = new Blob([file.bufferContent], { type: 'application/octet-stream' });
  } else {
    blob = new Blob([file.content], { type: 'text/plain' });
  }
  
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

export function exportSingleFile(file: {
  name: string;
  content: string;
  isBufferArray?: boolean;
  bufferContent?: ArrayBuffer;
}) {
  let blob: Blob;

  if (file.isBufferArray && file.bufferContent) {
    blob = new Blob([file.bufferContent], { type: 'application/octet-stream' });
  } else {
    // text/plainじゃなくapplication/octet-streamにする
    blob = new Blob([file.content], { type: 'application/octet-stream' });
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

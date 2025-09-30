// utils/isBufferArray.ts
// ArrayBuffer, Uint8Array, Buffer などバイナリ配列かどうかを判定する関数

export function isBufferArray(obj: any): boolean {
  if (!obj) return false;
  if (typeof ArrayBuffer !== 'undefined' && obj instanceof ArrayBuffer) return true;
  if (typeof Uint8Array !== 'undefined' && obj instanceof Uint8Array) return true;
  // Node.js Buffer
  if (
    typeof Buffer !== 'undefined' &&
    typeof Buffer.isBuffer === 'function' &&
    Buffer.isBuffer(obj)
  )
    return true;
  return false;
}

export const BYTES_PER_ROW = 16;
export const ROW_HEIGHT = 22;
export const VISIBLE_ROWS_BUFFER = 5;

export function toHex(byte: number): string {
  return byte.toString(16).padStart(2, '0').toUpperCase();
}

export function toAscii(byte: number): string {
  if (byte >= 32 && byte <= 126) return String.fromCharCode(byte);
  return '.';
}

export function formatAddress(address: number, length = 8): string {
  return address.toString(16).padStart(length, '0').toUpperCase();
}

export function parseHexInput(value: string): number | null {
  const cleaned = value.replace(/[^0-9a-fA-F]/g, '');
  if (cleaned.length === 0) return null;
  const number = Number.parseInt(cleaned, 16);
  if (Number.isNaN(number) || number < 0 || number > 255) return null;
  return number;
}

export function parseHexString(hex: string): number[] | null {
  const cleaned = hex.replace(/\s/g, '');
  if (!/^[0-9a-fA-F]*$/.test(cleaned)) return null;
  if (cleaned.length === 0 || cleaned.length % 2 !== 0) return null;
  const bytes: number[] = [];
  for (let index = 0; index < cleaned.length; index += 2) {
    bytes.push(Number.parseInt(cleaned.substring(index, index + 2), 16));
  }
  return bytes;
}

export function findByteSequences(data: Uint8Array, search: number[]): number[] {
  const results: number[] = [];
  for (let index = 0; index <= data.length - search.length; index++) {
    let matches = true;
    for (let offset = 0; offset < search.length; offset++) {
      if (data[index + offset] !== search[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) results.push(index);
  }
  return results;
}

export function replaceByteSequence(
  data: Uint8Array,
  offset: number,
  searchLength: number,
  replacement: number[]
): Uint8Array {
  const result = new Uint8Array(data.length - searchLength + replacement.length);
  result.set(data.slice(0, offset));
  result.set(replacement, offset);
  result.set(data.slice(offset + searchLength), offset + replacement.length);
  return result;
}

export function replaceByteSequences(
  data: Uint8Array,
  offsets: number[],
  searchLength: number,
  replacement: number[]
): Uint8Array {
  let result: Uint8Array<ArrayBufferLike> = new Uint8Array(data);
  for (const offset of [...offsets].sort((left, right) => right - left)) {
    result = replaceByteSequence(result, offset, searchLength, replacement);
  }
  return result;
}

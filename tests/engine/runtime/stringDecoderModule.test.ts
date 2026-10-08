import { describe, expect, it } from 'vitest';
import { StringDecoder } from '@/engine/runtime/nodejs/modules/stringDecoderModule';

describe('Node string_decoder builtin', () => {
  it('preserves split UTF-8 characters across writes and end', () => {
    const decoder = new StringDecoder('utf8');
    const value = Buffer.from('猫');

    const decoded =
      decoder.write(value.subarray(0, 1)) +
      decoder.write(value.subarray(1, 2)) +
      decoder.end(value.subarray(2));

    expect(decoded).toBe('猫');
  });

  it('preserves split UTF-16 surrogate pairs', () => {
    const decoder = new StringDecoder('utf16le');
    const value = Buffer.from('😀', 'utf16le');

    const decoded =
      decoder.write(value.subarray(0, 1)) +
      decoder.write(value.subarray(1, 3)) +
      decoder.end(value.subarray(3));

    expect(decoded).toBe('😀');
  });

  it('holds base64 input until complete triplets and pads at end', () => {
    const decoder = new StringDecoder('base64');
    const value = Buffer.from('abcde');

    const decoded =
      decoder.write(value.subarray(0, 1)) +
      decoder.write(value.subarray(1, 4)) +
      decoder.end(value.subarray(4));

    expect(decoded).toBe(value.toString('base64'));
  });
});

import { StringDecoder as BrowserStringDecoder } from 'string_decoder/';
import { describe, expect, it } from 'vitest';
import { StringDecoder } from '@/engine/system/runtime/nodejs/modules/stringDecoderModule';

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

  it('decodes typed arrays and data views as their byte ranges', () => {
    const decoder = new StringDecoder('utf8');
    const bytes = Uint8Array.from([0x78, 0xe7, 0x8c, 0xab, 0x79]);
    const typedArray = bytes.subarray(1, 3);
    const dataView = new DataView(bytes.buffer, bytes.byteOffset + 3, 1);

    expect(decoder.write(typedArray) + decoder.end(dataView)).toBe('猫');
  });

  it('passes string chunks through while retaining pending encoded bytes', () => {
    const decoder = new StringDecoder('utf8');

    const decoded =
      decoder.write(Uint8Array.from([0xe7, 0x8c])) +
      decoder.write(' text ') +
      decoder.end(Uint8Array.from([0xab]));

    expect(decoded).toBe(' text 猫');
  });

  it('flushes pending bytes after an ending string chunk', () => {
    const decoder = new StringDecoder('utf8');
    decoder.write(Uint8Array.from([0xe7, 0x8c]));

    expect(decoder.end(' tail')).toBe(' tail�');
  });

  it('preserves constructor identity and native call-without-new behavior', () => {
    const decoder = new StringDecoder('utf8');

    expect(decoder).toBeInstanceOf(StringDecoder);
    expect(decoder).toBeInstanceOf(BrowserStringDecoder);
    expect(Object.getPrototypeOf(decoder)).toBe(StringDecoder.prototype);
    expect(Object.getPrototypeOf(StringDecoder.prototype)).toBe(BrowserStringDecoder.prototype);
    expect(decoder.write).toBe(StringDecoder.prototype.write);
    expect(() => StringDecoder('utf8')).toThrow(
      "Cannot set properties of undefined (setting 'encoding')"
    );
  });

  it('supports borrowed prototype methods and subclass overrides', () => {
    class DerivedDecoder extends StringDecoder {
      writes = 0;

      override write(input: string | NodeJS.ArrayBufferView): string {
        this.writes += 1;
        return super.write(input);
      }
    }

    const decoder = new DerivedDecoder('utf8');
    const prefix = Uint8Array.from([0xe7, 0x8c]);
    const suffix = new DataView(Uint8Array.from([0xab]).buffer);

    const decoded =
      StringDecoder.prototype.write.call(decoder, prefix) +
      StringDecoder.prototype.end.call(decoder, suffix);

    expect(decoded).toBe('猫');
    expect(decoder.writes).toBe(1);
    expect(BrowserStringDecoder.prototype.write).not.toBe(StringDecoder.prototype.write);
  });

  it('rejects invalid byte inputs with the Node argument error code', () => {
    const decoder = new StringDecoder('utf8');

    expect(() => Reflect.apply(decoder.write, decoder, [null])).toThrow(
      expect.objectContaining({
        name: 'TypeError',
        code: 'ERR_INVALID_ARG_TYPE',
        message:
          'The "buf" argument must be an instance of Buffer, TypedArray, or DataView. Received null',
      })
    );
    expect(() => Reflect.apply(decoder.end, decoder, [null])).toThrow(
      expect.objectContaining({ name: 'TypeError', code: 'ERR_INVALID_ARG_TYPE' })
    );
  });
});

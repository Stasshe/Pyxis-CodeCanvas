import { Buffer } from 'buffer';
import type { RuntimeFsMount } from '@/engine/runtime/storage/RuntimeFsMount';
import { constants } from './constantsModule';

interface DescriptorFlags {
  readable: boolean;
  writable: boolean;
  create: boolean;
  exclusive: boolean;
  truncate: boolean;
  append: boolean;
  noFollow: boolean;
  nonblocking?: boolean;
  directory?: boolean;
}

interface OpenFile {
  path: string;
  offset: number;
  flags: DescriptorFlags;
  fifoEndpointId?: string;
  fifoStat?: ReturnType<RuntimeFsMount['statSync']>;
  characterDevice?: boolean;
}

const stringFlags: Record<string, DescriptorFlags> = {
  r: {
    readable: true,
    writable: false,
    create: false,
    exclusive: false,
    truncate: false,
    append: false,
    noFollow: false,
  },
  'r+': {
    readable: true,
    writable: true,
    create: false,
    exclusive: false,
    truncate: false,
    append: false,
    noFollow: false,
  },
  rs: {
    readable: true,
    writable: false,
    create: false,
    exclusive: false,
    truncate: false,
    append: false,
    noFollow: false,
  },
  'rs+': {
    readable: true,
    writable: true,
    create: false,
    exclusive: false,
    truncate: false,
    append: false,
    noFollow: false,
  },
  w: {
    readable: false,
    writable: true,
    create: true,
    exclusive: false,
    truncate: true,
    append: false,
    noFollow: false,
  },
  'w+': {
    readable: true,
    writable: true,
    create: true,
    exclusive: false,
    truncate: true,
    append: false,
    noFollow: false,
  },
  wx: {
    readable: false,
    writable: true,
    create: true,
    exclusive: true,
    truncate: true,
    append: false,
    noFollow: false,
  },
  'wx+': {
    readable: true,
    writable: true,
    create: true,
    exclusive: true,
    truncate: true,
    append: false,
    noFollow: false,
  },
  xw: {
    readable: false,
    writable: true,
    create: true,
    exclusive: true,
    truncate: true,
    append: false,
    noFollow: false,
  },
  'xw+': {
    readable: true,
    writable: true,
    create: true,
    exclusive: true,
    truncate: true,
    append: false,
    noFollow: false,
  },
  a: {
    readable: false,
    writable: true,
    create: true,
    exclusive: false,
    truncate: false,
    append: true,
    noFollow: false,
  },
  'a+': {
    readable: true,
    writable: true,
    create: true,
    exclusive: false,
    truncate: false,
    append: true,
    noFollow: false,
  },
  as: {
    readable: false,
    writable: true,
    create: true,
    exclusive: false,
    truncate: false,
    append: true,
    noFollow: false,
  },
  'as+': {
    readable: true,
    writable: true,
    create: true,
    exclusive: false,
    truncate: false,
    append: true,
    noFollow: false,
  },
  ax: {
    readable: false,
    writable: true,
    create: true,
    exclusive: true,
    truncate: false,
    append: true,
    noFollow: false,
  },
  'ax+': {
    readable: true,
    writable: true,
    create: true,
    exclusive: true,
    truncate: false,
    append: true,
    noFollow: false,
  },
  xa: {
    readable: false,
    writable: true,
    create: true,
    exclusive: true,
    truncate: false,
    append: true,
    noFollow: false,
  },
  'xa+': {
    readable: true,
    writable: true,
    create: true,
    exclusive: true,
    truncate: false,
    append: true,
    noFollow: false,
  },
};

function fileError(code: string, syscall: string, path: string | number): Error & { code: string } {
  return Object.assign(new Error(`${code}: ${syscall} '${path}'`), { code });
}

function invalidFlags(path: string): never {
  throw fileError('EINVAL', 'open', path);
}

function numericFlags(flags: number, path: string): DescriptorFlags {
  if (!Number.isInteger(flags) || flags < 0) invalidFlags(path);
  const access = flags & 3;
  if (access === 3) invalidFlags(path);
  const known =
    3 |
    constants.O_CREAT |
    constants.O_EXCL |
    constants.O_TRUNC |
    constants.O_APPEND |
    constants.O_SYNC |
    constants.O_DIRECTORY |
    constants.O_NOFOLLOW |
    constants.O_NONBLOCK;
  if ((flags & ~known) !== 0) invalidFlags(path);
  return {
    readable: access !== constants.O_WRONLY,
    writable: access !== constants.O_RDONLY,
    create: (flags & constants.O_CREAT) !== 0,
    exclusive: (flags & constants.O_EXCL) !== 0,
    truncate: (flags & constants.O_TRUNC) !== 0,
    append: (flags & constants.O_APPEND) !== 0,
    noFollow: (flags & constants.O_NOFOLLOW) !== 0,
    nonblocking: (flags & constants.O_NONBLOCK) !== 0,
    directory: (flags & constants.O_DIRECTORY) !== 0,
  };
}

function decodeFlags(flags: string | number, path: string): DescriptorFlags {
  if (typeof flags === 'number') return numericFlags(flags, path);
  if (!Object.hasOwn(stringFlags, flags)) invalidFlags(path);
  const decoded = stringFlags[flags];
  if (!decoded) invalidFlags(path);
  return decoded;
}

function parentPath(path: string): string {
  const separator = path.lastIndexOf('/');
  if (separator <= 0) return '/';
  return path.slice(0, separator);
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function childPath(parent: string, name: string): string {
  if (parent === '/') return `/${name}`;
  return `${parent}/${name}`;
}

function checkRange(length: number, offset: number, count: number): void {
  if (!Number.isInteger(offset) || !Number.isInteger(count) || offset < 0 || count < 0) {
    throw new RangeError('Invalid typed array offset or length.');
  }
  if (offset + count > length) throw new RangeError('Offset is outside the bounds of the buffer.');
}

export class RuntimeFsDescriptors {
  private readonly files = new Map<number, OpenFile>();
  private nextDescriptor = 3;

  constructor(
    private readonly filesystem: RuntimeFsMount,
    private readonly writeStdout: (data: Uint8Array) => void,
    private readonly writeStderr: (data: Uint8Array) => void
  ) {}

  openSync(path: string, flags: string | number): number {
    const decoded = decodeFlags(flags, path);
    const entry = this.filesystem.lstatSync(path);
    if (entry && decoded.exclusive && decoded.create) throw fileError('EEXIST', 'open', path);
    if (entry?.type === 'symlink' && decoded.noFollow) throw fileError('ELOOP', 'open', path);
    const target = this.resolveTarget(path, decoded.create);
    let stat = this.filesystem.statSync(target);
    if (decoded.create && decoded.exclusive) {
      if (stat) throw fileError('EEXIST', 'open', path);
      this.filesystem.writeRangeSync(target, new Uint8Array(), 0, true, true);
      stat = this.filesystem.statSync(target);
    } else if (!stat && decoded.create) {
      this.filesystem.writeRangeSync(target, new Uint8Array(), 0, true);
      stat = this.filesystem.statSync(target);
    }
    if (!stat) throw fileError('ENOENT', 'open', path);
    if (stat.type === 'directory' && decoded.directory !== true) {
      throw fileError('EISDIR', 'open', path);
    }
    if (stat.type !== 'directory' && decoded.directory === true) {
      throw fileError('ENOTDIR', 'open', path);
    }
    if (stat.type === 'fifo') {
      let mode: 'read' | 'write' | 'readwrite' = 'read';
      if (decoded.readable && decoded.writable) mode = 'readwrite';
      else if (decoded.writable) mode = 'write';
      const endpointId = crypto.randomUUID();
      this.filesystem.openFifoSync(target, mode, endpointId, decoded.nonblocking === true);
      const descriptor = this.nextDescriptor;
      this.nextDescriptor += 1;
      this.files.set(descriptor, {
        path: target,
        offset: 0,
        flags: decoded,
        fifoEndpointId: endpointId,
        fifoStat: stat,
      });
      return descriptor;
    }
    if (entry && decoded.truncate && decoded.writable && stat.type !== 'characterDevice') {
      this.filesystem.setFileSync(target, new Uint8Array());
    }

    const descriptor = this.nextDescriptor;
    this.nextDescriptor += 1;
    this.files.set(descriptor, {
      path: target,
      offset: 0,
      flags: decoded,
      characterDevice: stat.type === 'characterDevice',
    });
    return descriptor;
  }

  readSync(
    descriptor: number,
    buffer: Uint8Array,
    offset = 0,
    length = buffer.byteLength - offset,
    position: number | null = null
  ): number {
    const file = this.file(descriptor, 'read');
    if (file.flags.directory === true) throw fileError('EISDIR', 'read', file.path);
    if (!file.flags.readable) throw fileError('EBADF', 'read', descriptor);
    checkRange(buffer.byteLength, offset, length);
    if (file.fifoEndpointId) {
      if (position !== null) throw fileError('ESPIPE', 'read', file.path);
      if (length === 0) return 0;
      const chunk = this.filesystem.readFifoSync(file.fifoEndpointId, length);
      buffer.set(chunk.subarray(0, length), offset);
      return Math.min(chunk.byteLength, length);
    }
    const start = position ?? file.offset;
    if (!Number.isInteger(start) || start < 0) throw new RangeError('Invalid file position.');
    const content = this.filesystem.getFileSync(file.path);
    if (!content) throw fileError('ENOENT', 'read', file.path);
    const count = Math.min(length, content.byteLength - start);
    if (count <= 0) return 0;
    buffer.set(content.subarray(start, start + count), offset);
    if (position === null) file.offset = start + count;
    return count;
  }

  writeSync(
    descriptor: number,
    data: string | Uint8Array,
    offsetOrPosition?: number | null,
    lengthOrEncoding?: number | BufferEncoding,
    position?: number | null
  ): number {
    if (descriptor === 1 || descriptor === 2) {
      let encoding: BufferEncoding = 'utf8';
      if (typeof lengthOrEncoding === 'string') encoding = lengthOrEncoding;
      let bytes: Uint8Array;
      if (typeof data === 'string') bytes = Buffer.from(data, encoding);
      else {
        const offset = offsetOrPosition ?? 0;
        let length = data.byteLength - offset;
        if (typeof lengthOrEncoding === 'number') length = lengthOrEncoding;
        checkRange(data.byteLength, offset, length);
        bytes = data.subarray(offset, offset + length);
      }
      if (descriptor === 1) this.writeStdout(bytes);
      else this.writeStderr(bytes);
      return bytes.byteLength;
    }
    if (typeof data === 'string') {
      let encoding: BufferEncoding = 'utf8';
      if (typeof lengthOrEncoding === 'string') encoding = lengthOrEncoding;
      const bytes = Buffer.from(data, encoding);
      let writePosition: number | null = null;
      if (offsetOrPosition !== undefined) writePosition = offsetOrPosition;
      return this.writeBuffer(descriptor, bytes, 0, bytes.byteLength, writePosition);
    }
    const offset = offsetOrPosition ?? 0;
    let length = data.byteLength - offset;
    if (typeof lengthOrEncoding === 'number') length = lengthOrEncoding;
    let writePosition = position;
    if (writePosition === undefined) writePosition = null;
    return this.writeBuffer(descriptor, data, offset, length, writePosition);
  }

  closeSync(descriptor: number): void {
    const file = this.file(descriptor, 'close');
    try {
      if (file.fifoEndpointId) this.filesystem.closeFifoSync(file.fifoEndpointId);
    } finally {
      this.files.delete(descriptor);
    }
  }

  statSync(descriptor: number): ReturnType<RuntimeFsMount['statSync']> {
    const file = this.file(descriptor, 'fstat');
    if (file.fifoStat) return file.fifoStat;
    return this.filesystem.statSync(file.path);
  }

  private writeBuffer(
    descriptor: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    requestedPosition: number | null
  ): number {
    const file = this.file(descriptor, 'write');
    if (file.flags.directory === true) throw fileError('EISDIR', 'write', file.path);
    if (!file.flags.writable) throw fileError('EBADF', 'write', descriptor);
    checkRange(buffer.byteLength, offset, length);
    if (file.fifoEndpointId) {
      if (requestedPosition !== null) throw fileError('ESPIPE', 'write', file.path);
      if (length === 0) return 0;
      return this.filesystem.writeFifoSync(
        file.fifoEndpointId,
        buffer.subarray(offset, offset + length)
      );
    }
    let start = requestedPosition;
    if (start !== null && (!Number.isInteger(start) || start < 0)) {
      throw new RangeError('Invalid file position.');
    }
    if (file.flags.append) start = null;
    if (start === null) start = file.offset;
    if (!Number.isInteger(start) || start < 0) throw new RangeError('Invalid file position.');
    let rangePosition: number | null = file.characterDevice ? null : start;
    if (file.flags.append) rangePosition = null;
    const endingOffset = this.filesystem.writeRangeSync(
      file.path,
      buffer.subarray(offset, offset + length),
      rangePosition,
      false
    );
    if (requestedPosition === null && !file.characterDevice) file.offset = endingOffset;
    return length;
  }

  private file(descriptor: number, syscall: string): OpenFile {
    const file = this.files.get(descriptor);
    if (!file) throw fileError('EBADF', syscall, descriptor);
    return file;
  }

  private resolveTarget(path: string, create: boolean, depth = 0): string {
    const entry = this.filesystem.lstatSync(path);
    if (entry?.type === 'symlink') {
      if (depth >= 40) throw fileError('ELOOP', 'open', path);
      if (!create) return this.filesystem.realpathSync(path);
      const linkTarget = this.filesystem.readlinkSync(path);
      let nextPath = linkTarget;
      if (!linkTarget.startsWith('/')) nextPath = `${parentPath(path)}/${linkTarget}`;
      return this.resolveTarget(nextPath, true, depth + 1);
    }
    if (entry) return this.filesystem.realpathSync(path);
    if (!create) throw fileError('ENOENT', 'open', path);
    const parent = parentPath(path);
    const directory = this.filesystem.statSync(parent);
    if (!directory) throw fileError('ENOENT', 'open', parent);
    if (directory.type !== 'directory') throw fileError('ENOTDIR', 'open', parent);
    return childPath(this.filesystem.realpathSync(parent), basename(path));
  }
}

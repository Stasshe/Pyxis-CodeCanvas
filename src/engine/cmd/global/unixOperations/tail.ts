import { UnixCommandBase } from './base'

export class TailCommand extends UnixCommandBase {
  async execute(args: string[]): Promise<string> {
    const { positional } = this.parseOptions(args)
    if (positional.length === 0) {
      throw new Error('tail: missing file operand')
    }
    const file = positional[0]
    const nArg = args.find(a => a.startsWith('-n')) || '-n10'
    const n = Number.parseInt(nArg.replace('-n', '')) || 10

    const path = this.normalizePath(this.resolvePath(file))
    const isDir = await this.isDirectory(path)
    if (isDir) throw new Error('Is a directory')

    try {
      const relative = this.getRelativePathFromProject(path)
      const file = await this.getFileFromDB(relative)
      if (!file) throw new Error('No such file or directory')

      let content = ''
      if (file.isBufferArray && file.bufferContent) {
        const decoder = new TextDecoder('utf-8')
        content = decoder.decode(file.bufferContent as ArrayBuffer)
      } else if (typeof file.content === 'string') {
        content = file.content
      }

      const lines = content.split(/\r?\n/)
      return lines.slice(Math.max(lines.length - n, 0)).join('\n')
    } catch (e) {
      throw new Error(`tail: ${file}: No such file or directory`)
    }
  }
}

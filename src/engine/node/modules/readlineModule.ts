/**
 * [NEW ARCHITECTURE] readline モジュールのエミュレーション
 *
 * ## 動作モード
 * 1. Terminal経由でnodeコマンドで実行: Terminalの入力インターフェースを使用
 * 2. RunPanel経由で実行: DebugConsoleAPIを使用
 *
 * onInput callbackが渡された場合はそれを優先的に使用
 */

interface ReadlineOptions {
  input?: any
  output?: any
  terminal?: boolean
  prompt?: string
  historySize?: number
}

class Interface {
  public input: any
  public output: any
  public terminal: boolean
  public promptStr = '> '
  private listeners: { [event: string]: Function[] } = {}
  private closed = false
  // Expose `history` to better match Node's API (most modules access rl.history)
  public history: string[] = []
  public historySize?: number
  private _inputBuffer = ''
  private _inputListener?: (chunk: any) => void
  private _lineConsumer?: (line: string) => boolean

  constructor(options: ReadlineOptions) {
    this.input = options.input
    this.output = options.output
    this.terminal = options.terminal ?? false
    this.historySize = options.historySize

    if (options.prompt) {
      this.promptStr = options.prompt
    }

    // If an input stream is provided, attach a data listener to collect lines
    if (this.input && typeof this.input.on === 'function') {
      this._attachInputListener()
    }
  }

  on(event: string, listener: Function): this {
    if (!this.listeners[event]) {
      this.listeners[event] = []
    }
    this.listeners[event].push(listener)
    return this
  }

  once(event: string, listener: Function): this {
    const onceWrapper = (...args: any[]) => {
      listener(...args)
      this.removeListener(event, onceWrapper)
    }
    return this.on(event, onceWrapper)
  }

  emit(event: string, ...args: any[]): boolean {
    const listeners = this.listeners[event]
    if (listeners && listeners.length > 0) {
      for (const listener of listeners) {
        try {
          listener(...args)
        } catch (error) {
          console.error('Error in event listener:', error)
        }
      }
      return true
    }
    return false
  }

  removeListener(event: string, listener: Function): this {
    const listeners = this.listeners[event]
    if (listeners) {
      const index = listeners.indexOf(listener)
      if (index !== -1) {
        listeners.splice(index, 1)
      }
    }
    return this
  }

  // Match Node's readline.Interface.question(callback style)
  question(query: string, callback?: (answer: string) => void): void {
    // プロンプトを表示
    if (this.output && this.output.write) {
      this.output.write(query)
    }

    // Reserve the next 'line' exclusively for this question to avoid duplicate
    // delivery to other 'line' listeners when question() is used alongside
    // a general 'line' handler. The consumer should return true if it fully
    // consumed the line (so we skip normal emit), or false to allow normal
    // delivery.
    this._lineConsumer = (answer: string) => {
      try {
        if (typeof answer === 'string' && answer.length > 0) this._pushHistory(answer)
        if (callback) callback(answer)
      } finally {
        this._lineConsumer = undefined
      }
      return true
    }
  }

  // Promise-based helper similar to util.promisify(rl.question)
  // NOTE: Node's readline does not provide questionAsync; omitted for parity.

  // Internal helper to add to history honoring options
  private _pushHistory(entry: string) {
    if (!entry) return
    this.history.unshift(entry)
    if (typeof this.historySize === 'number' && this.history.length > this.historySize) {
      this.history.length = this.historySize
    }
  }

  // Attach a simple data listener on the input stream that emits 'line' on newline and 'SIGINT' on Ctrl-C
  private _attachInputListener() {
    if (!this.input || !this.input.on) return
    if (this._inputListener) return // already attached

    this._inputListener = (chunk: any) => {
      try {
        const str = chunk instanceof Buffer ? chunk.toString('utf8') : String(chunk)
        for (let i = 0; i < str.length; i++) {
          const ch = str[i]
          // Ctrl-C
          if (ch === '\x03') {
            this.emit('SIGINT')
            continue
          }
          this._inputBuffer += ch
          if (ch === '\n' || ch === '\r') {
            // normalize and trim trailing CR/LF
            const line = this._inputBuffer.replace(/\r?\n$/, '').replace(/\r$/, '')
            this._inputBuffer = ''

            // If a question() has registered an exclusive consumer, give it
            // the first chance to handle the line. If it returns true, skip
            // normal emission to other listeners.
            try {
              if (this._lineConsumer) {
                const consumed = this._lineConsumer(line)
                if (consumed) continue
              }
            } catch (err) {
              console.error('Error in line consumer:', err)
            }

            this.emit('line', line)
          }
        }
      } catch (err) {
        console.error('Error parsing input chunk for readline:', err)
      }
    }

    this.input.on('data', this._inputListener)
    // also listen for end/close to emit 'close' if needed
    const onEnd = () => this.close()
    this.input.on('end', onEnd)
    this.input.on('close', onEnd)
  }

  private _detachInputListener() {
    if (!this.input || !this.input.on || !this._inputListener) return
    this.input.removeListener('data', this._inputListener)
    this._inputListener = undefined
  }

  setPrompt(prompt: string): void {
    this.promptStr = prompt
  }

  prompt(preserveCursor?: boolean): void {
    if (!this.closed && this.output && this.output.write) {
      this.output.write(this.promptStr)
    }
  }

  write(data: string): void {
    if (!this.closed && this.output && this.output.write) {
      this.output.write(data)
    }
  }

  pause(): this {
    return this
  }

  resume(): this {
    return this
  }

  close(): void {
    if (!this.closed) {
      this.closed = true
      this._detachInputListener()
      this.emit('close')
    }
  }
}

const cursorTo = (stream: any, x: number, y?: number): boolean => {
  if (!stream || !stream.write) return false

  if (y !== undefined) {
    stream.write(`\x1b[${y + 1};${x + 1}H`)
  } else {
    stream.write(`\x1b[${x + 1}G`)
  }
  return true
}

const moveCursor = (stream: any, dx: number, dy: number): boolean => {
  if (!stream || !stream.write) return false

  if (dy !== 0) stream.write(`\x1b[${Math.abs(dy)}${dy > 0 ? 'B' : 'A'}`)
  if (dx !== 0) stream.write(`\x1b[${Math.abs(dx)}${dx > 0 ? 'C' : 'D'}`)
  return true
}

const clearLine = (stream: any, dir = 0): boolean => {
  if (!stream || !stream.write) return false

  if (dir < 0) stream.write('\x1b[1K')
  else if (dir > 0) stream.write('\x1b[0K')
  else stream.write('\x1b[2K')
  return true
}

const clearScreenDown = (stream: any): boolean => {
  if (!stream || !stream.write) return false

  stream.write('\x1b[0J')
  return true
}

export function createReadlineModule(
  onInput?: (prompt: string, callback: (input: string) => void) => void
) {
  // create a lightweight pseudo-stdin stream that other parts can listen to.
  // This stream implements `on('data', fn)`, `removeListener`, `once`, `setRawMode`, `pause`, `resume`.
  const dataListeners: Array<(chunk: any) => void> = []
  const onceListeners: Array<(chunk: any) => void> = []

  const pseudoStdin = {
    on(event: string, fn: (chunk: any) => void) {
      if (event === 'data') {
        dataListeners.push(fn)
      }
      return this
    },
    once(event: string, fn: (chunk: any) => void) {
      if (event === 'data') {
        onceListeners.push(fn)
      }
      return this
    },
    removeListener(event: string, fn: (chunk: any) => void) {
      if (event === 'data') {
        const i = dataListeners.indexOf(fn)
        if (i !== -1) dataListeners.splice(i, 1)
      }
      return this
    },
    // Compatibility stubs
    setRawMode: (mode: boolean) => {},
    pause: () => {},
    resume: () => {},
    isTTY: true,
  } as any

  // helper to emit data to listeners (simulate Buffer or string chunk)
  const emitData = (chunk: string) => {
    try {
      // Emit to regular listeners
      for (const l of dataListeners.slice()) {
        try {
          l(Buffer.from(chunk, 'utf8'))
        } catch (e) {
          try {
            l(chunk)
          } catch (_) {}
        }
      }
      // Emit once listeners and clear them
      for (const l of onceListeners.splice(0, onceListeners.length)) {
        try {
          l(Buffer.from(chunk, 'utf8'))
        } catch (e) {
          try {
            l(chunk)
          } catch (_) {}
        }
      }
    } catch (err) {
      console.error('Error emitting pseudo stdin data:', err)
    }
  }

  return {
    createInterface: (options: ReadlineOptions): Interface => {
      // Choose input stream with attention to sandboxed process.stdin.
      // Rules:
      // - If caller explicitly passed the real host `process.stdin`, use it.
      // - If an onInput handler is provided (RunPanel/DebugConsole), prefer pseudoStdin
      //   so GUI-driven input is used instead of the sandbox's stubbed stdin.
      // - Otherwise, if options.input is provided, use it.
      // - Otherwise fall back to host process.stdin if available, else pseudoStdin.
      let input: any
      const hostStdin =
        typeof process !== 'undefined' && (process as any).stdin
          ? (process as any).stdin
          : undefined

      if (options.input && options.input === hostStdin) {
        // Caller explicitly passed the real host stdin
        input = options.input
      } else if (onInput) {
        // GUI-driven run: prefer pseudoStdin so DebugConsole can drive input
        input = pseudoStdin
      } else if (options.input && typeof options.input.on === 'function') {
        // Use provided input (likely from a true stream)
        input = options.input
      } else if (hostStdin && typeof hostStdin.on === 'function') {
        input = hostStdin
      } else {
        input = pseudoStdin
      }

      const iface = new Interface({ ...options, input })

      // Only attach host-driven wrappers when we're using the pseudoStdin
      // (i.e. not a real terminal stdin) and an onInput handler is provided.
      if (onInput && input === pseudoStdin) {
        const origPrompt = iface.prompt.bind(iface)
        iface.prompt = (preserveCursor?: boolean) => {
          try {
            onInput(iface.promptStr ?? '', (val: string) => {
              emitData(val + '\n')
            })
          } catch (err) {
            console.error('Error calling onInput handler:', err)
          }
          return origPrompt(preserveCursor)
        }

        const origQuestion = iface.question.bind(iface)
        iface.question = (query: string, callback?: (answer: string) => void) => {
          if (iface.output && iface.output.write) {
            iface.output.write(query)
          }
          try {
            onInput(query, (val: string) => {
              emitData(val + '\n')
              if (callback) callback(val)
            })
          } catch (err) {
            console.error('Error calling onInput handler for question:', err)
            if (callback) callback('')
          }
        }
      }

      return iface
    },
    Interface: Interface,
    cursorTo,
    moveCursor,
    clearLine,
    clearScreenDown,
    // expose helper for tests/debugging
    _emitPseudoStdin: emitData,
  }
}

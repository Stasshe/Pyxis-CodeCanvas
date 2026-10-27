import { UnicodeGraphemesAddon } from '@xterm/addon-unicode-graphemes';
import {
  type ITerminalOptions,
  type IUnicodeHandling,
  type IUnicodeVersionProvider,
  Terminal,
} from '@xterm/xterm';

export class UnicodeTerminal extends Terminal {
  private readonly providers = new Map<string, IUnicodeVersionProvider>();

  constructor(options: ITerminalOptions = {}) {
    super({ ...options, allowProposedApi: true });
    const unicode = this.unicode;
    const facade: IUnicodeHandling = {
      register: provider => {
        this.providers.set(provider.version, provider);
        unicode.register(provider);
      },
      get versions() {
        return unicode.versions;
      },
      get activeVersion() {
        return unicode.activeVersion;
      },
      set activeVersion(version: string) {
        unicode.activeVersion = version;
      },
    };
    Object.defineProperty(this, 'unicode', {
      value: facade,
      writable: false,
      configurable: false,
      enumerable: true,
    });
    this.loadAddon(new UnicodeGraphemesAddon());
  }

  public cellWidth(text: string): number {
    const version = this.unicode.activeVersion;
    const provider = this.providers.get(version);
    if (!provider) throw new Error(`No Unicode provider registered for version: ${version}`);

    let width = 0;
    let previousProperties = 0;
    for (const character of text) {
      const codePoint = character.codePointAt(0);
      if (codePoint === undefined) continue;
      const properties = provider.charProperties(codePoint, previousProperties);
      // Match xterm 6's UnicodeService.extractWidth/extractShouldJoin protocol:
      // https://github.com/xtermjs/xterm.js/blob/6.0.0/src/common/services/UnicodeService.ts
      let characterWidth = (properties >> 1) & 0x3;
      if ((properties & 1) !== 0) characterWidth -= (previousProperties >> 1) & 0x3;
      width += characterWidth;
      previousProperties = properties;
    }
    return width;
  }
}

// Token types for comprehensive syntax highlighting
export type TokenType =
  | 'keyword'
  | 'controlKeyword'
  | 'storageKeyword'
  | 'function'
  | 'method'
  | 'string'
  | 'templateString'
  | 'regex'
  | 'comment'
  | 'docComment'
  | 'number'
  | 'boolean'
  | 'null'
  | 'operator'
  | 'comparison'
  | 'arrow'
  | 'property'
  | 'variable'
  | 'type'
  | 'typeParameter'
  | 'class'
  | 'decorator'
  | 'attribute'
  | 'tag'
  | 'tagBracket'
  | 'punctuation'
  | 'bracket'
  | 'brace'
  | 'paren'
  | 'semicolon'
  | 'comma'
  | 'whitespace'
  | 'identifier'
  | 'constant'
  | 'builtin'
  | 'macro'
  | 'preprocessor'
  | 'text';

export interface Token {
  type: TokenType;
  value: string;
}

export interface PatternDef {
  type: TokenType;
  regex: RegExp;
}

// Language-specific pattern sets
export const createPatterns = (lang: string): PatternDef[] => {
  const normalizedLang = lang.toLowerCase();

  // Common patterns across languages
  const commonPatterns: PatternDef[] = [
    { type: 'whitespace', regex: /^[\s]+/ },
    { type: 'text', regex: /^./ },
  ];

  // JavaScript/TypeScript patterns - note: template strings are handled specially in tokenizeJsTs
  const jstsPatterns: PatternDef[] = [
    { type: 'docComment', regex: /^\/\*\*[\s\S]*?\*\// },
    { type: 'comment', regex: /^\/\*[\s\S]*?\*\// },
    { type: 'comment', regex: /^\/\/[^\n]*/ },
    // Template strings handled by tokenizeJsTs for proper ${} support with nested templates
    { type: 'string', regex: /^"(?:[^"\\]|\\[\s\S])*?"/ },
    { type: 'string', regex: /^'(?:[^'\\]|\\[\s\S])*?'/ },
    {
      type: 'regex',
      regex: /^\/(?!\/)(?:[^/\\[\n]|\\[\s\S]|\[[^\]\\]*(?:\\[\s\S][^\]\\]*)*\])+\/[gimsy]*/,
    },
    { type: 'decorator', regex: /^@[a-zA-Z_$][a-zA-Z0-9_$]*/ },
    {
      type: 'tag',
      regex:
        /^<[a-zA-Z][a-zA-Z0-9.]*(?:\s+[a-zA-Z_:][a-zA-Z0-9_:.]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|\{[^}]*\}))?)*\s*\/>/,
    },
    {
      type: 'tag',
      regex:
        /^<[a-zA-Z][a-zA-Z0-9.]*(?:\s+[a-zA-Z_:][a-zA-Z0-9_:.]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|\{[^}]*\}))?)*\s*>/,
    },
    { type: 'tag', regex: /^<\/[a-zA-Z][a-zA-Z0-9.]*\s*>/ },
    {
      type: 'type',
      regex:
        /^:\s*(?:string|number|boolean|any|void|never|unknown|null|undefined|object|symbol|bigint)\b/,
    },
    { type: 'arrow', regex: /^=>/ },
    {
      type: 'controlKeyword',
      regex:
        /^(?:if|else|switch|case|default|for|while|do|break|continue|return|throw|try|catch|finally)\b/,
    },
    {
      type: 'storageKeyword',
      regex:
        /^(?:const|let|var|function|class|interface|type|enum|namespace|module|declare|abstract|readonly|static|public|private|protected|async|await|yield|export|import|from|as|extends|implements|new)\b/,
    },
    { type: 'null', regex: /^(?:null|undefined)\b/ },
    { type: 'boolean', regex: /^(?:true|false)\b/ },
    {
      type: 'builtin',
      regex:
        /^(?:Array|Object|String|Number|Boolean|Function|Symbol|Map|Set|WeakMap|WeakSet|Promise|Date|RegExp|Error|Math|JSON|console|window|document|globalThis|process)\b/,
    },
    { type: 'class', regex: /^[A-Z][a-zA-Z0-9_$]*(?=\s*[({<])/ },
    { type: 'type', regex: /^[A-Z][a-zA-Z0-9_$]*(?=\s*[,;)\]|&>])/ },
    { type: 'method', regex: /^[a-zA-Z_$][a-zA-Z0-9_$]*(?=\s*\()/ },
    { type: 'property', regex: /^\.([a-zA-Z_$][a-zA-Z0-9_$]*)/ },
    {
      type: 'number',
      regex: /^(?:0x[0-9a-fA-F]+n?|0b[01]+n?|0o[0-7]+n?|\d+\.?\d*(?:[eE][+-]?\d+)?n?)\b/,
    },
    { type: 'comparison', regex: /^(?:===|!==|==|!=|<=|>=|<|>)/ },
    { type: 'operator', regex: /^(?:&&|\|\||>>>|>>|<<|[+\-*/%|&^~!]=?|\?\?|\?\.?)/ },
    { type: 'operator', regex: /^(?:\+=|-=|\*=|\/=|%=|&&=|\|\|=|\?\?=|<<=|>>=|>>>=|&=|\|=|\^=|=)/ },
    { type: 'operator', regex: /^[?:]/ },
    { type: 'operator', regex: /^\.\.\./ },
    { type: 'bracket', regex: /^[[\]]/ },
    { type: 'brace', regex: /^[{}]/ },
    { type: 'paren', regex: /^[()]/ },
    { type: 'semicolon', regex: /^;/ },
    { type: 'comma', regex: /^,/ },
    { type: 'punctuation', regex: /^\./ },
    { type: 'constant', regex: /^[A-Z][A-Z0-9_]+\b/ },
    { type: 'identifier', regex: /^[a-zA-Z_$][a-zA-Z0-9_$]*/ },
  ];

  // Python patterns
  const pythonPatterns: PatternDef[] = [
    { type: 'docComment', regex: /^"""[\s\S]*?"""/ },
    { type: 'docComment', regex: /^'''[\s\S]*?'''/ },
    { type: 'comment', regex: /^#[^\n]*/ },
    { type: 'templateString', regex: /^[fFrRbBuU]*"""[\s\S]*?"""/ },
    { type: 'templateString', regex: /^[fFrRbBuU]*'''[\s\S]*?'''/ },
    { type: 'templateString', regex: /^[fFrRbBuU]*"(?:[^"\\]|\\[\s\S])*?"/ },
    { type: 'templateString', regex: /^[fFrRbBuU]*'(?:[^'\\]|\\[\s\S])*?'/ },
    { type: 'string', regex: /^"(?:[^"\\]|\\[\s\S])*?"/ },
    { type: 'string', regex: /^'(?:[^'\\]|\\[\s\S])*?'/ },
    { type: 'decorator', regex: /^@[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*/ },
    {
      type: 'controlKeyword',
      regex:
        /^(?:if|elif|else|for|while|break|continue|pass|return|raise|try|except|finally|with|assert|yield|match|case)\b/,
    },
    {
      type: 'storageKeyword',
      regex: /^(?:def|class|lambda|import|from|as|global|nonlocal|async|await|del)\b/,
    },
    { type: 'boolean', regex: /^(?:True|False)\b/ },
    { type: 'null', regex: /^None\b/ },
    {
      type: 'builtin',
      regex:
        /^(?:print|len|range|str|int|float|list|dict|set|tuple|bool|type|isinstance|hasattr|getattr|setattr|open|input|sorted|reversed|enumerate|zip|map|filter|reduce|sum|min|max|abs|round|pow|format|repr|id|dir|vars|help|super|property|classmethod|staticmethod)\b/,
    },
    {
      type: 'builtin',
      regex:
        /^(?:Exception|TypeError|ValueError|KeyError|IndexError|AttributeError|ImportError|RuntimeError|StopIteration|OSError|IOError|FileNotFoundError|NotImplementedError|ZeroDivisionError)\b/,
    },
    { type: 'method', regex: /^__[a-zA-Z_][a-zA-Z0-9_]*__/ },
    {
      type: 'type',
      regex:
        /^(?:Optional|Union|List|Dict|Set|Tuple|Callable|Any|NoReturn|ClassVar|Final|Literal|TypeVar|Generic|Protocol|TypedDict|Awaitable|Coroutine|AsyncGenerator|Iterator|Iterable|Mapping|Sequence|MutableMapping|MutableSequence)\b/,
    },
    { type: 'class', regex: /^[A-Z][a-zA-Z0-9_]*(?=\s*[:(])/ },
    { type: 'method', regex: /^[a-zA-Z_][a-zA-Z0-9_]*(?=\s*\()/ },
    { type: 'property', regex: /^\.([a-zA-Z_][a-zA-Z0-9_]*)/ },
    {
      type: 'number',
      regex: /^(?:0x[0-9a-fA-F]+|0b[01]+|0o[0-7]+|\d+\.?\d*(?:[eE][+-]?\d+)?j?)\b/,
    },
    { type: 'comparison', regex: /^(?:==|!=|<=|>=|<>|<|>)/ },
    {
      type: 'operator',
      regex:
        /^(?:\*\*|\/\/|@|:=|->|[+\-*/%|&^~]=?|not\s+in\b|is\s+not\b|not\b|and\b|or\b|in\b|is\b)/,
    },
    { type: 'bracket', regex: /^[[\]]/ },
    { type: 'brace', regex: /^[{}]/ },
    { type: 'paren', regex: /^[()]/ },
    { type: 'semicolon', regex: /^:/ },
    { type: 'comma', regex: /^,/ },
    { type: 'punctuation', regex: /^\./ },
    { type: 'constant', regex: /^[A-Z][A-Z0-9_]+\b/ },
    { type: 'identifier', regex: /^[a-zA-Z_][a-zA-Z0-9_]*/ },
  ];

  // Rust patterns
  const rustPatterns: PatternDef[] = [
    { type: 'docComment', regex: /^\/\/\/[^\n]*/ },
    { type: 'docComment', regex: /^\/\/![^\n]*/ },
    { type: 'comment', regex: /^\/\*[\s\S]*?\*\// },
    { type: 'comment', regex: /^\/\/[^\n]*/ },
    { type: 'string', regex: /^r#*"[\s\S]*?"#*/ },
    { type: 'string', regex: /^b"(?:[^"\\]|\\[\s\S])*?"/ },
    { type: 'string', regex: /^"(?:[^"\\]|\\[\s\S])*?"/ },
    { type: 'string', regex: /^'(?:[^'\\]|\\[\s\S])'/ },
    { type: 'attribute', regex: /^#!?\[[^\]]*\]/ },
    { type: 'typeParameter', regex: /^'[a-zA-Z_][a-zA-Z0-9_]*\b/ },
    { type: 'macro', regex: /^[a-zA-Z_][a-zA-Z0-9_]*!/ },
    {
      type: 'controlKeyword',
      regex: /^(?:if|else|match|loop|while|for|break|continue|return|yield)\b/,
    },
    {
      type: 'storageKeyword',
      regex:
        /^(?:fn|let|mut|const|static|struct|enum|trait|impl|type|pub|crate|mod|use|extern|self|Self|super|async|await|dyn|ref|move|unsafe|where|in|as)\b/,
    },
    { type: 'boolean', regex: /^(?:true|false)\b/ },
    {
      type: 'builtin',
      regex:
        /^(?:i8|i16|i32|i64|i128|isize|u8|u16|u32|u64|u128|usize|f32|f64|bool|char|str|String|Vec|Option|Result|Box|Rc|Arc|Cell|RefCell|HashMap|HashSet|BTreeMap|BTreeSet|VecDeque|LinkedList|BinaryHeap)\b/,
    },
    { type: 'type', regex: /^[A-Z][a-zA-Z0-9_]*/ },
    { type: 'method', regex: /^[a-z_][a-zA-Z0-9_]*(?=\s*[(<])/ },
    { type: 'property', regex: /^\.([a-z_][a-zA-Z0-9_]*)/ },
    {
      type: 'number',
      regex:
        /^(?:0x[0-9a-fA-F_]+|0b[01_]+|0o[0-7_]+|\d[\d_]*\.?[\d_]*(?:[eE][+-]?[\d_]+)?)[iu]?(?:8|16|32|64|128|size)?/,
    },
    { type: 'comparison', regex: /^(?:==|!=|<=|>=|<|>)/ },
    { type: 'arrow', regex: /^(?:->|=>)/ },
    { type: 'operator', regex: /^(?:&&|\|\||[+\-*/%|&^!]=?|\.\.=?|::|\?)/ },
    { type: 'bracket', regex: /^[[\]]/ },
    { type: 'brace', regex: /^[{}]/ },
    { type: 'paren', regex: /^[()]/ },
    { type: 'semicolon', regex: /^;/ },
    { type: 'comma', regex: /^,/ },
    { type: 'punctuation', regex: /^\./ },
    { type: 'constant', regex: /^[A-Z][A-Z0-9_]+\b/ },
    { type: 'identifier', regex: /^[a-zA-Z_][a-zA-Z0-9_]*/ },
  ];

  // Go patterns
  const goPatterns: PatternDef[] = [
    { type: 'comment', regex: /^\/\*[\s\S]*?\*\// },
    { type: 'comment', regex: /^\/\/[^\n]*/ },
    { type: 'string', regex: /^`[^`]*`/ },
    { type: 'string', regex: /^"(?:[^"\\]|\\[\s\S])*?"/ },
    { type: 'string', regex: /^'(?:[^'\\]|\\[\s\S])'/ },
    {
      type: 'controlKeyword',
      regex:
        /^(?:if|else|switch|case|default|for|range|break|continue|goto|return|fallthrough|select)\b/,
    },
    {
      type: 'storageKeyword',
      regex: /^(?:func|var|const|type|struct|interface|map|chan|package|import|defer|go)\b/,
    },
    { type: 'boolean', regex: /^(?:true|false)\b/ },
    { type: 'null', regex: /^nil\b/ },
    {
      type: 'builtin',
      regex:
        /^(?:int|int8|int16|int32|int64|uint|uint8|uint16|uint32|uint64|uintptr|float32|float64|complex64|complex128|bool|byte|rune|string|error|any)\b/,
    },
    {
      type: 'builtin',
      regex:
        /^(?:make|new|len|cap|append|copy|delete|close|panic|recover|print|println|complex|real|imag)\b/,
    },
    { type: 'type', regex: /^[A-Z][a-zA-Z0-9_]*/ },
    { type: 'method', regex: /^[a-zA-Z_][a-zA-Z0-9_]*(?=\s*\()/ },
    { type: 'property', regex: /^\.([a-zA-Z_][a-zA-Z0-9_]*)/ },
    {
      type: 'number',
      regex: /^(?:0x[0-9a-fA-F]+|0b[01]+|0o[0-7]+|\d+\.?\d*(?:[eE][+-]?\d+)?i?)\b/,
    },
    { type: 'comparison', regex: /^(?:==|!=|<=|>=|<|>)/ },
    { type: 'arrow', regex: /^<-/ },
    { type: 'operator', regex: /^(?:&&|\|\||:=|[+\-*/%|&^]=?|\.\.\.|\+\+|--)/ },
    { type: 'bracket', regex: /^[[\]]/ },
    { type: 'brace', regex: /^[{}]/ },
    { type: 'paren', regex: /^[()]/ },
    { type: 'semicolon', regex: /^;/ },
    { type: 'comma', regex: /^,/ },
    { type: 'punctuation', regex: /^\./ },
    { type: 'constant', regex: /^[A-Z][A-Z0-9_]+\b/ },
    { type: 'identifier', regex: /^[a-zA-Z_][a-zA-Z0-9_]*/ },
  ];

  // HTML/XML patterns
  const htmlPatterns: PatternDef[] = [
    { type: 'docComment', regex: /^<!DOCTYPE[^>]*>/i },
    { type: 'comment', regex: /^<!--[\s\S]*?-->/ },
    { type: 'string', regex: /^<!\[CDATA\[[\s\S]*?\]\]>/ },
    { type: 'preprocessor', regex: /^<\?[\s\S]*?\?>/ },
    {
      type: 'tag',
      regex:
        /^<[a-zA-Z][a-zA-Z0-9-]*(?:\s+[a-zA-Z_:][a-zA-Z0-9_:.-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=><`]+))?)*\s*\/>/,
    },
    {
      type: 'tag',
      regex:
        /^<[a-zA-Z][a-zA-Z0-9-]*(?:\s+[a-zA-Z_:][a-zA-Z0-9_:.-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=><`]+))?)*\s*>/,
    },
    { type: 'tag', regex: /^<\/[a-zA-Z][a-zA-Z0-9-]*\s*>/ },
    { type: 'tagBracket', regex: /^<\/?/ },
    { type: 'tagBracket', regex: /^\/?>/ },
    { type: 'string', regex: /^"[^"]*"/ },
    { type: 'string', regex: /^'[^']*'/ },
    { type: 'builtin', regex: /^&[a-zA-Z0-9#]+;/ },
    { type: 'identifier', regex: /^[a-zA-Z_:][a-zA-Z0-9_:.-]*/ },
    { type: 'operator', regex: /^=/ },
    { type: 'punctuation', regex: /^[<>/]/ },
  ];

  // CSS patterns
  const cssPatterns: PatternDef[] = [
    { type: 'comment', regex: /^\/\*[\s\S]*?\*\// },
    { type: 'string', regex: /^"(?:[^"\\]|\\[\s\S])*?"/ },
    { type: 'string', regex: /^'(?:[^'\\]|\\[\s\S])*?'/ },
    { type: 'builtin', regex: /^url\([^)]*\)/ },
    { type: 'keyword', regex: /^@[a-zA-Z-]+/ },
    { type: 'builtin', regex: /^::?[a-zA-Z-]+(?:\([^)]*\))?/ },
    { type: 'constant', regex: /^#[a-zA-Z_-][a-zA-Z0-9_-]*/ },
    { type: 'class', regex: /^\.[a-zA-Z_-][a-zA-Z0-9_-]*/ },
    { type: 'tag', regex: /^[a-zA-Z][a-zA-Z0-9-]*/ },
    { type: 'property', regex: /^[a-zA-Z-]+(?=\s*:)/ },
    {
      type: 'number',
      regex: /^-?(?:\d+\.?\d*|\.\d+)(?:px|em|rem|vh|vw|vmin|vmax|%|deg|rad|turn|s|ms|fr|ch|ex)?/,
    },
    { type: 'constant', regex: /^#[0-9a-fA-F]{3,8}\b/ },
    {
      type: 'keyword',
      regex:
        /^(?:inherit|initial|unset|revert|auto|none|block|inline|flex|grid|absolute|relative|fixed|sticky|hidden|visible|scroll|center|left|right|top|bottom|solid|dashed|dotted|normal|bold|italic|pointer|default|ease|linear|infinite)\b/,
    },
    { type: 'method', regex: /^[a-zA-Z-]+(?=\()/ },
    { type: 'operator', regex: /^[+\-*/%>~]/ },
    { type: 'brace', regex: /^[{}]/ },
    { type: 'bracket', regex: /^[[\]]/ },
    { type: 'paren', regex: /^[()]/ },
    { type: 'semicolon', regex: /^;/ },
    { type: 'comma', regex: /^,/ },
    { type: 'punctuation', regex: /^[:.!]/ },
    { type: 'identifier', regex: /^[a-zA-Z_-][a-zA-Z0-9_-]*/ },
  ];

  // JSON patterns
  const jsonPatterns: PatternDef[] = [
    { type: 'property', regex: /^"(?:[^"\\]|\\[\s\S])*?"(?=\s*:)/ },
    { type: 'string', regex: /^"(?:[^"\\]|\\[\s\S])*?"/ },
    { type: 'boolean', regex: /^(?:true|false)\b/ },
    { type: 'null', regex: /^null\b/ },
    { type: 'number', regex: /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/ },
    { type: 'brace', regex: /^[{}]/ },
    { type: 'bracket', regex: /^[[\]]/ },
    { type: 'punctuation', regex: /^:/ },
    { type: 'comma', regex: /^,/ },
  ];

  // YAML patterns
  const yamlPatterns: PatternDef[] = [
    { type: 'comment', regex: /^#[^\n]*/ },
    { type: 'string', regex: /^\|[+-]?\n(?:[ \t]+[^\n]*\n?)*/ },
    { type: 'string', regex: /^>[+-]?\n(?:[ \t]+[^\n]*\n?)*/ },
    { type: 'string', regex: /^"(?:[^"\\]|\\[\s\S])*?"/ },
    { type: 'string', regex: /^'[^']*'/ },
    { type: 'variable', regex: /^[&*][a-zA-Z_][a-zA-Z0-9_]*/ },
    { type: 'type', regex: /^!![a-zA-Z_][a-zA-Z0-9_]*/ },
    { type: 'type', regex: /^![a-zA-Z_][a-zA-Z0-9_]*/ },
    { type: 'property', regex: /^[a-zA-Z_][a-zA-Z0-9_-]*(?=\s*:)/ },
    { type: 'boolean', regex: /^(?:true|false|yes|no|on|off)\b/i },
    { type: 'null', regex: /^(?:null|~)\b/ },
    { type: 'number', regex: /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/ },
    { type: 'operator', regex: /^[-:]/ },
    { type: 'bracket', regex: /^[[\]]/ },
    { type: 'brace', regex: /^[{}]/ },
    { type: 'comma', regex: /^,/ },
    { type: 'identifier', regex: /^[a-zA-Z_][a-zA-Z0-9_-]*/ },
  ];

  // Markdown patterns
  const markdownPatterns: PatternDef[] = [
    { type: 'string', regex: /^```[^\n]*\n[\s\S]*?```/ },
    { type: 'string', regex: /^~~~[^\n]*\n[\s\S]*?~~~/ },
    { type: 'string', regex: /^`[^`\n]+`/ },
    { type: 'keyword', regex: /^#{1,6}\s+[^\n]+/ },
    { type: 'builtin', regex: /^\*\*[^*]+\*\*/ },
    { type: 'builtin', regex: /^__[^_]+__/ },
    { type: 'builtin', regex: /^\*[^*\n]+\*/ },
    { type: 'builtin', regex: /^_[^_\n]+_/ },
    { type: 'method', regex: /^\[[^\]]+\]\([^)]+\)/ },
    { type: 'method', regex: /^!\[[^\]]*\]\([^)]+\)/ },
    { type: 'comment', regex: /^>\s+[^\n]+/ },
    { type: 'punctuation', regex: /^[-*_]{3,}/ },
    { type: 'punctuation', regex: /^[-*+]\s/ },
    { type: 'number', regex: /^\d+\.\s/ },
    { type: 'identifier', regex: /^[a-zA-Z_][a-zA-Z0-9_]*/ },
  ];

  // Shell/Bash patterns - note: double-quoted strings are handled specially in tokenizeShell
  const shellPatterns: PatternDef[] = [
    { type: 'comment', regex: /^#[^\n]*/ },
    { type: 'templateString', regex: /^\$"(?:[^"\\]|\\[\s\S])*?"/ },
    // Double-quoted strings handled by tokenizeShell for proper $() and ${} support
    { type: 'string', regex: /^'[^']*'/ },
    // $() command substitution handled by tokenizeShell
    { type: 'method', regex: /^`[^`]*`/ },
    { type: 'variable', regex: /^\$\{[^}]*\}/ },
    { type: 'variable', regex: /^\$[a-zA-Z_][a-zA-Z0-9_]*/ },
    { type: 'variable', regex: /^\$[0-9@#?$!*-]/ },
    {
      type: 'controlKeyword',
      regex: /^(?:if|then|else|elif|fi|case|esac|for|while|until|do|done|in|select)\b/,
    },
    {
      type: 'builtin',
      regex:
        /^(?:echo|printf|read|cd|pwd|export|unset|source|eval|exec|exit|return|shift|set|unset|local|declare|typeset|readonly|alias|unalias|function|test|true|false)\b/,
    },
    {
      type: 'method',
      regex:
        /^(?:ls|cat|grep|sed|awk|find|sort|uniq|head|tail|wc|cut|tr|chmod|chown|mkdir|rmdir|rm|cp|mv|ln|touch|tar|gzip|gunzip|zip|unzip|curl|wget|ssh|scp|git|docker|npm|node|python|pip|make|gcc|go)\b/,
    },
    { type: 'storageKeyword', regex: /^function\b/ },
    { type: 'comparison', regex: /^(?:-eq|-ne|-lt|-gt|-le|-ge|-z|-n|-e|-f|-d|-r|-w|-x)\b/ },
    { type: 'operator', regex: /^(?:&&|\|\||[|&;<>]|>>|<<|2>&1|>&2)/ },
    { type: 'bracket', regex: /^(?:\[\[?|\]\]?)/ },
    { type: 'brace', regex: /^[{}]/ },
    { type: 'paren', regex: /^[()]/ },
    { type: 'identifier', regex: /^[a-zA-Z_][a-zA-Z0-9_]*/ },
    { type: 'number', regex: /^\d+/ },
  ];

  // SQL patterns
  const sqlPatterns: PatternDef[] = [
    { type: 'comment', regex: /^--[^\n]*/ },
    { type: 'comment', regex: /^\/\*[\s\S]*?\*\// },
    { type: 'string', regex: /^'(?:[^']|'')*'/ },
    { type: 'string', regex: /^"(?:[^"]|"")*"/ },
    {
      type: 'keyword',
      regex:
        /^(?:SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|FULL|CROSS|ON|AND|OR|NOT|IN|EXISTS|BETWEEN|LIKE|IS|NULL|AS|DISTINCT|ALL|UNION|INTERSECT|EXCEPT|ORDER|BY|ASC|DESC|LIMIT|OFFSET|GROUP|HAVING|INTO|VALUES|SET)\b/i,
    },
    {
      type: 'storageKeyword',
      regex:
        /^(?:CREATE|ALTER|DROP|TRUNCATE|TABLE|VIEW|INDEX|DATABASE|SCHEMA|CONSTRAINT|PRIMARY|KEY|FOREIGN|REFERENCES|UNIQUE|CHECK|DEFAULT|CASCADE|RESTRICT|AUTO_INCREMENT|IDENTITY|SERIAL)\b/i,
    },
    {
      type: 'type',
      regex:
        /^(?:INT|INTEGER|BIGINT|SMALLINT|TINYINT|DECIMAL|NUMERIC|FLOAT|REAL|DOUBLE|PRECISION|CHAR|VARCHAR|TEXT|NCHAR|NVARCHAR|NTEXT|DATE|TIME|DATETIME|TIMESTAMP|BOOLEAN|BOOL|BLOB|CLOB|JSON|UUID)\b/i,
    },
    {
      type: 'builtin',
      regex:
        /^(?:COUNT|SUM|AVG|MIN|MAX|COALESCE|NULLIF|CAST|CONVERT|CONCAT|SUBSTRING|LENGTH|UPPER|LOWER|TRIM|LTRIM|RTRIM|REPLACE|NOW|CURRENT_DATE|CURRENT_TIME|CURRENT_TIMESTAMP|DATEADD|DATEDIFF|YEAR|MONTH|DAY|HOUR|MINUTE|SECOND|ROUND|FLOOR|CEILING|ABS|MOD|POWER|SQRT)\b/i,
    },
    { type: 'null', regex: /^NULL\b/i },
    { type: 'boolean', regex: /^(?:TRUE|FALSE)\b/i },
    { type: 'number', regex: /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/ },
    { type: 'comparison', regex: /^(?:>=|<=|<>|!=|=|>|<)/ },
    { type: 'operator', regex: /^[+\-*/%]/ },
    { type: 'paren', regex: /^[()]/ },
    { type: 'semicolon', regex: /^;/ },
    { type: 'comma', regex: /^,/ },
    { type: 'punctuation', regex: /^\./ },
    { type: 'identifier', regex: /^[a-zA-Z_][a-zA-Z0-9_]*/ },
  ];

  // Java/C#/C/C++ patterns
  const cFamilyPatterns: PatternDef[] = [
    { type: 'docComment', regex: /^\/\*\*[\s\S]*?\*\// },
    { type: 'comment', regex: /^\/\*[\s\S]*?\*\// },
    { type: 'comment', regex: /^\/\/[^\n]*/ },
    { type: 'preprocessor', regex: /^#[a-zA-Z_][a-zA-Z0-9_]*/ },
    { type: 'string', regex: /^@"(?:[^"]|"")*"/ },
    { type: 'string', regex: /^"(?:[^"\\]|\\[\s\S])*?"/ },
    { type: 'string', regex: /^'(?:[^'\\]|\\[\s\S])*?'/ },
    { type: 'attribute', regex: /^\[[a-zA-Z_][a-zA-Z0-9_]*(?:\([^)]*\))?\]/ },
    { type: 'decorator', regex: /^@[a-zA-Z_][a-zA-Z0-9_]*(?:\([^)]*\))?/ },
    {
      type: 'controlKeyword',
      regex:
        /^(?:if|else|switch|case|default|for|foreach|while|do|break|continue|return|throw|try|catch|finally|goto)\b/,
    },
    {
      type: 'storageKeyword',
      regex:
        /^(?:public|private|protected|internal|static|final|const|readonly|volatile|synchronized|native|transient|abstract|virtual|override|sealed|extern|unsafe|partial|async|await|var|let|new|class|struct|interface|enum|delegate|event|namespace|using|import|package|extends|implements|throws|sizeof|typeof|instanceof|as|is|in|out|ref|params)\b/,
    },
    { type: 'boolean', regex: /^(?:true|false)\b/ },
    { type: 'null', regex: /^(?:null|nullptr|nil|NULL)\b/ },
    {
      type: 'builtin',
      regex:
        /^(?:void|int|long|short|byte|float|double|char|bool|boolean|string|String|object|Object|var|auto)\b/,
    },
    { type: 'type', regex: /^[A-Z][a-zA-Z0-9_]*/ },
    { type: 'method', regex: /^[a-zA-Z_][a-zA-Z0-9_]*(?=\s*[(<])/ },
    { type: 'property', regex: /^\.([a-zA-Z_][a-zA-Z0-9_]*)/ },
    {
      type: 'number',
      regex: /^(?:0x[0-9a-fA-F]+[uUlL]*|0b[01]+[uUlL]*|\d+\.?\d*(?:[eE][+-]?\d+)?[fFdDmMuUlL]*)\b/,
    },
    { type: 'comparison', regex: /^(?:===|!==|==|!=|<=|>=|<|>)/ },
    { type: 'arrow', regex: /^(?:->|=>)/ },
    { type: 'operator', regex: /^(?:&&|\|\||>>>|>>|<<|[+\-*/%|&^~!]=?|\?\?|\?\.?|::)/ },
    { type: 'bracket', regex: /^[[\]]/ },
    { type: 'brace', regex: /^[{}]/ },
    { type: 'paren', regex: /^[()]/ },
    { type: 'semicolon', regex: /^;/ },
    { type: 'comma', regex: /^,/ },
    { type: 'punctuation', regex: /^\./ },
    { type: 'constant', regex: /^[A-Z][A-Z0-9_]+\b/ },
    { type: 'identifier', regex: /^[a-zA-Z_][a-zA-Z0-9_]*/ },
  ];

  // PHP patterns
  const phpPatterns: PatternDef[] = [
    { type: 'docComment', regex: /^\/\*\*[\s\S]*?\*\// },
    { type: 'comment', regex: /^\/\*[\s\S]*?\*\// },
    { type: 'comment', regex: /^\/\/[^\n]*/ },
    { type: 'comment', regex: /^#[^\n]*/ },
    { type: 'preprocessor', regex: /^<\?(?:php|=)?/ },
    { type: 'preprocessor', regex: /^\?>/ },
    { type: 'string', regex: /^<<<['"]?([a-zA-Z_][a-zA-Z0-9_]*)['"]?\n[\s\S]*?\n\1;?/ },
    {
      type: 'templateString',
      regex: /^"(?:[^"\\$]|\\[\s\S]|\$[a-zA-Z_][a-zA-Z0-9_]*|\$\{[^}]*\})*?"/,
    },
    { type: 'string', regex: /^'(?:[^'\\]|\\[\s\S])*?'/ },
    { type: 'variable', regex: /^\$[a-zA-Z_][a-zA-Z0-9_]*/ },
    { type: 'attribute', regex: /^#\[[^\]]*\]/ },
    {
      type: 'controlKeyword',
      regex:
        /^(?:if|elseif|else|switch|case|default|for|foreach|while|do|break|continue|return|throw|try|catch|finally|match)\b/,
    },
    {
      type: 'storageKeyword',
      regex:
        /^(?:function|class|interface|trait|enum|abstract|final|static|public|private|protected|const|var|new|extends|implements|use|namespace|as|clone|instanceof|yield|from|global|include|include_once|require|require_once|echo|print|die|exit|readonly)\b/,
    },
    { type: 'boolean', regex: /^(?:true|false)\b/i },
    { type: 'null', regex: /^null\b/i },
    {
      type: 'builtin',
      regex:
        /^(?:array|string|int|float|bool|object|callable|iterable|mixed|void|never|self|parent|static)\b/,
    },
    { type: 'type', regex: /^[A-Z][a-zA-Z0-9_]*/ },
    { type: 'method', regex: /^[a-zA-Z_][a-zA-Z0-9_]*(?=\s*\()/ },
    { type: 'property', regex: /^->([a-zA-Z_][a-zA-Z0-9_]*)/ },
    { type: 'property', regex: /^::([a-zA-Z_][a-zA-Z0-9_]*)/ },
    { type: 'number', regex: /^(?:0x[0-9a-fA-F]+|0b[01]+|0o[0-7]+|\d+\.?\d*(?:[eE][+-]?\d+)?)\b/ },
    { type: 'comparison', regex: /^(?:===|!==|<=>|==|!=|<=|>=|<|>)/ },
    { type: 'arrow', regex: /^(?:->|=>)/ },
    { type: 'operator', regex: /^(?:&&|\|\||[+\-*/%|&^~!]=?|\?\?|\.=?)/ },
    { type: 'bracket', regex: /^[[\]]/ },
    { type: 'brace', regex: /^[{}]/ },
    { type: 'paren', regex: /^[()]/ },
    { type: 'semicolon', regex: /^;/ },
    { type: 'comma', regex: /^,/ },
    { type: 'punctuation', regex: /^\./ },
    { type: 'constant', regex: /^[A-Z][A-Z0-9_]+\b/ },
    { type: 'identifier', regex: /^[a-zA-Z_][a-zA-Z0-9_]*/ },
  ];

  // Ruby patterns
  const rubyPatterns: PatternDef[] = [
    { type: 'comment', regex: /^=begin[\s\S]*?=end/ },
    { type: 'comment', regex: /^#[^\n]*/ },
    // Simplified percent-string pattern: avoid backreference inside char class which
    // caused invalid escape sequences in some JS engines / TypeScript checks.
    { type: 'string', regex: /^%[qQwWiIxsr]?[^\n\r\s]+/ },
    { type: 'templateString', regex: /^"(?:[^"\\#]|\\[\s\S]|#\{[^}]*\})*?"/ },
    { type: 'string', regex: /^'(?:[^'\\]|\\[\s\S])*?'/ },
    { type: 'regex', regex: /^\/(?:[^/\\]|\\[\s\S])+\/[imxo]*/ },
    { type: 'variable', regex: /^@@?[a-zA-Z_][a-zA-Z0-9_]*/ },
    { type: 'variable', regex: /^\$[a-zA-Z_][a-zA-Z0-9_]*/ },
    { type: 'constant', regex: /^:[a-zA-Z_][a-zA-Z0-9_]*[!?]?/ },
    {
      type: 'controlKeyword',
      regex:
        /^(?:if|elsif|else|unless|case|when|while|until|for|break|next|redo|retry|return|raise|rescue|ensure|begin|end|then|do)\b/,
    },
    {
      type: 'storageKeyword',
      regex:
        /^(?:def|class|module|include|extend|prepend|attr_reader|attr_writer|attr_accessor|alias|undef|defined\?|private|protected|public|require|require_relative|load|yield|super|self|new|lambda|proc)\b/,
    },
    { type: 'boolean', regex: /^(?:true|false)\b/ },
    { type: 'null', regex: /^nil\b/ },
    {
      type: 'builtin',
      regex:
        /^(?:Array|Hash|String|Integer|Float|Symbol|Proc|Lambda|Object|Class|Module|Kernel|Enumerable|Comparable|File|IO|Dir|Time|Range|Regexp|Exception|StandardError|RuntimeError|ArgumentError|TypeError|NameError)\b/,
    },
    { type: 'type', regex: /^[A-Z][a-zA-Z0-9_]*/ },
    { type: 'method', regex: /^[a-zA-Z_][a-zA-Z0-9_]*[!?]?(?=\s*[({])/ },
    { type: 'property', regex: /^\.([a-zA-Z_][a-zA-Z0-9_]*[!?]?)/ },
    { type: 'number', regex: /^(?:0x[0-9a-fA-F]+|0b[01]+|0o[0-7]+|\d+\.?\d*(?:[eE][+-]?\d+)?)\b/ },
    { type: 'comparison', regex: /^(?:<=>|===|==|!=|<=|>=|=~|!~|<|>)/ },
    { type: 'arrow', regex: /^(?:->|=>)/ },
    { type: 'operator', regex: /^(?:&&|\|\||[+\-*/%|&^~!]=?|\.\.\.?|\*\*|<<|>>)/ },
    { type: 'bracket', regex: /^[[\]]/ },
    { type: 'brace', regex: /^[{}]/ },
    { type: 'paren', regex: /^[()]/ },
    { type: 'semicolon', regex: /^;/ },
    { type: 'comma', regex: /^,/ },
    { type: 'punctuation', regex: /^\./ },
    { type: 'identifier', regex: /^[a-zA-Z_][a-zA-Z0-9_]*[!?]?/ },
  ];

  // Select patterns based on language
  let langPatterns: PatternDef[];

  switch (normalizedLang) {
    case 'javascript':
    case 'js':
    case 'typescript':
    case 'ts':
    case 'tsx':
    case 'jsx':
    case 'mjs':
    case 'cjs':
    case 'mts':
    case 'cts':
      langPatterns = jstsPatterns;
      break;
    case 'python':
    case 'py':
      langPatterns = pythonPatterns;
      break;
    case 'rust':
    case 'rs':
      langPatterns = rustPatterns;
      break;
    case 'go':
    case 'golang':
      langPatterns = goPatterns;
      break;
    case 'html':
    case 'htm':
    case 'xml':
    case 'svg':
    case 'vue':
    case 'svelte':
      langPatterns = htmlPatterns;
      break;
    case 'css':
    case 'scss':
    case 'sass':
    case 'less':
      langPatterns = cssPatterns;
      break;
    case 'json':
    case 'jsonc':
      langPatterns = jsonPatterns;
      break;
    case 'yaml':
    case 'yml':
      langPatterns = yamlPatterns;
      break;
    case 'markdown':
    case 'md':
      langPatterns = markdownPatterns;
      break;
    case 'bash':
    case 'sh':
    case 'shell':
    case 'zsh':
    case 'fish':
      langPatterns = shellPatterns;
      break;
    case 'sql':
    case 'mysql':
    case 'postgresql':
    case 'postgres':
    case 'sqlite':
      langPatterns = sqlPatterns;
      break;
    case 'java':
    case 'c':
    case 'cpp':
    case 'c++':
    case 'csharp':
    case 'c#':
    case 'cs':
    case 'objc':
    case 'objective-c':
    case 'kotlin':
    case 'scala':
    case 'swift':
      langPatterns = cFamilyPatterns;
      break;
    case 'php':
      langPatterns = phpPatterns;
      break;
    case 'ruby':
    case 'rb':
      langPatterns = rubyPatterns;
      break;
    default:
      langPatterns = jstsPatterns;
  }

  return [...langPatterns, ...commonPatterns];
};

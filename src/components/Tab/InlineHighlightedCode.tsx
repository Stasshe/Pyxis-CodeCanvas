import { Check, Copy } from 'lucide-react';
import React, { useState, useMemo } from 'react';

import { useTranslation } from '@/context/I18nContext';
import { useTheme } from '@/context/ThemeContext';

// Token types for comprehensive syntax highlighting
type TokenType =
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

interface Token {
  type: TokenType;
  value: string;
}

interface PatternDef {
  type: TokenType;
  regex: RegExp;
}

// Language-specific pattern sets
const createPatterns = (lang: string): PatternDef[] => {
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
    { type: 'regex', regex: /^\/(?!\/)(?:[^/\\[\n]|\\[\s\S]|\[[^\]\\]*(?:\\[\s\S][^\]\\]*)*\])+\/[gimsy]*/ },
    { type: 'decorator', regex: /^@[a-zA-Z_$][a-zA-Z0-9_$]*/ },
    { type: 'tag', regex: /^<[a-zA-Z][a-zA-Z0-9.]*(?:\s+[a-zA-Z_:][a-zA-Z0-9_:.]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|\{[^}]*\}))?)*\s*\/>/ },
    { type: 'tag', regex: /^<[a-zA-Z][a-zA-Z0-9.]*(?:\s+[a-zA-Z_:][a-zA-Z0-9_:.]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|\{[^}]*\}))?)*\s*>/ },
    { type: 'tag', regex: /^<\/[a-zA-Z][a-zA-Z0-9.]*\s*>/ },
    { type: 'type', regex: /^:\s*(?:string|number|boolean|any|void|never|unknown|null|undefined|object|symbol|bigint)\b/ },
    { type: 'arrow', regex: /^=>/ },
    { type: 'controlKeyword', regex: /^(?:if|else|switch|case|default|for|while|do|break|continue|return|throw|try|catch|finally)\b/ },
    { type: 'storageKeyword', regex: /^(?:const|let|var|function|class|interface|type|enum|namespace|module|declare|abstract|readonly|static|public|private|protected|async|await|yield|export|import|from|as|extends|implements|new)\b/ },
    { type: 'null', regex: /^(?:null|undefined)\b/ },
    { type: 'boolean', regex: /^(?:true|false)\b/ },
    { type: 'builtin', regex: /^(?:Array|Object|String|Number|Boolean|Function|Symbol|Map|Set|WeakMap|WeakSet|Promise|Date|RegExp|Error|Math|JSON|console|window|document|globalThis|process)\b/ },
    { type: 'class', regex: /^[A-Z][a-zA-Z0-9_$]*(?=\s*[({<])/ },
    { type: 'type', regex: /^[A-Z][a-zA-Z0-9_$]*(?=\s*[,;)\]|&>])/ },
    { type: 'method', regex: /^[a-zA-Z_$][a-zA-Z0-9_$]*(?=\s*\()/ },
    { type: 'property', regex: /^\.([a-zA-Z_$][a-zA-Z0-9_$]*)/ },
    { type: 'number', regex: /^(?:0x[0-9a-fA-F]+n?|0b[01]+n?|0o[0-7]+n?|\d+\.?\d*(?:[eE][+-]?\d+)?n?)\b/ },
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
    { type: 'controlKeyword', regex: /^(?:if|elif|else|for|while|break|continue|pass|return|raise|try|except|finally|with|assert|yield|match|case)\b/ },
    { type: 'storageKeyword', regex: /^(?:def|class|lambda|import|from|as|global|nonlocal|async|await|del)\b/ },
    { type: 'boolean', regex: /^(?:True|False)\b/ },
    { type: 'null', regex: /^None\b/ },
    { type: 'builtin', regex: /^(?:print|len|range|str|int|float|list|dict|set|tuple|bool|type|isinstance|hasattr|getattr|setattr|open|input|sorted|reversed|enumerate|zip|map|filter|reduce|sum|min|max|abs|round|pow|format|repr|id|dir|vars|help|super|property|classmethod|staticmethod)\b/ },
    { type: 'builtin', regex: /^(?:Exception|TypeError|ValueError|KeyError|IndexError|AttributeError|ImportError|RuntimeError|StopIteration|OSError|IOError|FileNotFoundError|NotImplementedError|ZeroDivisionError)\b/ },
    { type: 'method', regex: /^__[a-zA-Z_][a-zA-Z0-9_]*__/ },
    { type: 'type', regex: /^(?:Optional|Union|List|Dict|Set|Tuple|Callable|Any|NoReturn|ClassVar|Final|Literal|TypeVar|Generic|Protocol|TypedDict|Awaitable|Coroutine|AsyncGenerator|Iterator|Iterable|Mapping|Sequence|MutableMapping|MutableSequence)\b/ },
    { type: 'class', regex: /^[A-Z][a-zA-Z0-9_]*(?=\s*[:(])/ },
    { type: 'method', regex: /^[a-zA-Z_][a-zA-Z0-9_]*(?=\s*\()/ },
    { type: 'property', regex: /^\.([a-zA-Z_][a-zA-Z0-9_]*)/ },
    { type: 'number', regex: /^(?:0x[0-9a-fA-F]+|0b[01]+|0o[0-7]+|\d+\.?\d*(?:[eE][+-]?\d+)?j?)\b/ },
    { type: 'comparison', regex: /^(?:==|!=|<=|>=|<>|<|>)/ },
    { type: 'operator', regex: /^(?:\*\*|\/\/|@|:=|->|[+\-*/%|&^~]=?|not\s+in\b|is\s+not\b|not\b|and\b|or\b|in\b|is\b)/ },
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
    { type: 'controlKeyword', regex: /^(?:if|else|match|loop|while|for|break|continue|return|yield)\b/ },
    { type: 'storageKeyword', regex: /^(?:fn|let|mut|const|static|struct|enum|trait|impl|type|pub|crate|mod|use|extern|self|Self|super|async|await|dyn|ref|move|unsafe|where|in|as)\b/ },
    { type: 'boolean', regex: /^(?:true|false)\b/ },
    { type: 'builtin', regex: /^(?:i8|i16|i32|i64|i128|isize|u8|u16|u32|u64|u128|usize|f32|f64|bool|char|str|String|Vec|Option|Result|Box|Rc|Arc|Cell|RefCell|HashMap|HashSet|BTreeMap|BTreeSet|VecDeque|LinkedList|BinaryHeap)\b/ },
    { type: 'type', regex: /^[A-Z][a-zA-Z0-9_]*/ },
    { type: 'method', regex: /^[a-z_][a-zA-Z0-9_]*(?=\s*[(<])/ },
    { type: 'property', regex: /^\.([a-z_][a-zA-Z0-9_]*)/ },
    { type: 'number', regex: /^(?:0x[0-9a-fA-F_]+|0b[01_]+|0o[0-7_]+|\d[\d_]*\.?[\d_]*(?:[eE][+-]?[\d_]+)?)[iu]?(?:8|16|32|64|128|size)?/ },
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
    { type: 'controlKeyword', regex: /^(?:if|else|switch|case|default|for|range|break|continue|goto|return|fallthrough|select)\b/ },
    { type: 'storageKeyword', regex: /^(?:func|var|const|type|struct|interface|map|chan|package|import|defer|go)\b/ },
    { type: 'boolean', regex: /^(?:true|false)\b/ },
    { type: 'null', regex: /^nil\b/ },
    { type: 'builtin', regex: /^(?:int|int8|int16|int32|int64|uint|uint8|uint16|uint32|uint64|uintptr|float32|float64|complex64|complex128|bool|byte|rune|string|error|any)\b/ },
    { type: 'builtin', regex: /^(?:make|new|len|cap|append|copy|delete|close|panic|recover|print|println|complex|real|imag)\b/ },
    { type: 'type', regex: /^[A-Z][a-zA-Z0-9_]*/ },
    { type: 'method', regex: /^[a-zA-Z_][a-zA-Z0-9_]*(?=\s*\()/ },
    { type: 'property', regex: /^\.([a-zA-Z_][a-zA-Z0-9_]*)/ },
    { type: 'number', regex: /^(?:0x[0-9a-fA-F]+|0b[01]+|0o[0-7]+|\d+\.?\d*(?:[eE][+-]?\d+)?i?)\b/ },
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
    { type: 'tag', regex: /^<[a-zA-Z][a-zA-Z0-9-]*(?:\s+[a-zA-Z_:][a-zA-Z0-9_:.-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=><`]+))?)*\s*\/>/ },
    { type: 'tag', regex: /^<[a-zA-Z][a-zA-Z0-9-]*(?:\s+[a-zA-Z_:][a-zA-Z0-9_:.-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=><`]+))?)*\s*>/ },
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
    { type: 'number', regex: /^-?(?:\d+\.?\d*|\.\d+)(?:px|em|rem|vh|vw|vmin|vmax|%|deg|rad|turn|s|ms|fr|ch|ex)?/ },
    { type: 'constant', regex: /^#[0-9a-fA-F]{3,8}\b/ },
    { type: 'keyword', regex: /^(?:inherit|initial|unset|revert|auto|none|block|inline|flex|grid|absolute|relative|fixed|sticky|hidden|visible|scroll|center|left|right|top|bottom|solid|dashed|dotted|normal|bold|italic|pointer|default|ease|linear|infinite)\b/ },
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
    { type: 'controlKeyword', regex: /^(?:if|then|else|elif|fi|case|esac|for|while|until|do|done|in|select)\b/ },
    { type: 'builtin', regex: /^(?:echo|printf|read|cd|pwd|export|unset|source|eval|exec|exit|return|shift|set|unset|local|declare|typeset|readonly|alias|unalias|function|test|true|false)\b/ },
    { type: 'method', regex: /^(?:ls|cat|grep|sed|awk|find|sort|uniq|head|tail|wc|cut|tr|chmod|chown|mkdir|rmdir|rm|cp|mv|ln|touch|tar|gzip|gunzip|zip|unzip|curl|wget|ssh|scp|git|docker|npm|node|python|pip|make|gcc|go)\b/ },
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
    { type: 'keyword', regex: /^(?:SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|FULL|CROSS|ON|AND|OR|NOT|IN|EXISTS|BETWEEN|LIKE|IS|NULL|AS|DISTINCT|ALL|UNION|INTERSECT|EXCEPT|ORDER|BY|ASC|DESC|LIMIT|OFFSET|GROUP|HAVING|INTO|VALUES|SET)\b/i },
    { type: 'storageKeyword', regex: /^(?:CREATE|ALTER|DROP|TRUNCATE|TABLE|VIEW|INDEX|DATABASE|SCHEMA|CONSTRAINT|PRIMARY|KEY|FOREIGN|REFERENCES|UNIQUE|CHECK|DEFAULT|CASCADE|RESTRICT|AUTO_INCREMENT|IDENTITY|SERIAL)\b/i },
    { type: 'type', regex: /^(?:INT|INTEGER|BIGINT|SMALLINT|TINYINT|DECIMAL|NUMERIC|FLOAT|REAL|DOUBLE|PRECISION|CHAR|VARCHAR|TEXT|NCHAR|NVARCHAR|NTEXT|DATE|TIME|DATETIME|TIMESTAMP|BOOLEAN|BOOL|BLOB|CLOB|JSON|UUID)\b/i },
    { type: 'builtin', regex: /^(?:COUNT|SUM|AVG|MIN|MAX|COALESCE|NULLIF|CAST|CONVERT|CONCAT|SUBSTRING|LENGTH|UPPER|LOWER|TRIM|LTRIM|RTRIM|REPLACE|NOW|CURRENT_DATE|CURRENT_TIME|CURRENT_TIMESTAMP|DATEADD|DATEDIFF|YEAR|MONTH|DAY|HOUR|MINUTE|SECOND|ROUND|FLOOR|CEILING|ABS|MOD|POWER|SQRT)\b/i },
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
    { type: 'controlKeyword', regex: /^(?:if|else|switch|case|default|for|foreach|while|do|break|continue|return|throw|try|catch|finally|goto)\b/ },
    { type: 'storageKeyword', regex: /^(?:public|private|protected|internal|static|final|const|readonly|volatile|synchronized|native|transient|abstract|virtual|override|sealed|extern|unsafe|partial|async|await|var|let|new|class|struct|interface|enum|delegate|event|namespace|using|import|package|extends|implements|throws|sizeof|typeof|instanceof|as|is|in|out|ref|params)\b/ },
    { type: 'boolean', regex: /^(?:true|false)\b/ },
    { type: 'null', regex: /^(?:null|nullptr|nil|NULL)\b/ },
    { type: 'builtin', regex: /^(?:void|int|long|short|byte|float|double|char|bool|boolean|string|String|object|Object|var|auto)\b/ },
    { type: 'type', regex: /^[A-Z][a-zA-Z0-9_]*/ },
    { type: 'method', regex: /^[a-zA-Z_][a-zA-Z0-9_]*(?=\s*[(<])/ },
    { type: 'property', regex: /^\.([a-zA-Z_][a-zA-Z0-9_]*)/ },
    { type: 'number', regex: /^(?:0x[0-9a-fA-F]+[uUlL]*|0b[01]+[uUlL]*|\d+\.?\d*(?:[eE][+-]?\d+)?[fFdDmMuUlL]*)\b/ },
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
    { type: 'templateString', regex: /^"(?:[^"\\$]|\\[\s\S]|\$[a-zA-Z_][a-zA-Z0-9_]*|\$\{[^}]*\})*?"/ },
    { type: 'string', regex: /^'(?:[^'\\]|\\[\s\S])*?'/ },
    { type: 'variable', regex: /^\$[a-zA-Z_][a-zA-Z0-9_]*/ },
    { type: 'attribute', regex: /^#\[[^\]]*\]/ },
    { type: 'controlKeyword', regex: /^(?:if|elseif|else|switch|case|default|for|foreach|while|do|break|continue|return|throw|try|catch|finally|match)\b/ },
    { type: 'storageKeyword', regex: /^(?:function|class|interface|trait|enum|abstract|final|static|public|private|protected|const|var|new|extends|implements|use|namespace|as|clone|instanceof|yield|from|global|include|include_once|require|require_once|echo|print|die|exit|readonly)\b/ },
    { type: 'boolean', regex: /^(?:true|false)\b/i },
    { type: 'null', regex: /^null\b/i },
    { type: 'builtin', regex: /^(?:array|string|int|float|bool|object|callable|iterable|mixed|void|never|self|parent|static)\b/ },
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
    { type: 'controlKeyword', regex: /^(?:if|elsif|else|unless|case|when|while|until|for|break|next|redo|retry|return|raise|rescue|ensure|begin|end|then|do)\b/ },
    { type: 'storageKeyword', regex: /^(?:def|class|module|include|extend|prepend|attr_reader|attr_writer|attr_accessor|alias|undef|defined\?|private|protected|public|require|require_relative|load|yield|super|self|new|lambda|proc)\b/ },
    { type: 'boolean', regex: /^(?:true|false)\b/ },
    { type: 'null', regex: /^nil\b/ },
    { type: 'builtin', regex: /^(?:Array|Hash|String|Integer|Float|Symbol|Proc|Lambda|Object|Class|Module|Kernel|Enumerable|Comparable|File|IO|Dir|Time|Range|Regexp|Exception|StandardError|RuntimeError|ArgumentError|TypeError|NameError)\b/ },
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

// Helper function to parse a double-quoted string in shell
// Handles nested $(), ${}, and escaped characters correctly
const parseShellDoubleQuotedString = (code: string, startIndex: number): string => {
  let j = startIndex + 1; // skip opening "
  let result = '"';

  while (j < code.length) {
    const char = code[j];

    if (char === '"') {
      return result + '"';
    }

    if (char === '\\' && j + 1 < code.length) {
      result += code.slice(j, j + 2);
      j += 2;
      continue;
    }

    if (char === '$' && j + 1 < code.length && code[j + 1] === '(') {
      const sub = parseShellCommandSubstitution(code, j);
      result += sub;
      j += sub.length;
      continue;
    }

    if (char === '`') {
      // Find matching backtick, handling escape sequences
      let endIndex = j + 1;
      while (endIndex < code.length) {
        if (code[endIndex] === '`') {
          break;
        }
        if (code[endIndex] === '\\' && endIndex + 1 < code.length) {
          endIndex += 2;
          continue;
        }
        endIndex++;
      }
      if (endIndex < code.length) {
        result += code.slice(j, endIndex + 1);
        j = endIndex + 1;
        continue;
      }
      // Unclosed backtick - just include the rest and move to end
      result += code.slice(j);
      break;
    }

    result += char;
    j++;
  }

  return result;
};

// Helper function to parse command substitution $() in shell
// Handles nested parentheses and quoted strings correctly
const parseShellCommandSubstitution = (code: string, startIndex: number): string => {
  let depth = 0;
  let j = startIndex;

  while (j < code.length) {
    const char = code[j];

    if (char === '$' && j + 1 < code.length && code[j + 1] === '(') {
      depth++;
      j += 2;
      continue;
    }

    if (char === '(') {
      depth++;
      j++;
      continue;
    }

    if (char === ')') {
      depth--;
      if (depth === 0) {
        return code.slice(startIndex, j + 1);
      }
      j++;
      continue;
    }

    if (char === '"') {
      const str = parseShellDoubleQuotedString(code, j);
      j += str.length;
      continue;
    }

    // In bash, single quotes don't support escape sequences - they are literal
    // The string ends at the next single quote (no escaping possible)
    if (char === "'") {
      const end = code.indexOf("'", j + 1);
      if (end !== -1) {
        j = end + 1;
        continue;
      }
    }

    if (char === '\\' && j + 1 < code.length) {
      j += 2;
      continue;
    }

    j++;
  }

  return code.slice(startIndex, j);
};

// Specialized tokenizer for shell/bash that handles quotes correctly
const tokenizeShell = (code: string, patterns: PatternDef[]): Token[] => {
  const tokens: Token[] = [];
  let i = 0;

  while (i < code.length) {
    const char = code[i];
    const rest = code.slice(i);

    // Double quoted string - use special parser
    if (char === '"') {
      const str = parseShellDoubleQuotedString(code, i);
      tokens.push({ type: 'string', value: str });
      i += str.length;
      continue;
    }

    // $"..." localized string
    if (rest.startsWith('$"')) {
      const str = parseShellDoubleQuotedString(code, i + 1);
      tokens.push({ type: 'templateString', value: '$' + str });
      i += 1 + str.length;
      continue;
    }

    // Command substitution $() - use special parser
    if (rest.startsWith('$(')) {
      const sub = parseShellCommandSubstitution(code, i);
      tokens.push({ type: 'method', value: sub });
      i += sub.length;
      continue;
    }

    // Use pattern-based matching for other tokens
    let matched = false;
    for (const pattern of patterns) {
      const match = rest.match(pattern.regex);
      if (match) {
        tokens.push({ type: pattern.type, value: match[0] });
        i += match[0].length;
        matched = true;
        break;
      }
    }

    if (!matched) {
      tokens.push({ type: 'text', value: char });
      i++;
    }
  }

  return tokens;
};

// Helper function to parse JS/TS template literal with ${} interpolation
// Handles nested template literals correctly
const parseJsTemplateString = (code: string, startIndex: number): string => {
  let j = startIndex + 1; // skip opening `
  let result = '`';

  while (j < code.length) {
    const char = code[j];

    if (char === '`') {
      return result + '`';
    }

    if (char === '\\' && j + 1 < code.length) {
      result += code.slice(j, j + 2);
      j += 2;
      continue;
    }

    // Handle ${...} interpolation with nested braces and template literals
    if (char === '$' && j + 1 < code.length && code[j + 1] === '{') {
      const expr = parseJsTemplateExpression(code, j);
      result += expr;
      j += expr.length;
      continue;
    }

    result += char;
    j++;
  }

  return result;
};

// Helper function to parse ${...} expression in JS template literals
// Handles nested braces, strings, and template literals correctly
const parseJsTemplateExpression = (code: string, startIndex: number): string => {
  let depth = 0;
  let j = startIndex;

  while (j < code.length) {
    const char = code[j];

    if (char === '$' && j + 1 < code.length && code[j + 1] === '{') {
      depth++;
      j += 2;
      continue;
    }

    if (char === '{') {
      depth++;
      j++;
      continue;
    }

    if (char === '}') {
      depth--;
      if (depth === 0) {
        return code.slice(startIndex, j + 1);
      }
      j++;
      continue;
    }

    // Handle nested template literals
    if (char === '`') {
      const str = parseJsTemplateString(code, j);
      j += str.length;
      continue;
    }

    // Handle strings
    if (char === '"') {
      let endIndex = j + 1;
      while (endIndex < code.length) {
        if (code[endIndex] === '"') {
          break;
        }
        if (code[endIndex] === '\\' && endIndex + 1 < code.length) {
          endIndex += 2;
          continue;
        }
        endIndex++;
      }
      // Ensure j doesn't go out of bounds
      j = Math.min(endIndex + 1, code.length);
      continue;
    }

    if (char === "'") {
      let endIndex = j + 1;
      while (endIndex < code.length) {
        if (code[endIndex] === "'") {
          break;
        }
        if (code[endIndex] === '\\' && endIndex + 1 < code.length) {
          endIndex += 2;
          continue;
        }
        endIndex++;
      }
      // Ensure j doesn't go out of bounds
      j = Math.min(endIndex + 1, code.length);
      continue;
    }

    if (char === '\\' && j + 1 < code.length) {
      j += 2;
      continue;
    }

    j++;
  }

  return code.slice(startIndex, j);
};

// Specialized tokenizer for JavaScript/TypeScript that handles template literals correctly
const tokenizeJsTs = (code: string, patterns: PatternDef[]): Token[] => {
  const tokens: Token[] = [];
  let i = 0;

  while (i < code.length) {
    const char = code[i];
    const rest = code.slice(i);

    // Template literal - use special parser
    if (char === '`') {
      const str = parseJsTemplateString(code, i);
      tokens.push({ type: 'templateString', value: str });
      i += str.length;
      continue;
    }

    // Use pattern-based matching for other tokens
    let matched = false;
    for (const pattern of patterns) {
      const match = rest.match(pattern.regex);
      if (match) {
        tokens.push({ type: pattern.type, value: match[0] });
        i += match[0].length;
        matched = true;
        break;
      }
    }

    if (!matched) {
      tokens.push({ type: 'text', value: char });
      i++;
    }
  }

  return tokens;
};

// Tokenizer function
const tokenize = (code: string, patterns: PatternDef[], lang?: string): Token[] => {
  // Use specialized tokenizer based on language
  const normalizedLang = (lang || '').toLowerCase();
  
  // Shell/Bash languages
  if (['bash', 'sh', 'shell', 'zsh', 'fish'].includes(normalizedLang)) {
    return tokenizeShell(code, patterns);
  }
  
  // JavaScript/TypeScript languages
  if (['javascript', 'js', 'typescript', 'ts', 'tsx', 'jsx', 'mjs', 'cjs', 'mts', 'cts'].includes(normalizedLang)) {
    return tokenizeJsTs(code, patterns);
  }

  const tokens: Token[] = [];
  let remaining = code;

  while (remaining.length > 0) {
    let matched = false;
    for (const pattern of patterns) {
      const match = remaining.match(pattern.regex);
      if (match) {
        tokens.push({ type: pattern.type, value: match[0] });
        remaining = remaining.slice(match[0].length);
        matched = true;
        break;
      }
    }
    if (!matched) {
      tokens.push({ type: 'text', value: remaining[0] });
      remaining = remaining.slice(1);
    }
  }

  return tokens;
};

// Get token colors based on theme
const getTokenColors = (isDark: boolean) => ({
  keyword: isDark ? '#569cd6' : '#0000ff',
  controlKeyword: isDark ? '#c586c0' : '#af00db',
  storageKeyword: isDark ? '#569cd6' : '#0000ff',
  function: isDark ? '#dcdcaa' : '#795e26',
  method: isDark ? '#dcdcaa' : '#795e26',
  string: isDark ? '#ce9178' : '#a31515',
  templateString: isDark ? '#ce9178' : '#a31515',
  regex: isDark ? '#d16969' : '#811f3f',
  comment: isDark ? '#6a9955' : '#008000',
  docComment: isDark ? '#608b4e' : '#267f26',
  number: isDark ? '#b5cea8' : '#098658',
  boolean: isDark ? '#569cd6' : '#0000ff',
  null: isDark ? '#569cd6' : '#0000ff',
  operator: isDark ? '#d4d4d4' : '#333333',
  comparison: isDark ? '#d4d4d4' : '#333333',
  arrow: isDark ? '#569cd6' : '#0000ff',
  property: isDark ? '#9cdcfe' : '#001080',
  variable: isDark ? '#9cdcfe' : '#001080',
  type: isDark ? '#4ec9b0' : '#267f99',
  typeParameter: isDark ? '#4ec9b0' : '#267f99',
  class: isDark ? '#4ec9b0' : '#267f99',
  decorator: isDark ? '#dcdcaa' : '#795e26',
  attribute: isDark ? '#9cdcfe' : '#e50000',
  tag: isDark ? '#569cd6' : '#800000',
  tagBracket: isDark ? '#808080' : '#800000',
  punctuation: isDark ? '#d4d4d4' : '#000000',
  bracket: isDark ? '#ffd700' : '#795e26',
  brace: isDark ? '#da70d6' : '#af00af',
  paren: isDark ? '#179fff' : '#0431fa',
  semicolon: isDark ? '#d4d4d4' : '#000000',
  comma: isDark ? '#d4d4d4' : '#000000',
  whitespace: isDark ? '#d4d4d4' : '#000000',
  identifier: isDark ? '#9cdcfe' : '#001080',
  constant: isDark ? '#4fc1ff' : '#0070c1',
  builtin: isDark ? '#4ec9b0' : '#267f99',
  macro: isDark ? '#569cd6' : '#0000ff',
  preprocessor: isDark ? '#c586c0' : '#af00db',
  text: isDark ? '#d4d4d4' : '#000000',
});

// Get font styling for token types
const getTokenStyle = (type: TokenType): { fontWeight?: string; fontStyle?: string } => {
  switch (type) {
    case 'keyword':
    case 'controlKeyword':
    case 'storageKeyword':
      return { fontWeight: '600' };
    case 'function':
    case 'method':
      return { fontWeight: '500' };
    case 'comment':
    case 'docComment':
      return { fontStyle: 'italic' };
    case 'decorator':
      return { fontWeight: '500' };
    default:
      return {};
  }
};

export default function InlineHighlightedCode({
  language,
  value,
  plain,
  inline,
}: {
  language: string;
  value: string;
  plain?: boolean;
  inline?: boolean;
}) {
  const { t } = useTranslation();
  const { themeName, colors } = useTheme();
  const isDark = !(themeName || '').includes('light');
  const [copied, setCopied] = useState(false);

  // Memoize patterns for the language
  const patterns = useMemo(() => createPatterns(language), [language]);
  const tokenColors = useMemo(() => getTokenColors(isDark), [isDark]);

  if (plain) {
    return (
      <pre
        style={{
          borderRadius: 8,
          fontSize: '1em',
          margin: 0,
          overflowX: 'auto',
          minHeight: '100px',
          background: colors?.cardBg || '#f5f5f5',
          color: colors?.foreground || (isDark ? '#fff' : '#000'),
          padding: '12px',
        }}
      >
        <code>{value}</code>
      </pre>
    );
  }

  // Highlight function using the new tokenizer
  const highlight = (code: string): string => {
    const tokens = tokenize(code, patterns, language);

    const htmlParts = tokens.map(token => {
      const escaped = token.value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      if (token.type === 'whitespace') {
        return escaped;
      }

      const color = tokenColors[token.type] || tokenColors.text;
      const style = getTokenStyle(token.type);
      const fontWeight = style.fontWeight ? `font-weight:${style.fontWeight};` : '';
      const fontStyle = style.fontStyle ? `font-style:${style.fontStyle};` : '';

      return `<span style="color:${color};${fontWeight}${fontStyle}">${escaped}</span>`;
    });

    return htmlParts.join('');
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  };

  // Inline rendering
  if (inline) {
    const inner = highlight(String(value));
    return (
      <code
        className="inline-code"
        style={{
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, "Roboto Mono", "Segoe UI Mono", monospace',
          fontSize: '0.9em',
          padding: '0.2em 0.35em',
          borderRadius: 4,
          background: colors?.cardBg || (isDark ? '#23232a' : '#f5f5f5'),
          color: colors?.foreground || (isDark ? '#fff' : '#000'),
        }}
        dangerouslySetInnerHTML={{ __html: inner }}
      />
    );
  }

  return (
    <div className="relative group/code my-2 rounded-lg overflow-hidden">
      <button
        aria-label={t('highlightedCode.copyCode')}
        onClick={handleCopy}
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          zIndex: 2,
          background: 'rgba(255,255,255,0.7)',
          border: 'none',
          borderRadius: 6,
          padding: 4,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          transition: 'background 0.2s',
        }}
      >
        {copied ? <Check size={18} color="#22c55e" /> : <Copy size={18} color="#555" />}
      </button>

      <div
        className="overflow-x-auto"
        dangerouslySetInnerHTML={{
          __html: (() => {
            const inner = highlight(String(value));
            const preBg = colors?.cardBg || (isDark ? '#23232a' : '#f5f5f5');
            const preColor = colors?.foreground || (isDark ? '#fff' : '#000');
            return `<pre class="overflow-x-auto text-xs p-3 min-h-[48px] font-mono" style="font-size:13px;margin:0;background:${preBg};color:${preColor};padding:12px;border-radius:8px">${inner}</pre>`;
          })(),
        }}
      />
    </div>
  );
}

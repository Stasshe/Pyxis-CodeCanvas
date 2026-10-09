export enum ExtensionType {
  BUILTIN_MODULE = 'builtin-module',
  SERVICE = 'service',
  TRANSPILER = 'transpiler',
  LANGUAGE_RUNTIME = 'language-runtime',
  TOOL = 'tool',
  UI = 'ui',
}

export interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  type: ExtensionType;
  description: string;
  author: string;
  defaultEnabled?: boolean;
  icon?: string;
  homepage?: string;
  dependencies?: readonly string[];
  entry: string;
  files?: readonly string[];
  onlyOne?: string;
  readme?: string;
  packGroup?: {
    id: string;
    name: string;
  };
  metadata?: {
    publishedAt: string;
    updatedAt?: string;
    downloads?: number;
    tags?: readonly string[];
  };
}

export type QueryValue = string | number | boolean | bigint | null | undefined | object;

export interface ParseOptions {
  maxKeys?: number;
  decodeURIComponent?: (component: string) => string;
}

export interface StringifyOptions {
  encodeURIComponent?: (component: string) => string;
}

export interface ParsedQuery {
  [key: string]: string | string[];
}

export type QueryStringInput = object | string | number | boolean | bigint | null | undefined;

function forgivingDecode(component: string, plusAsSpace: boolean): string {
  let encoded = component.replace(/&/g, '%26').replace(/=/g, '%3D');
  if (!plusAsSpace) encoded = encoded.replace(/\+/g, '%2B');
  const params = new URLSearchParams(`value=${encoded}`);
  return params.get('value') ?? '';
}

function decodeComponent(component: string, decoder?: (value: string) => string): string {
  const decode = decoder ?? decodeURIComponent;
  try {
    return decode(component);
  } catch {
    return forgivingDecode(component, true);
  }
}

// biome-ignore lint/suspicious/noShadowRestrictedNames: Match the Node querystring builtin API.
export function escape(value: string): string {
  return encodeURIComponent(value);
}

// biome-ignore lint/suspicious/noShadowRestrictedNames: Match the Node querystring builtin API.
export function unescape(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return forgivingDecode(value, false);
  }
}

export function parse(
  value: string,
  separator?: string,
  assignment?: string,
  options?: ParseOptions
): ParsedQuery {
  const result = Object.create(null) as ParsedQuery;
  if (!value) return result;

  const pairSeparator = separator || '&';
  const valueSeparator = assignment || '=';
  const maxKeys = options?.maxKeys ?? 1000;
  const pairs = value.split(pairSeparator);
  let pairCount = pairs.length;
  if (maxKeys > 0 && pairCount > maxKeys) pairCount = maxKeys;

  for (let index = 0; index < pairCount; index += 1) {
    const pair = pairs[index];
    if (!pair) continue;
    const separatorIndex = pair.indexOf(valueSeparator);
    let key = pair;
    let entry = '';
    if (separatorIndex !== -1) {
      key = pair.slice(0, separatorIndex);
      entry = pair.slice(separatorIndex + valueSeparator.length);
    }
    key = decodeComponent(key.replace(/\+/g, '%20'), options?.decodeURIComponent);
    entry = decodeComponent(entry.replace(/\+/g, '%20'), options?.decodeURIComponent);

    if (!Object.hasOwn(result, key)) {
      result[key] = entry;
      continue;
    }
    const current = result[key];
    if (Array.isArray(current)) {
      current.push(entry);
      continue;
    }
    result[key] = [current, entry];
  }

  return result;
}

export const decode = parse;

function stringifyValue(value: QueryValue): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function isQueryArray(value: QueryValue): value is QueryValue[] {
  return Array.isArray(value);
}

export function stringify(
  value: QueryStringInput,
  separator?: string,
  assignment?: string,
  options?: StringifyOptions
): string {
  if (value === null || typeof value !== 'object') return '';

  const pairSeparator = separator || '&';
  const valueSeparator = assignment || '=';
  const encode = options?.encodeURIComponent ?? escape;
  const record = value as Record<string, QueryValue>;
  const pairs: string[] = [];

  for (const key of Object.keys(value)) {
    const current = record[key];
    const encodedKey = encode(key);
    if (isQueryArray(current)) {
      for (const item of current) {
        pairs.push(`${encodedKey}${valueSeparator}${encode(stringifyValue(item))}`);
      }
      continue;
    }
    pairs.push(`${encodedKey}${valueSeparator}${encode(stringifyValue(current))}`);
  }

  return pairs.join(pairSeparator);
}

export const encode = stringify;

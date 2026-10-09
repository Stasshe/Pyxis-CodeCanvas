import type { ExtensionManifest, InstalledExtension } from '@/engine/extensions/types';

export interface ExtensionPack<T> {
  id: string;
  name: string;
  extensions: T[];
  type: 'installed' | 'available';
}

type Grouped<T> = { packs: ExtensionPack<T>[]; others: T[] };
type SearchResult<T> = Grouped<T> & { packsToExpand: string[] };

function groupByPack<T>(
  extensions: T[],
  getPack: (extension: T) => { id: string; name: string } | undefined,
  type: ExtensionPack<T>['type'],
  idSuffix = ''
): Grouped<T> {
  const groups = new Map<string, { name: string; extensions: T[] }>();
  const others: T[] = [];
  for (const extension of extensions) {
    const pack = getPack(extension);
    if (!pack) {
      others.push(extension);
      continue;
    }
    const group = groups.get(pack.id);
    if (group) group.extensions.push(extension);
    else groups.set(pack.id, { name: pack.name, extensions: [extension] });
  }

  const packs = Array.from(groups, ([id, group]) => ({
    id: `${id}${idSuffix}`,
    name: group.name,
    extensions: group.extensions,
    type,
  }));
  return { packs, others };
}

function searchGrouped<T>(
  filtered: T[],
  grouped: Grouped<T>,
  getId: (extension: T) => string
): SearchResult<T> {
  const packs: ExtensionPack<T>[] = [];
  const others: T[] = [];
  const packsToExpand: string[] = [];
  const filteredIds = new Set(filtered.map(getId));

  for (const extension of filtered) {
    const pack = grouped.packs.find(group =>
      group.extensions.some(item => getId(item) === getId(extension))
    );
    if (!pack) {
      others.push(extension);
      continue;
    }
    if (packs.some(group => group.id === pack.id)) continue;
    const matchingExtensions = pack.extensions.filter(item => filteredIds.has(getId(item)));
    packs.push({
      ...pack,
      extensions: matchingExtensions,
    });
    packsToExpand.push(pack.id);
  }
  return { packs, others, packsToExpand };
}

function matchesQuery(query: string, fields: string[]): boolean {
  const normalized = query.trim().toLowerCase();
  return !normalized || fields.some(field => field.toLowerCase().includes(normalized));
}

export function processInstalledExtensions(
  extensions: InstalledExtension[],
  query: string
): SearchResult<InstalledExtension> {
  const grouped = groupByPack(extensions, extension => extension.manifest.packGroup, 'installed');
  if (!query.trim()) return { ...grouped, packsToExpand: [] };
  const filtered = extensions.filter(extension =>
    matchesQuery(query, [
      extension.manifest.name,
      extension.manifest.id,
      extension.manifest.description,
    ])
  );
  return searchGrouped(filtered, grouped, extension => extension.manifest.id);
}

export function processAvailableExtensions(
  extensions: ExtensionManifest[],
  query: string
): SearchResult<ExtensionManifest> {
  const grouped = groupByPack(
    extensions,
    extension => extension.packGroup,
    'available',
    '-available'
  );
  if (!query.trim()) return { ...grouped, packsToExpand: [] };
  const filtered = extensions.filter(extension =>
    matchesQuery(query, [extension.name, extension.id, extension.description])
  );
  return searchGrouped(filtered, grouped, extension => extension.id);
}

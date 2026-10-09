function isIPv4(input: unknown): input is string {
  if (typeof input !== 'string') return false;
  const parts = input.split('.');
  if (parts.length !== 4) return false;

  return parts.every(part => {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return false;
    return Number(part) <= 255;
  });
}

function isIPv6(input: unknown): input is string {
  if (typeof input !== 'string') return false;
  let address = input;
  const zoneIndex = address.indexOf('%');
  if (zoneIndex !== -1) {
    if (address.indexOf('%', zoneIndex + 1) !== -1) return false;
    const zone = address.slice(zoneIndex + 1);
    if (!/^[A-Za-z0-9.:-]+$/.test(zone)) return false;
    address = address.slice(0, zoneIndex);
  }

  if (!address.includes(':')) return false;
  const hasCompression = address.includes('::');
  if (hasCompression && address.indexOf('::') !== address.lastIndexOf('::')) return false;
  if (address.startsWith(':') && !address.startsWith('::')) return false;
  if (address.endsWith(':') && !address.endsWith('::')) return false;

  const groups = address.split(':').filter(Boolean);
  let groupCount = 0;
  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index];
    if (group.includes('.')) {
      if (index !== groups.length - 1 || !address.endsWith(group) || !isIPv4(group)) return false;
      groupCount += 2;
    } else {
      if (!/^[\da-fA-F]{1,4}$/.test(group)) return false;
      groupCount += 1;
    }
  }

  if (hasCompression) return groupCount < 8;
  return groupCount === 8;
}

export function isIP(input: unknown): 0 | 4 | 6 {
  if (isIPv4(input)) return 4;
  if (isIPv6(input)) return 6;
  return 0;
}

export { isIPv4, isIPv6 };

const ALGORITHMS = [
  { name: 'sha512', digest: 'SHA-512' },
  { name: 'sha384', digest: 'SHA-384' },
  { name: 'sha256', digest: 'SHA-256' },
  { name: 'sha1', digest: 'SHA-1' },
];

export async function verifyIntegrity(
  bytes: Uint8Array<ArrayBuffer>,
  integrity?: string
): Promise<void> {
  if (!integrity) return;
  const tokens = integrity.trim().split(/\s+/);
  for (const algorithm of ALGORITHMS) {
    const hashes = tokens.filter(token => token.startsWith(`${algorithm.name}-`));
    if (hashes.length === 0) continue;
    const digest = new Uint8Array(await crypto.subtle.digest(algorithm.digest, bytes));
    const encoded = btoa(String.fromCharCode(...digest));
    if (hashes.some(hash => hash.split('?')[0] === `${algorithm.name}-${encoded}`)) return;
    throw new Error(`Tarball integrity mismatch (${algorithm.name})`);
  }
  throw new Error('Unsupported tarball integrity algorithm');
}

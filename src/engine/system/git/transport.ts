export function validateRemoteUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid repository URL');
  }

  if (parsed.username || parsed.password) {
    throw new Error('Repository URL must not contain credentials');
  }
}

export async function rejectGitAuthentication(): Promise<never> {
  throw new Error('Git authentication is unavailable through the public CORS proxy');
}

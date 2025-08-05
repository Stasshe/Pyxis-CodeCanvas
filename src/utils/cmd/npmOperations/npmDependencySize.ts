import { exec } from 'child_process';

/**
 * Calculate the total size of a package and its dependencies before installation.
 * @param packageName The name of the npm package to analyze.
 * @returns A promise that resolves to the total size in kilobytes.
 */
export async function calculateDependencySize(packageName: string): Promise<number> {
  return new Promise((resolve, reject) => {
    // Use the `npm pack` command to fetch the tarball size without installing
    exec(`npm view ${packageName} dist.tarball`, (error, stdout, stderr) => {
      if (error) {
        reject(`Error fetching package info: ${stderr || error.message}`);
        return;
      }

      const tarballUrl = stdout.trim();

      if (!tarballUrl) {
        reject('Could not retrieve tarball URL.');
        return;
      }

      // Use `npm install --dry-run` to calculate the size of dependencies
      exec(`npm install ${packageName} --dry-run --json`, (installError, installStdout, installStderr) => {
        if (installError) {
          reject(`Error during dry-run install: ${installStderr || installError.message}`);
          return;
        }

        try {
          const installData = JSON.parse(installStdout);
          const totalSize = calculateSizeFromDependencies(installData);
          resolve(totalSize);
        } catch (parseError) {
          reject(`Error parsing install data: ${(parseError as Error).message}`);
        }
      });
    });
  });
}

/**
 * Helper function to calculate size from dependency data.
 * @param installData The JSON data from `npm install --dry-run`.
 * @returns The total size in kilobytes.
 */
function calculateSizeFromDependencies(installData: any): number {
  let totalSize = 0;

  if (installData && installData.dependencies) {
    for (const depName in installData.dependencies) {
      const dep = installData.dependencies[depName];
      if (dep.resolved && dep.integrity) {
        totalSize += dep.size || 0; // Add size if available
      }
    }
  }

  return totalSize / 1024; // Convert bytes to kilobytes
}

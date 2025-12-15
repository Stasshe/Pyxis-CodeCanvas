/**
 * Calculate the total size of a package and its dependencies using package.json.
 * This method is designed to work in a browser environment.
 * @param packageName The name of the npm package to analyze.
 * @param installedPackages A set of already installed packages to exclude from the size calculation.
 * @returns A promise that resolves to the total size in kilobytes.
 */
export async function calculateDependencySize(
  packageName: string,
  installedPackages: Set<string> = new Set()
): Promise<number> {
  try {
    if (installedPackages.has(packageName)) {
      return 0 // Skip already installed packages
    }

    const response = await fetch(`https://registry.npmjs.org/${packageName}`)
    if (!response.ok) {
      throw new Error(`Failed to fetch package info for ${packageName}`)
    }

    const packageData = await response.json()
    const latestVersion = packageData['dist-tags'].latest
    const tarballUrl = packageData.versions[latestVersion].dist.tarball

    // Debugging: Log tarball URL
    console.log(`Fetching tarball size for: ${tarballUrl}`)

    // Fetch tarball size using GET request if HEAD fails
    const tarballSize = await fetch(tarballUrl, { method: 'HEAD' })
      .then(res => {
        const contentLength = res.headers.get('Content-Length')
        if (contentLength) {
          return Number.parseInt(contentLength, 10)
        } else {
          console.warn(`Content-Length missing for ${tarballUrl}, falling back to GET request.`)
          return fetch(tarballUrl)
            .then(getRes => getRes.body?.getReader().read())
            .then(result => result?.value?.length || 0)
            .catch(() => 0)
        }
      })
      .catch(error => {
        console.error(`Failed to fetch tarball size for ${tarballUrl}:`, error)
        return 0
      })

    installedPackages.add(packageName) // Mark this package as installed

    const dependencies = packageData.versions[latestVersion].dependencies || {}
    let totalSize = tarballSize

    for (const depName of Object.keys(dependencies)) {
      totalSize += await calculateDependencySize(depName, installedPackages)
    }

    return totalSize / 1024 // Convert bytes to kilobytes
  } catch (error) {
    console.error(`Error calculating dependency size for ${packageName}:`, error)
    throw new Error(`Error calculating dependency size: ${(error as Error).message}`)
  }
}

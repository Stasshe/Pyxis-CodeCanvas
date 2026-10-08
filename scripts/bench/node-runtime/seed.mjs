import diffFixtures from './runtime-diff-fixture.json';
import runtimeFixtures from './runtime-fixtures.json';

export async function seedRuntimeBenchmarks() {
  const { fsClient } = await import('/src/engine/core/fs/client.ts');
  const rootPath = runtimeFixtures.rootPath;
  const files = [...runtimeFixtures.files, ...diffFixtures.files];

  for (const file of files) {
    const parentPath = file.path.slice(0, file.path.lastIndexOf('/'));
    await fsClient.mkdir(parentPath, { recursive: true });
    await fsClient.writeFile(file.path, file.content);
  }

  return {
    rootPath,
    fileCount: files.length,
    commands: [...runtimeFixtures.commands, diffFixtures.command],
  };
}

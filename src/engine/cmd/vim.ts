import { fileRepository } from '@/engine/core/fileRepository';

// ミニマムな vim ハンドラ（現時点ではファイル内容を表示するだけのスタブ）
export async function handleVimCommand(
  args: string[],
  unixCommandsRef: { current: any } | null,
  captureWriteOutput: (output: string) => Promise<void> | void,
  currentProject: string,
  currentProjectId: string
) {
  const write = async (s: string) => {
    try {
      await captureWriteOutput(s);
    } catch {
      // ignore
    }
  };

  if (!args || args.length === 0) {
    await write('Usage: vim <file>\n');
    return;
  }

  let entryPath = args[0];
  try {
    if (unixCommandsRef && unixCommandsRef.current) {
      if (!entryPath.startsWith('/')) {
        const cwd = await unixCommandsRef.current.pwd();
        const combined = cwd.replace(/\/$/, '') + '/' + entryPath;
        entryPath = unixCommandsRef.current.normalizePath(combined);
      } else {
        entryPath = unixCommandsRef.current.normalizePath(entryPath);
      }
    }
  } catch (e) {
    // resolve 失敗時は元のパスを使う
    entryPath = args[0];
  }

  try {
    const relativePath = unixCommandsRef?.current
      ? unixCommandsRef.current.getRelativePathFromProject(entryPath)
      : entryPath;

    const files = await fileRepository.getProjectFiles(currentProjectId);
    const file = files.find((f: any) => f.path === relativePath);

    if (!file) {
      await write(`vim: ファイルが見つかりません: ${args[0]}\n`);
      await write('ファイルを作成するには `touch <file>` またはエディタで新規作成してください.\n');
      return;
    }

    const content = file.content || '';
    // 行番号付きで表示
    const lines = content.split('\n');
    const numbered = lines.map((l: string, i: number) => `${i + 1}\t${l}`).join('\n');
    await write(`--- ${relativePath} ---\n`);
    await write(numbered + '\n');
    await write('\n-- vim (stub) -- 編集は UI のエディタまたは別実装を使用してください --\n');
  } catch (e) {
    await write(`vim: エラー: ${(e as Error).message}\n`);
  }
}

export default handleVimCommand;

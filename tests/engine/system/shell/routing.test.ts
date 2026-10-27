import { beforeEach, describe, expect, it } from 'vitest';
import { terminalCommandRegistry } from '@/engine/system/terminal/terminalRegistry';
import { setupTestProject } from '../../../_helpers/testProject';

describe('shell descriptor and pipeline routing', () => {
  let rootPath: string;
  let repo: Awaited<ReturnType<typeof setupTestProject>>['repo'];
  let shell: Awaited<ReturnType<typeof terminalCommandRegistry.getShell>>;

  beforeEach(async () => {
    await terminalCommandRegistry.clearAll();
    const project = await setupTestProject('ShellRoutingTest');
    rootPath = project.rootPath;
    repo = project.repo;
    shell = await terminalCommandRegistry.getShell(rootPath);
  });

  it('keeps stderr from every pipeline stage visible', async () => {
    const result = await shell!.run(
      "printf 'first\\n' >&2 | printf 'middle\\n' >&2 | printf 'last\\n' >&2"
    );

    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('first\nmiddle\nlast\n');
    expect(result.code).toBe(0);
  });

  it('does not send redirected upstream stdout into the next stage', async () => {
    const result = await shell!.run("printf 'saved\\n' > upstream.txt | cat");

    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
    expect(new TextDecoder().decode(await repo.readFile(`${rootPath}/upstream.txt`))).toBe(
      'saved\n'
    );
  });

  it('stops before command side effects when a redirection cannot be opened', async () => {
    await repo.writeFile(
      `${rootPath}/side-effect.sh`,
      "printf 'ran\\n' > command-side-effect.txt\n"
    );
    const result = await shell!.run('bash side-effect.sh > missing/output.txt');

    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(await repo.exists(`${rootPath}/missing/output.txt`)).toBe(false);
    expect(await repo.exists(`${rootPath}/command-side-effect.txt`)).toBe(false);
  });

  it('does not open an output after an earlier input redirection fails', async () => {
    const result = await shell!.run('printf ran < missing.txt > never.txt');

    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(await repo.exists(`${rootPath}/never.txt`)).toBe(false);
  });

  it('keeps an output created before a later input redirection fails', async () => {
    const result = await shell!.run('printf ran > created.txt < missing.txt');

    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(new TextDecoder().decode(await repo.readFile(`${rootPath}/created.txt`))).toBe('');
  });

  it('does not skip an earlier failed input when a later input is valid', async () => {
    const result = await shell!.run('cat < missing.txt < /dev/null');

    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe('');
  });

  it('uses the last successful input redirection', async () => {
    await repo.writeFile(`${rootPath}/first.txt`, 'first\n');
    await repo.writeFile(`${rootPath}/second.txt`, 'second\n');
    const result = await shell!.run('cat < first.txt < second.txt');

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('second\n');
    expect(result.stderr).toBe('');
  });

  it('truncates an output before opening it as the command input', async () => {
    await repo.writeFile(`${rootPath}/input.txt`, 'original\n');
    const result = await shell!.run('cat > input.txt < input.txt');

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('');
    expect(new TextDecoder().decode(await repo.readFile(`${rootPath}/input.txt`))).toBe('');
  });

  it('reads an input after a later output redirection truncates the same file', async () => {
    await repo.writeFile(`${rootPath}/input.txt`, 'original\n');
    const result = await shell!.run('cat < input.txt > input.txt');

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('');
    expect(new TextDecoder().decode(await repo.readFile(`${rootPath}/input.txt`))).toBe('');
  });

  it('reports a failed stderr redirection on the original stderr', async () => {
    const result = await shell!.run("printf 'ran' 2> missing/out.txt");

    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Redirection failed');
    expect(await repo.exists(`${rootPath}/missing/out.txt`)).toBe(false);
  });

  it('routes a later redirection diagnostic to an earlier stderr file', async () => {
    const result = await shell!.run("printf 'ran' 2> errors.txt > missing/out.txt");

    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
    expect(await repo.exists(`${rootPath}/missing/out.txt`)).toBe(false);
    expect(new TextDecoder().decode(await repo.readFile(`${rootPath}/errors.txt`))).not.toBe('');
  });

  it('preserves descriptor snapshots for >&2 followed by stderr redirection', async () => {
    const result = await shell!.run("printf 'to-original-stderr\\n' >&2 2>captured.txt");

    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('to-original-stderr\n');
    expect(new TextDecoder().decode(await repo.readFile(`${rootPath}/captured.txt`))).toBe('');
  });

  it('applies stdout redirection before duplicating it to stderr', async () => {
    const result = await shell!.run("printf 'stdout\\n' > captured.txt 2>&1");

    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
    expect(new TextDecoder().decode(await repo.readFile(`${rootPath}/captured.txt`))).toBe(
      'stdout\n'
    );
  });

  it('keeps stderr attached to the original pipe when stdout is redirected later', async () => {
    await repo.writeFile(`${rootPath}/stderr-only.sh`, "printf 'stderr\\n' >&2\n");
    const result = await shell!.run('bash stderr-only.sh 2>&1 > captured.txt | cat');

    expect(result.stdout).toBe('stderr\n');
    expect(result.stderr).toBe('');
    expect(new TextDecoder().decode(await repo.readFile(`${rootPath}/captured.txt`))).toBe('');
  });

  it('creates and truncates every output target in redirection order', async () => {
    const result = await shell!.run("printf 'final\\n' > first.txt > second.txt");

    expect(result.code).toBe(0);
    expect(new TextDecoder().decode(await repo.readFile(`${rootPath}/first.txt`))).toBe('');
    expect(new TextDecoder().decode(await repo.readFile(`${rootPath}/second.txt`))).toBe('final\n');
  });

  it('preserves event order through duplicated descriptors sharing one file', async () => {
    await repo.writeFile(
      `${rootPath}/ordered.sh`,
      "printf 'first\\n'; printf 'second\\n' >&2; printf 'third\\n'\n"
    );
    const result = await shell!.run('bash ordered.sh > shared.txt 2>&1');

    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
    expect(new TextDecoder().decode(await repo.readFile(`${rootPath}/shared.txt`))).toBe(
      'first\nsecond\nthird\n'
    );
  });

  it('opens the same path independently for stdout and stderr redirections', async () => {
    await repo.writeFile(
      `${rootPath}/independent.sh`,
      "printf 'stdout-long\\n'; printf 'err\\n' >&2\n"
    );
    const result = await shell!.run('bash independent.sh > both.txt 2> both.txt');

    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
    expect(new TextDecoder().decode(await repo.readFile(`${rootPath}/both.txt`))).toBe(
      'err\nut-long\n'
    );
  });

  it('keeps a saved copy of the original stdout after redirecting fd 1', async () => {
    const result = await shell!.run("printf 'saved\\n' 3>&1 > captured.txt 1>&3");

    expect(result.stdout).toBe('saved\n');
    expect(result.stderr).toBe('');
    expect(new TextDecoder().decode(await repo.readFile(`${rootPath}/captured.txt`))).toBe('');
  });

  it('fails when a command duplicates an unopened descriptor', async () => {
    const result = await shell!.run("printf 'hidden\\n' 1>&9");

    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).not.toBe('');
  });

  it('fails when a command writes to a closed stdout descriptor', async () => {
    const result = await shell!.run("printf 'closed' >&-");

    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Bad file descriptor');
  });

  it('allows a command to close an unused descriptor', async () => {
    const result = await shell!.run('true 3>&-');

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });

  it('attempts a failed output open independently in every pipeline stage', async () => {
    const result = await shell!.run(
      "printf 'first' > missing/out.txt | printf 'second' >> missing/out.txt"
    );
    const redirectionErrors = result.stderr.match(/Redirection failed/g) ?? [];

    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(redirectionErrors).toHaveLength(2);
    expect(await repo.exists(`${rootPath}/missing/out.txt`)).toBe(false);
  });

  it('uses an explicit input redirection instead of the pipeline input', async () => {
    await repo.writeFile(`${rootPath}/input.txt`, 'from-file\n');
    const result = await shell!.run("printf 'from-pipe\\n' | cat < input.txt");

    expect(result.stdout).toBe('from-file\n');
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
  });

  it('passes pipeline input through a compound group', async () => {
    const result = await shell!.run("printf 'payload' | { printf 'prefix'; cat; }");

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('prefixpayload');
    expect(result.stderr).toBe('');
  });

  it('appends output and discards redirected output sent to /dev/null', async () => {
    await repo.writeFile(`${rootPath}/append.txt`, 'before');
    const result = await shell!.run("printf 'after' >> append.txt; printf 'hidden' > /dev/null");

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
    expect(new TextDecoder().decode(await repo.readFile(`${rootPath}/append.txt`))).toBe(
      'beforeafter'
    );
  });

  it('treats a relative dev/null path as a regular file', async () => {
    await repo.mkdir(`${rootPath}/dev`, { recursive: true });
    const result = await shell!.run("printf 'saved' > dev/null");

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
    expect(new TextDecoder().decode(await repo.readFile(`${rootPath}/dev/null`))).toBe('saved');
  });

  it('returns the last command status by default and the rightmost failure with pipefail', async () => {
    const defaultStatus = await shell!.run('false | true');
    const pipefailStatus = await shell!.run('set -o pipefail; false | true');

    expect(defaultStatus.code).toBe(0);
    expect(pipefailStatus.code).toBe(1);
    expect(defaultStatus.stdout).toBe('');
    expect(defaultStatus.stderr).toBe('');
    expect(pipefailStatus.stdout).toBe('');
    expect(pipefailStatus.stderr).toBe('');
  });
});

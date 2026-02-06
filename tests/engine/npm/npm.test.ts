import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestProject } from '../../helpers/testProject';
import { fileRepository } from '@/engine/core/fileRepository';
import { NpmCommands } from '@/engine/cmd/global/npm';

/**
 * NpmCommands 統合テスト
 *
 * 本物の npm レジストリ (registry.npmjs.org) からパッケージを取得する。
 * mock なし。本番環境とほぼ同じ動作パスを通る。
 */

describe('NpmCommands 統合テスト', () => {
  let projectId: string;
  let projectName: string;

  /** fetchFn 省略 → globalThis.fetch を使う (本物のレジストリ) */
  function createNpm() {
    return new NpmCommands(projectName, projectId, `/projects/${projectName}`);
  }

  beforeEach(async () => {
    const ctx = await setupTestProject('NpmTestProject');
    projectId = ctx.projectId;
    projectName = ctx.projectName;
  });

  // ==================== npm init ====================

  describe('npm init', () => {
    it('package.json が存在しない場合に作成する', async () => {
      const npm = createNpm();
      const result = await npm.init();
      expect(result).toContain('Wrote to /package.json');
      expect(result).toContain('"name": "NpmTestProject"');

      const file = await fileRepository.getFileByPath(projectId, '/package.json');
      expect(file).not.toBeNull();
      const pkg = JSON.parse(file!.content);
      expect(pkg.name).toBe('NpmTestProject');
      expect(pkg.version).toBe('1.0.0');
      expect(pkg.dependencies).toEqual({});
      expect(pkg.devDependencies).toEqual({});
    });

    it('既存の package.json がある場合は拒否する', async () => {
      await fileRepository.createFile(
        projectId,
        '/package.json',
        JSON.stringify({ name: 'existing', version: '2.0.0' }),
        'file'
      );

      const npm = createNpm();
      const result = await npm.init();
      expect(result).toContain('already exists');
      expect(result).toContain('--force');

      const file = await fileRepository.getFileByPath(projectId, '/package.json');
      const pkg = JSON.parse(file!.content);
      expect(pkg.version).toBe('2.0.0');
    });

    it('--force で既存 package.json を上書きする', async () => {
      await fileRepository.createFile(
        projectId,
        '/package.json',
        JSON.stringify({ name: 'old', version: '0.0.1' }),
        'file'
      );

      const npm = createNpm();
      const result = await npm.init(true);
      expect(result).toContain('Wrote to /package.json');

      const file = await fileRepository.getFileByPath(projectId, '/package.json');
      const pkg = JSON.parse(file!.content);
      expect(pkg.name).toBe('NpmTestProject');
      expect(pkg.version).toBe('1.0.0');
    });
  });

  // ==================== npm list ====================

  describe('npm list', () => {
    it('package.json がない場合のエラー', async () => {
      const npm = createNpm();
      const result = await npm.list();
      expect(result).toContain('Cannot find package.json');
    });

    it('依存関係なしの場合', async () => {
      await fileRepository.createFile(
        projectId,
        '/package.json',
        JSON.stringify({ name: 'myapp', version: '1.0.0' }),
        'file'
      );

      const npm = createNpm();
      const result = await npm.list();
      // list() は this.projectName を使うため NpmTestProject になる
      expect(result).toContain(`${projectName}@1.0.0`);
      expect(result).toContain('(empty)');
    });

    it('dependencies と devDependencies を表示する', async () => {
      await fileRepository.createFile(
        projectId,
        '/package.json',
        JSON.stringify({
          name: 'myapp',
          version: '1.0.0',
          dependencies: { lodash: '^4.17.21', express: '^4.18.0' },
          devDependencies: { vitest: '^1.0.0' },
        }),
        'file'
      );

      const npm = createNpm();
      const result = await npm.list();
      expect(result).toContain(`${projectName}@1.0.0`);
      expect(result).toContain('lodash@^4.17.21');
      expect(result).toContain('express@^4.18.0');
      expect(result).toContain('vitest@^1.0.0');
      expect(result).toContain('(dev)');
    });

    it('ツリーコネクタが正しい (├── / └──)', async () => {
      await fileRepository.createFile(
        projectId,
        '/package.json',
        JSON.stringify({
          name: 'app',
          version: '1.0.0',
          dependencies: { a: '1.0.0', b: '2.0.0' },
        }),
        'file'
      );

      const npm = createNpm();
      const result = await npm.list();
      expect(result).toContain('├── a@1.0.0');
      expect(result).toContain('└── b@2.0.0');
    });
  });

  // ==================== npm run ====================

  describe('npm run', () => {
    it('package.json がない場合のエラー', async () => {
      const npm = createNpm();
      const result = await npm.run('test');
      expect(result).toContain('Cannot find package.json');
    });

    it('存在しないスクリプトでエラーと利用可能スクリプト一覧', async () => {
      await fileRepository.createFile(
        projectId,
        '/package.json',
        JSON.stringify({
          name: 'app',
          version: '1.0.0',
          scripts: { test: 'echo test', build: 'echo build' },
        }),
        'file'
      );

      const npm = createNpm();
      const result = await npm.run('deploy');
      expect(result).toContain("script 'deploy' not found");
      expect(result).toContain('test');
      expect(result).toContain('build');
    });

    it('scripts が空の場合は利用可能スクリプト一覧を表示しない', async () => {
      await fileRepository.createFile(
        projectId,
        '/package.json',
        JSON.stringify({ name: 'app', version: '1.0.0', scripts: {} }),
        'file'
      );

      const npm = createNpm();
      const result = await npm.run('missing');
      expect(result).toContain("script 'missing' not found");
      expect(result).not.toContain('Available scripts');
    });

    it('スクリプトを実行する', async () => {
      await fileRepository.createFile(
        projectId,
        '/package.json',
        JSON.stringify({
          name: 'app',
          version: '1.0.0',
          scripts: { test: 'echo "hello"' },
        }),
        'file'
      );

      const npm = createNpm();
      const result = await npm.run('test');
      expect(result).toContain(`> ${projectName}@1.0.0 test`);
      expect(result).toContain('echo "hello"');
    });
  });

  // ==================== npm uninstall ====================

  describe('npm uninstall', () => {
    it('package.json がない場合のエラー', async () => {
      const npm = createNpm();
      const result = await npm.uninstall('lodash');
      expect(result).toContain('Cannot find package.json');
    });

    it('依存関係に存在しないパッケージの警告', async () => {
      await fileRepository.createFile(
        projectId,
        '/package.json',
        JSON.stringify({
          name: 'app',
          version: '1.0.0',
          dependencies: { express: '^4.18.0' },
          devDependencies: {},
        }),
        'file'
      );

      const npm = createNpm();
      const result = await npm.uninstall('lodash');
      expect(result).toContain('WARN');
      expect(result).toContain('lodash');
      expect(result).toContain('not a dependency');
    });

    it('dependencies からパッケージを削除する', async () => {
      await fileRepository.createFile(
        projectId,
        '/package.json',
        JSON.stringify({
          name: 'app',
          version: '1.0.0',
          dependencies: { lodash: '^4.17.21', express: '^4.18.0' },
          devDependencies: {},
        }),
        'file'
      );
      await fileRepository.createFile(
        projectId,
        '/node_modules/lodash/package.json',
        JSON.stringify({ name: 'lodash', version: '4.17.21' }),
        'file'
      );
      await fileRepository.createFile(
        projectId,
        '/node_modules/lodash/index.js',
        'module.exports = {}',
        'file'
      );

      const npm = createNpm();
      const result = await npm.uninstall('lodash');
      expect(result).toContain('removed');

      const file = await fileRepository.getFileByPath(projectId, '/package.json');
      const pkg = JSON.parse(file!.content);
      expect(pkg.dependencies.lodash).toBeUndefined();
      expect(pkg.dependencies.express).toBe('^4.18.0');
    });

    it('devDependencies からパッケージを削除する', async () => {
      await fileRepository.createFile(
        projectId,
        '/package.json',
        JSON.stringify({
          name: 'app',
          version: '1.0.0',
          dependencies: {},
          devDependencies: { vitest: '^1.0.0' },
        }),
        'file'
      );
      await fileRepository.createFile(
        projectId,
        '/node_modules/vitest/package.json',
        JSON.stringify({ name: 'vitest', version: '1.0.0' }),
        'file'
      );

      const npm = createNpm();
      const result = await npm.uninstall('vitest');
      expect(result).toContain('removed');

      const file = await fileRepository.getFileByPath(projectId, '/package.json');
      const pkg = JSON.parse(file!.content);
      expect(pkg.devDependencies.vitest).toBeUndefined();
    });
  });

  // ==================== npm install (引数なし) ====================

  describe('npm install (引数なし)', () => {
    it('依存関係が空の場合の up to date メッセージ', async () => {
      await fileRepository.createFile(
        projectId,
        '/package.json',
        JSON.stringify({
          name: 'app',
          version: '1.0.0',
          dependencies: {},
          devDependencies: {},
        }),
        'file'
      );

      const npm = createNpm();
      const result = await npm.install();
      expect(result).toContain('up to date');
      expect(result).toContain('audited 0 packages');
    });
  });

  // ==================== npm install — 本物のレジストリから ====================

  describe('npm install (実際のレジストリ)', () => {
    it(
      'kleur をインストールして package.json と node_modules を検証',
      async () => {
        await fileRepository.createFile(
          projectId,
          '/package.json',
          JSON.stringify({
            name: 'app',
            version: '1.0.0',
            dependencies: {},
            devDependencies: {},
          }),
          'file'
        );

        const npm = createNpm();
        const result = await npm.install('kleur');

        // 出力にパッケージ追加が記録される
        expect(result).toContain('added');
        expect(result).toContain('package');

        // package.json に kleur が追加されている
        const file = await fileRepository.getFileByPath(projectId, '/package.json');
        const pkg = JSON.parse(file!.content);
        expect(pkg.dependencies['kleur']).toBeDefined();
        expect(pkg.dependencies['kleur']).toMatch(/^\^/); // semver prefix

        // node_modules/kleur/package.json が存在する
        const kleurPkg = await fileRepository.getFileByPath(
          projectId,
          '/node_modules/kleur/package.json'
        );
        expect(kleurPkg).not.toBeNull();
        const kleur = JSON.parse(kleurPkg!.content);
        expect(kleur.name).toBe('kleur');

        // エントリファイルが存在する
        const kleurFiles = await fileRepository.getFilesByPrefix(
          projectId,
          '/node_modules/kleur/'
        );
        expect(kleurFiles.length).toBeGreaterThan(1);
      },
      30000
    );

    it(
      '--save-dev でパッケージを devDependencies に追加する',
      async () => {
        await fileRepository.createFile(
          projectId,
          '/package.json',
          JSON.stringify({
            name: 'app',
            version: '1.0.0',
            dependencies: {},
            devDependencies: {},
          }),
          'file'
        );

        const npm = createNpm();
        await npm.install('kleur', ['--save-dev']);

        const file = await fileRepository.getFileByPath(projectId, '/package.json');
        const pkg = JSON.parse(file!.content);
        expect(pkg.devDependencies['kleur']).toBeDefined();
        expect(pkg.dependencies['kleur']).toBeUndefined();
      },
      30000
    );

    it(
      '-D フラグも --save-dev と同等',
      async () => {
        await fileRepository.createFile(
          projectId,
          '/package.json',
          JSON.stringify({
            name: 'app',
            version: '1.0.0',
            dependencies: {},
            devDependencies: {},
          }),
          'file'
        );

        const npm = createNpm();
        await npm.install('kleur', ['-D']);

        const file = await fileRepository.getFileByPath(projectId, '/package.json');
        const pkg = JSON.parse(file!.content);
        expect(pkg.devDependencies['kleur']).toBeDefined();
      },
      30000
    );

    it(
      '既に package.json と node_modules に存在する場合は up to date',
      async () => {
        // まず本物のインストール
        await fileRepository.createFile(
          projectId,
          '/package.json',
          JSON.stringify({
            name: 'app',
            version: '1.0.0',
            dependencies: {},
            devDependencies: {},
          }),
          'file'
        );

        const npm = createNpm();
        await npm.install('kleur');

        // 2 回目は up to date になる
        const result = await npm.install('kleur');
        expect(result).toContain('up to date');
      },
      60000
    );

    it(
      '存在しないパッケージで 404 エラー',
      async () => {
        await fileRepository.createFile(
          projectId,
          '/package.json',
          JSON.stringify({
            name: 'app',
            version: '1.0.0',
            dependencies: {},
            devDependencies: {},
          }),
          'file'
        );

        const npm = createNpm();
        await expect(npm.install('nonexistent-pkg-xyz-99999')).rejects.toThrow(
          /not found|404/i
        );
      },
      15000
    );

    it(
      'package.json がない状態で npm install するとpackage.jsonが自動生成される',
      async () => {
        const before = await fileRepository.getFileByPath(projectId, '/package.json');
        expect(before).toBeNull();

        const npm = createNpm();
        const result = await npm.install('kleur');
        expect(result).toContain('added');

        const after = await fileRepository.getFileByPath(projectId, '/package.json');
        expect(after).not.toBeNull();
        const pkg = JSON.parse(after!.content);
        expect(pkg.name).toBe('NpmTestProject');
        expect(pkg.dependencies['kleur']).toBeDefined();
      },
      30000
    );
  });
});

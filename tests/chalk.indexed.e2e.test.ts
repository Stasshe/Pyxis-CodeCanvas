import fs from 'fs';
import path from 'path';
// use the real transpile implementation (not worker runtime)
import { transpile } from '@/engine/runtime/transpileWorker';
import { TranspileRequest } from '@/engine/runtime/transpileWorker';

// Use the production FileRepository API so tests store files the same way
import { fileRepository } from '@/engine/core/fileRepository';

// Recursively copy a package and its dependencies from node_modules into the production FileRepository
async function copyPackageToFileRepository(pkgName: string, projectId: string, visited = new Set<string>()) {
  if (visited.has(pkgName)) return;
  visited.add(pkgName);

  const pkgRoot = path.join(process.cwd(), 'node_modules', pkgName);
  const pkgJsonPath = path.join(pkgRoot, 'package.json');
  if (!fs.existsSync(pkgJsonPath)) throw new Error(`Package not found: ${pkgName}`);

  const pkgJsonRaw = fs.readFileSync(pkgJsonPath, 'utf8');
  // store under /node_modules/<pkg>/package.json
  await fileRepository.createFile(projectId, `/node_modules/${pkgName}/package.json`, pkgJsonRaw, 'file');

  const pkgJson = JSON.parse(pkgJsonRaw);

  // Walk files in package root and subdirectories
  const walk = (dir: string, relBase = '') => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(full, rel);
      } else if (entry.isFile()) {
        // store file content under /node_modules/<pkg>/<rel>
        const content = fs.readFileSync(full, 'utf8');
        fileRepository.createFile(projectId, `/node_modules/${pkgName}/${rel}`, content, 'file').catch(e => {
          throw e;
        });
      }
    }
  };

  walk(pkgRoot);

  // Recurse dependencies
  const deps = Object.assign({}, pkgJson.dependencies || {}, pkgJson.peerDependencies || {});
  for (const dep of Object.keys(deps)) {
    await copyPackageToFileRepository(dep, projectId, visited);
  }
}

// Minimal synchronous CommonJS evaluator using in-memory cache populated from IDB
function evaluateCJS(code: string, filename: string, requireFn: (id: string, caller?: string) => any) {
  const module = { exports: {} as any } as any;
  const exports = module.exports;
  const dirname = path.posix.dirname(filename);
  const wrapped = `(function(exports, require, module, __filename, __dirname){${code}\n})`;
  const fn = eval(wrapped); // eslint-disable-line no-eval
  fn(exports, (id: string) => requireFn(id, filename), module, filename, dirname);
  return module.exports;
}

describe('Full IndexedDB load: chalk and deps only from IDB', () => {
  jest.setTimeout(30000);

  test('copy chalk + deps to IDB and load without Node require', async () => {
    // Step 1: create a test project and copy chalk + deps into the project's /node_modules via fileRepository
    const project = await fileRepository.createProject(`test_project_for_chalk_${Date.now()}`);
    const projectId = project.id;

    await copyPackageToFileRepository('chalk', projectId);

    // Step 2: build in-memory file cache by reading all files via fileRepository.getProjectFiles
    const inMemoryFiles: Map<string, string> = new Map();
    const allFiles = await fileRepository.getProjectFiles(projectId);
    for (const f of allFiles) {
      // normalize path stored in production '/node_modules/...' -> strip leading '/'
      const key = f.path.replace(/^\//, '');
      if (f.type === 'file') {
        inMemoryFiles.set(key, f.content || '');
        // also add a package-relative key (e.g., 'chalk/index.js') when under node_modules
        const nmMatch = key.match(/^node_modules\/(.+?)\/(.+)/);
        if (nmMatch) {
          const pkg = nmMatch[1];
          const rest = nmMatch[2];
          // register both 'node_modules/chalk/source/index.js' and 'chalk/source/index.js'
          inMemoryFiles.set(`${pkg}/${rest}`, f.content || '');
        }
      }
    }

    // Ensure we actually loaded something for the target package
    const hasChalkFile = Array.from(inMemoryFiles.keys()).some(k => k.startsWith('node_modules/chalk/') || k.startsWith('chalk/'));
    if (!hasChalkFile) {
      throw new Error('No chalk files found in IndexedDB after copy; copyPackageToIDB failed');
    }

    // Module cache
    const moduleCache = new Map<string, any>();

    // We'll transpile files (TS/JSX/etc) using the real transpile function so CJS/ESM normalization
    // and transforms match production. Build a transpiled cache map: key -> transpiledCode
    const transpiledCache = new Map<string, string>();

    // transpile candidate files
    for (const [key, src] of Array.from(inMemoryFiles.entries())) {
      // only transpile JS/TS-ish text files; skip declaration files
      if (key.endsWith('.d.ts')) continue;
      if (!key.endsWith('.js') && !key.endsWith('.ts') && !key.endsWith('.tsx') && !key.endsWith('.jsx'))
        continue;

      const req: TranspileRequest = {
        id: `test_${key}`,
        code: src,
        filePath: key,
        options: {
          isTypeScript: key.endsWith('.ts') || key.endsWith('.tsx'),
          isESModule: key.endsWith('.mjs') || key.endsWith('.mts') || key.endsWith('.esm') || /\bimport\b|\bexport\b/.test(src),
          isJSX: key.endsWith('.jsx') || key.endsWith('.tsx'),
        },
      };

      try {
        const out = transpile(req);
        let code = out.code || src;
        // normalize async require patterns produced by normalizeCjsEsm to synchronous calls
        // Tests use a synchronous loader; replace `await __require__('x')` -> `__require__('x')`.
        code = code.replace(/\bawait\s+__require__\(/g, '__require__(');
        transpiledCache.set(key, code);
      } catch (e) {
        // if transpile fails, keep original source to aid debugging
        transpiledCache.set(key, src);
      }
    }

    // Resolve requested id to in-memory key
    function resolveKey(requested: string, from: string) {
      if (requested.startsWith('./') || requested.startsWith('../')) {
        const base = path.posix.dirname(from);
        let resolved = path.posix.normalize(path.posix.join(base, requested));
        if (!resolved.endsWith('.js')) resolved = `${resolved}.js`;
        // Remove leading slash
        return resolved.replace(/^\//, '');
      }
      // package name -> determine entry from package.json
      const pkgJsonKey = `${requested}/package.json`;
      const pjRaw = inMemoryFiles.get(pkgJsonKey) || undefined;
      if (pjRaw) {
        try {
          const pj = JSON.parse(pjRaw);
          const entry = pj.main || pj.browser || 'index.js';
          // try direct entry
          const directKey = `${requested}/${entry}`;
          if (inMemoryFiles.has(directKey)) return directKey;
          // if entry is a directory, try entry/index.js
          const maybeIndex = `${requested}/${entry}/index.js`;
          if (inMemoryFiles.has(maybeIndex)) return maybeIndex;
          // fallback to requested/index.js
          return `${requested}/index.js`;
        } catch {
          return `${requested}/index.js`;
        }
      }
      // fallback to requested/index.js
      return `${requested}/index.js`;
    }

    function localRequireSync(id: string, caller: string) {
      const key = resolveKey(id, caller || '');
      if (moduleCache.has(key)) return moduleCache.get(key).exports;

      // prefer transpiled code when available
      const transpiled = transpiledCache.get(key);
      const src = transpiled ?? inMemoryFiles.get(key);
      if (!src) throw new Error(`Module not found in inMemoryFiles/transpileCache: ${key}`);
      const moduleObj = { exports: {} as any } as any;
      moduleCache.set(key, moduleObj);
      const exports = evaluateCJS(src, key, (req: string, _base?: string) => localRequireSync(req, key));
      moduleObj.exports = exports;
      return moduleObj.exports;
    }

    // Evaluate top-level chalk
    const chalkExports = localRequireSync('chalk', '');
    expect(chalkExports).toBeDefined();
    const out = chalkExports.green('ok');
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  });
});

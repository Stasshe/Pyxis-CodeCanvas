// Jest setup: provide IndexedDB in jsdom via fake-indexeddb
import 'fake-indexeddb/auto';

// Optionally expose indexedDB on globalThis for TypeScript tests
(globalThis as any).indexedDB = (globalThis as any).indexedDB || (globalThis as any).indexedDB;

// Provide a short log so tests know setup ran
console.info('[setupIndexedDB] fake-indexeddb initialized');

// Provide a lightweight mock for UI module that coreLogger imports so Jest doesn't parse TSX files.
// The module path must match the real import used in source: '@/components/Bottom/BottomPanel'
try {
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const modulePath = require.resolve('../src/components/Bottom/BottomPanel');
	// Create a runtime manual mock by telling Jest's module system to use a simple stub.
	// In Node/Jest runtime we can pre-populate require cache for that module.
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const fs = require('fs');
	const vm = require('vm');
	const stubCode = `exports.pushMsgOutPanel = function(){ /* noop in tests */ }`;
	const script = new vm.Script(stubCode, { filename: modulePath });
	const moduleExports = { exports: {} };
	const context = vm.createContext({ exports: moduleExports.exports, require, module: moduleExports, console });
	script.runInContext(context);
	// assign to require cache
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(require.cache as any)[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports: moduleExports.exports } as any;
} catch (e) {
	// ignore if resolving fails; some environments won't allow require.resolve for TSX paths
}

// Polyfill structuredClone for environments (jsdom) that don't provide it
if (typeof (globalThis as any).structuredClone === 'undefined') {
	// Use Node's util.structuredClone if available, otherwise fallback to JSON deep clone
	try {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const { structuredClone: nodeStructuredClone } = require('node:util') as any;
		if (typeof nodeStructuredClone === 'function') {
			(globalThis as any).structuredClone = nodeStructuredClone;
		} else {
			(globalThis as any).structuredClone = (v: any) => JSON.parse(JSON.stringify(v));
		}
	} catch {
		(globalThis as any).structuredClone = (v: any) => JSON.parse(JSON.stringify(v));
	}
}

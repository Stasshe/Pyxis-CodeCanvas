export function wrapRuntimeCode(code: string, strict = true): string {
  if (code.startsWith('#!')) code = `//${code}`;

  let directive = '';
  let receiver = 'module.exports';
  if (strict) directive = "'use strict';";
  else receiver = 'globalThis';

  return `
    (function(exports, require, module, __filename, __dirname) {
      ${directive}

      ${code}

    }).call(${receiver}, exports, require, module, __filename, __dirname);
  `;
}

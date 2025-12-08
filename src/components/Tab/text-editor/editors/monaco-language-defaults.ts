import type { Monaco } from '@monaco-editor/react';

/**
 * Configure Monaco language defaults for diagnostics and validation
 * Supports: TypeScript, JavaScript, CSS, SCSS, LESS, JSON, HTML
 */
export function configureMonacoLanguageDefaults(mon: Monaco): void {
  // TypeScript/JavaScript設定
  configureTypeScriptDefaults(mon);
  
  // CSS/SCSS/LESS設定
  configureCSSDefaults(mon);
  
  // JSON設定
  configureJSONDefaults(mon);
  
  // HTML設定
  configureHTMLDefaults(mon);
}

function configureTypeScriptDefaults(mon: Monaco): void {
  const diagnosticsOptions = {
    noSemanticValidation: false,
    noSyntaxValidation: false,
    noSuggestionDiagnostics: false,
  };

  mon.languages.typescript.typescriptDefaults.setDiagnosticsOptions(diagnosticsOptions);
  mon.languages.typescript.javascriptDefaults.setDiagnosticsOptions(diagnosticsOptions);

  const compilerOptions = {
    target: mon.languages.typescript.ScriptTarget.ES2020,
    allowNonTsExtensions: true,
    moduleResolution: mon.languages.typescript.ModuleResolutionKind.NodeJs,
    module: mon.languages.typescript.ModuleKind.CommonJS,
    noEmit: true,
    esModuleInterop: true,
    jsx: mon.languages.typescript.JsxEmit.React,
    reactNamespace: 'React',
    allowJs: true,
    typeRoots: ['node_modules/@types'],
  };

  mon.languages.typescript.typescriptDefaults.setCompilerOptions(compilerOptions);
  mon.languages.typescript.javascriptDefaults.setCompilerOptions(compilerOptions);
}

function configureCSSDefaults(mon: Monaco): void {
  const cssLintOptions = {
    compatibleVendorPrefixes: 'warning' as const,
    vendorPrefix: 'warning' as const,
    duplicateProperties: 'warning' as const,
    emptyRules: 'warning' as const,
    importStatement: 'ignore' as const,
    boxModel: 'ignore' as const,
    universalSelector: 'ignore' as const,
    zeroUnits: 'ignore' as const,
    fontFaceProperties: 'warning' as const,
    hexColorLength: 'error' as const,
    argumentsInColorFunction: 'error' as const,
    unknownProperties: 'warning' as const,
    ieHack: 'ignore' as const,
    unknownVendorSpecificProperties: 'ignore' as const,
    propertyIgnoredDueToDisplay: 'warning' as const,
    important: 'ignore' as const,
    float: 'ignore' as const,
    idSelector: 'ignore' as const,
  };

  const cssOptions = {
    validate: true,
    lint: cssLintOptions,
  };

  mon.languages.css.cssDefaults.setOptions(cssOptions);
}

function configureJSONDefaults(mon: Monaco): void {
  mon.languages.json.jsonDefaults.setDiagnosticsOptions({
    validate: true,
    allowComments: true,
    trailingCommas: 'warning',
    schemaValidation: 'warning',
    schemaRequest: 'warning',
    comments: 'warning',
  });

  // Common JSON schemas
  mon.languages.json.jsonDefaults.setModeConfiguration({
    documentFormattingEdits: true,
    documentRangeFormattingEdits: true,
    completionItems: true,
    hovers: true,
    documentSymbols: true,
    tokens: true,
    colors: true,
    foldingRanges: true,
    diagnostics: true,
    selectionRanges: true,
  });
}

function configureHTMLDefaults(mon: Monaco): void {
  mon.languages.html.htmlDefaults.setOptions({
    format: {
      tabSize: 2,
      insertSpaces: true,
      wrapLineLength: 120,
      unformatted: 'wbr',
      contentUnformatted: 'pre,code,textarea',
      indentInnerHtml: false,
      preserveNewLines: true,
      maxPreserveNewLines: 2,
      indentHandlebars: false,
      endWithNewline: false,
      extraLiners: 'head, body, /html',
      wrapAttributes: 'auto',
    },
    suggest: {
      html5: true,
    },
  });

  // // Also configure handlebars if available
  // try {
  //   mon.languages.html.handlebarDefaults?.setOptions({
  //     format: {
  //       tabSize: 2,
  //       insertSpaces: true,
  //     },
  //     suggest: {
  //       html5: true,
  //     },
  //   });
  // } catch (e) {
  //   // handlebars might not be available
  // }

  // Also configure razor if available
  // try {
  //   mon.languages.html.razorDefaults?.setOptions({
  //     format: {
  //       tabSize: 2,
  //       insertSpaces: true,
  //     },
  //     suggest: {
  //       html5: true,
  //     },
  //   });
  // } catch (e) {
  //   // razor might not be available
  // }
}

import type katex from 'katex';

export type ExtensionMarkdownGlobals = {
  ReactMarkdown: typeof import('react-markdown').default;
  remarkGfm: typeof import('remark-gfm').default;
  remarkMath: typeof import('remark-math').default;
  rehypeKatex: typeof import('rehype-katex').default;
  rehypeRaw: typeof import('rehype-raw').default;
  katex: typeof katex;
};

declare global {
  interface Window {
    __PYXIS_REACT__?: typeof import('react');
    __PYXIS_REACT_DOM__?: typeof import('react-dom') & typeof import('react-dom/client');
    __PYXIS_MARKDOWN__?: ExtensionMarkdownGlobals;
  }
}

type DefaultOrNamespace<Module> = Module extends { default: infer Default } ? Default : Module;

export function defaultOrNamespace<Module extends object>(
  module: Module
): DefaultOrNamespace<Module> {
  if ('default' in module) return module.default as DefaultOrNamespace<Module>;
  return module as DefaultOrNamespace<Module>;
}

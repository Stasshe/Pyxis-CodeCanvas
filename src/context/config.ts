export const LOCALSTORAGE_KEY = {
  GEMINI_API_KEY: 'gemini-api-key',
  MONACO_WORD_WRAP: 'pyxis-monaco-word-wrap',
  RECENT_PROJECTS: 'pyxis-recent-projects',
  EDITOR_LAYOUT: 'pyxis-editor-layout',
  DEFAULT_EDITOR: 'pyxis-defaultEditor',
};

export const DEFAULT_VALUES = {
  DEFAULT_EDITOR: 'monaco',
  AI_MODEL: 'gemini-2.0-flash',
};

export const AI_MODELS = [
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', fast: true },
] as const;

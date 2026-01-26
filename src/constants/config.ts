export const LOCALSTORAGE_KEY = {
  GEMINI_API_KEY: 'gemini-api-key',
  RECENT_PROJECTS: 'pyxis-recent-projects',
  DEFAULT_EDITOR: 'pyxis-defaultEditor',
  LAST_EXECUTE_FILE: 'pyxis_last_executed_file',
  LOCALE: 'pyxis-locale',
};

export const DEFAULT_VALUES = {
  DEFAULT_EDITOR: 'monaco',
};

// Output panel related configuration
export const OUTPUT_CONFIG = {
  // maximum number of messages to keep in the output panel
  OUTPUT_MAX_MESSAGES: 30,
};

// Monaco editor related configuration
export const MONACO_CONFIG = {
  // Maximum number of Monaco models to keep in memory
  MAX_MONACO_MODELS: 5,
};

export const DEFAULT_LOCALE = 'en';

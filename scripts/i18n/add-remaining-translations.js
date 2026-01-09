#!/usr/bin/env node
/**
 * add-remaining-translations.js
 * Add translations for remaining items that genuinely need translation
 */

const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.join(__dirname, '../../locales');

// Remaining translations for items that were reported as untranslated
// but actually should be translated (not technical terms)
const translations = {
  common: {
    "action.authenticating": {
      id: "Mengautentikasi..."
    },
    "bottom.debugConsole": {
      id: "Konsol Debug"
    },
    "bottom.output": {
      id: "Output",
      it: "Output",
      nl: "Uitvoer"
    },
    "bottom.outputPanel.contextLabel": {
      nl: "Context"
    },
    "bottom.outputPanel.typeLabel": {
      fr: "Type",
      nl: "Type"
    },
    "confirmation.title": {
      fr: "Confirmation"
    },
    "diff.diff": {
      de: "Diff",
      fr: "Diff",
      it: "Diff",
      nl: "Diff",
      sv: "Diff",
      vi: "So sánh"
    },
    "diff.original": {
      de: "Original",
      es: "Original",
      fr: "Original",
      pt: "Original"
    },
    "markdownPreview.reset": {
      id: "Atur ulang"
    },
    "paneNavigator.tab": {
      id: "tab",
      nl: "tab",
      vi: "tab"
    },
    "paneNavigator.tabs": {
      nl: "tabs"
    },
    "projectModal.description": {
      fr: "Description"
    },
    "run.searchFile": {
      vi: "Tìm tệp để thực thi..."
    },
    "run.stop": {
      id: "Berhenti",
      nl: "Stoppen",
      vi: "Dừng"
    },
    "run.title": {
      vi: "Môi trường thực thi"
    },
    "searchPanel.caseSensitive": {
      id: "Peka huruf besar/kecil"
    },
    "settingsPanel.files.excludePattern": {
      hi: "बहिष्करण पैटर्न"
    },
    "settingsPanel.search.excludePattern": {
      hi: "बहिष्करण पैटर्न"
    }
  }
};

// Helper to get value at nested path
function getByPath(obj, path) {
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in cur) {
      cur = cur[p];
    } else {
      return undefined;
    }
  }
  return cur;
}

// Helper to set value at nested path
function setByPath(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length; i++) {
    const k = parts[i];
    if (i === parts.length - 1) {
      cur[k] = value;
    } else {
      if (!(k in cur) || typeof cur[k] !== 'object' || cur[k] === null) {
        cur[k] = {};
      }
      cur = cur[k];
    }
  }
}

// Process all locales
function processLocales() {
  let totalUpdates = 0;
  
  for (const key in translations.common) {
    const localeTranslations = translations.common[key];
    
    for (const locale in localeTranslations) {
      const commonPath = path.join(LOCALES_DIR, locale, 'common.json');
      if (fs.existsSync(commonPath)) {
        const data = JSON.parse(fs.readFileSync(commonPath, 'utf8'));
        setByPath(data, key, localeTranslations[locale]);
        fs.writeFileSync(commonPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
        console.log(`Updated ${locale}/common.json: ${key}`);
        totalUpdates++;
      }
    }
  }
  
  console.log(`\nTotal updates: ${totalUpdates}`);
}

processLocales();

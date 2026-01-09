#!/usr/bin/env node
/**
 * i18n-comprehensive-check.js
 * A comprehensive tool to:
 * 1. Find missing translations (values that are still in English in non-English locales)
 * 2. Find missing keys (keys present in EN but not in other locales)
 * 3. Report untranslated strings that might be hardcoded
 * 
 * Technical terms that are intentionally kept in English are excluded from reports.
 */

const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.join(__dirname, '../../locales');
const BASE_LOCALE = 'en';

// Technical terms and proper nouns that should NOT be translated
const TECHNICAL_TERMS = new Set([
  'Git', 'GitHub', 'API', 'Node.js', 'Python', 'Terminal', 'Editor', 'Diff',
  'Commit', 'Stage', 'Unstage', 'Staged', 'Unstaged', 'Untracked',
  'WebPreview', 'CodeMirror', 'Monaco', 'Mermaid', 'LaTeX', 'KaTeX',
  'IndexedDB', 'LocalStorage', 'ZIP', 'SVG', 'PDF', 'PNG', 'HTML', 'CSS',
  'JavaScript', 'TypeScript', 'JSON', 'Original', 'Description', 'Confirmation',
  'Type', 'Context', 'Output', 'Stop', 'Reset', 'Tab', 'tab', 'tabs', 'Theme', 'Extensions',
  'Workspace Export', 'Repository URL', 'GitHub Personal Access Token',
  'Gemini API Key'
]);

// Patterns that should NOT be flagged as untranslated
const IGNORE_PATTERNS = [
  /^https?:\/\//,  // URLs
  /^ghp_/,  // GitHub tokens
  /^[A-Z]+$/,  // All-caps abbreviations
  /^\{[^}]+\}$/,  // Template placeholders
  /^[\d\.]+$/,  // Numbers
];

// Get all locale directories
function getLocales() {
  return fs.readdirSync(LOCALES_DIR).filter(f => {
    const stat = fs.statSync(path.join(LOCALES_DIR, f));
    return stat.isDirectory();
  });
}

// Read JSON file
function readJson(filepath) {
  try {
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  } catch (e) {
    return null;
  }
}

// Flatten nested JSON to dot notation
function flattenObject(obj, prefix) {
  prefix = prefix || '';
  const result = {};
  for (const key in obj) {
    const newKey = prefix ? (prefix + '.' + key) : key;
    if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
      Object.assign(result, flattenObject(obj[key], newKey));
    } else {
      result[newKey] = obj[key];
    }
  }
  return result;
}

// Check if a value is a technical term that shouldn't be translated
function isTechnicalTerm(value) {
  if (typeof value !== 'string') return true;
  
  // Check exact match with technical terms
  if (TECHNICAL_TERMS.has(value)) return true;
  
  // Check if string contains only technical terms
  const words = value.split(/\s+/);
  if (words.every(w => TECHNICAL_TERMS.has(w))) return true;
  
  // Check against ignore patterns
  if (IGNORE_PATTERNS.some(p => p.test(value))) return true;
  
  return false;
}

// Check if a value looks like English (simple heuristic)
function looksLikeEnglish(value) {
  if (typeof value !== 'string') return false;
  if (isTechnicalTerm(value)) return false;
  
  // Check for common English patterns
  const englishPatterns = [
    /^[A-Za-z\s\d\.,!?\-:;()'"\/]+$/,
    /\b(the|and|or|is|are|have|has|can|will|with|for|from|to|of|in|on|at|by|as)\b/i
  ];
  return englishPatterns.some(p => p.test(value));
}

// Main check function
function checkTranslations() {
  const locales = getLocales();
  const baseDir = path.join(LOCALES_DIR, BASE_LOCALE);
  const baseFiles = fs.readdirSync(baseDir).filter(f => f.endsWith('.json'));
  
  const report = {
    missingKeys: {},
    untranslated: {}
  };
  
  for (const file of baseFiles) {
    const basePath = path.join(baseDir, file);
    const baseData = readJson(basePath);
    if (!baseData) continue;
    
    const baseFlat = flattenObject(baseData);
    
    for (const locale of locales) {
      if (locale === BASE_LOCALE) continue;
      
      const targetPath = path.join(LOCALES_DIR, locale, file);
      const targetData = readJson(targetPath);
      
      if (!targetData) {
        report.missingKeys[locale + '/' + file] = ['FILE_MISSING'];
        continue;
      }
      
      const targetFlat = flattenObject(targetData);
      const missingKeys = [];
      const untranslated = [];
      
      for (const key in baseFlat) {
        if (!(key in targetFlat)) {
          missingKeys.push(key);
        } else if (baseFlat[key] === targetFlat[key] && looksLikeEnglish(baseFlat[key])) {
          // Value is same as English and looks like English text (not technical)
          untranslated.push({ key, value: baseFlat[key] });
        }
      }
      
      if (missingKeys.length > 0) {
        report.missingKeys[locale + '/' + file] = missingKeys;
      }
      if (untranslated.length > 0) {
        report.untranslated[locale + '/' + file] = untranslated;
      }
    }
  }
  
  return report;
}

// Print report
function printReport(report) {
  console.log('=== I18N COMPREHENSIVE CHECK REPORT ===\n');
  
  console.log('--- MISSING KEYS ---');
  const missingCount = Object.keys(report.missingKeys).length;
  if (missingCount === 0) {
    console.log('No missing keys found!\n');
  } else {
    for (const file in report.missingKeys) {
      console.log('\n' + file + ':');
      report.missingKeys[file].forEach(k => console.log('  - ' + k));
    }
    console.log('');
  }
  
  console.log('\n--- POTENTIALLY UNTRANSLATED (excluding technical terms) ---');
  const untranslatedCount = Object.keys(report.untranslated).length;
  if (untranslatedCount === 0) {
    console.log('No untranslated strings found!\n');
    console.log('Note: Technical terms like Git, API, Node.js, Python, Terminal, etc. are intentionally kept in English.');
  } else {
    for (const file in report.untranslated) {
      console.log('\n' + file + ':');
      report.untranslated[file].forEach(function(item) {
        const truncated = item.value.length > 50 ? item.value.substring(0, 50) + '...' : item.value;
        console.log('  - ' + item.key + ': "' + truncated + '"');
      });
    }
    console.log('\nNote: Some values above may be intentionally kept in English (technical terms, proper nouns).');
  }
}

const report = checkTranslations();
printReport(report);

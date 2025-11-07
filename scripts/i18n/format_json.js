#!/usr/bin/env node
"use strict";

const fsPromises = require("fs").promises;
const fs = require("fs");
const path = require("path");

// This script is careful about encodings:
// - Reads file as raw Buffer
// - Detects and preserves a UTF-8 BOM if present
// - Converts content to UTF-8 string, normalizes to NFC to avoid combining-sequence issues
// - Parses JSON and writes pretty-printed JSON with 2-space indent and trailing newline
// - Writes back with the original BOM preserved (if any)

function hasUtf8BOM(buf) {
  return buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length !== 1) {
    console.error("Usage: format_json.js <file>");
    process.exit(2);
  }

  const file = argv[0];
  try {
    const raw = await fsPromises.readFile(file);
    const bom = hasUtf8BOM(raw);
    const bodyBuf = bom ? raw.slice(3) : raw;
    let text = bodyBuf.toString("utf8");

    // Normalize to NFC so visually identical characters are stored consistently
    if (typeof text.normalize === "function") {
      try {
        text = text.normalize("NFC");
      } catch (e) {
        // ignore normalization errors and proceed
      }
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      console.error(`Failed to parse JSON in ${file}: ${err.message}`);
      process.exit(3);
    }

      // Recursively sort object keys alphabetically so output is deterministic
      function sortKeys(value) {
        if (Array.isArray(value)) {
          return value.map(sortKeys);
        }
        if (value && typeof value === "object") {
          // null check above; plain objects will be handled here
          const keys = Object.keys(value).sort((a, b) => a.localeCompare(b));
          const out = {};
          for (const k of keys) {
            out[k] = sortKeys(value[k]);
          }
          return out;
        }
        return value;
      }

      const sorted = sortKeys(parsed);
      const formatted = JSON.stringify(sorted, null, 2) + "\n";

    // If formatted content is identical bytes (taking BOM into account), skip writing
    const outBuf = Buffer.from(formatted, "utf8");
    const finalBuf = bom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), outBuf]) : outBuf;

    // Compare raw buffers to avoid unnecessary writes
    if (!raw.equals(finalBuf)) {
      await fsPromises.writeFile(file, finalBuf);
    }

    process.exit(0);
  } catch (err) {
    // Distinguish permission/IO errors
    if (err && err.code) {
      console.error(`I/O error for ${file}: ${err.message}`);
      process.exit(1);
    }
    console.error(`Unexpected error for ${file}: ${err && err.message ? err.message : err}`);
    process.exit(1);
  }
}

main();

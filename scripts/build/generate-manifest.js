#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Get basePath from environment variable (used during build)
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

const manifest = {
  name: 'Pyxis-Editor',
  short_name: 'Pyxis',
  icons: [
    {
      src: `${basePath}/web-app-manifest-192x192.png`,
      sizes: '192x192',
      type: 'image/png',
      purpose: 'maskable',
    },
    {
      src: `${basePath}/web-app-manifest-512x512.png`,
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable',
    },
  ],
  theme_color: '#ffffff',
  background_color: '#ffffff',
  display: 'standalone',
  start_url: (basePath || '') + '/',
  scope: (basePath || '') + '/',
};

const publicDir = path.join(__dirname, '../../public');
const manifestPath = path.join(publicDir, 'manifest.json');

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

console.log(`Generated manifest.json with basePath: "${basePath}"`);

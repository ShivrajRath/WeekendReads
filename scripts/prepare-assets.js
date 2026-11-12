#!/usr/bin/env node
'use strict';

/**
 * Copies the vendored Paged.js browser bundle into public/vendor so print
 * pages work from the filesystem and from GitHub Pages without a CDN.
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'node_modules', 'pagedjs', 'dist', 'paged.polyfill.js');
const targetDir = path.join(root, 'public', 'vendor');
const target = path.join(targetDir, 'paged.polyfill.js');

if (!fs.existsSync(source)) {
  console.warn('[assets] pagedjs is not installed yet; skipping vendor copy.');
  process.exit(0);
}

fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(source, target);
console.log(`[assets] Copied Paged.js → ${path.relative(root, target)}`);

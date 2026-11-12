#!/usr/bin/env node
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { CONFIG } = require('./config');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.pdf': 'application/pdf',
};

const port = Number(process.env.PORT || 4173);

function safePathname(pathname) {
  const decoded = decodeURIComponent(pathname);
  if (decoded.includes('\0')) return null;
  const normalized = path.posix.normalize(decoded);
  if (normalized.includes('..')) return null;
  return normalized;
}

const server = http.createServer((request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    let pathname = safePathname(url.pathname);
    if (!pathname) {
      response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Bad request');
      return;
    }

    if (pathname === '/') pathname = '/index.html';
    if (pathname === '/archive') pathname = '/archive.html';
    if (pathname.endsWith('/')) pathname += 'index.html';

    const filePath = path.join(CONFIG.publicDir, pathname);
    if (!filePath.startsWith(CONFIG.publicDir + path.sep)) {
      response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Forbidden');
      return;
    }

    fs.stat(filePath, (error, stats) => {
      if (error || !stats.isFile()) {
        response.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
        response.end(
          `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Not found</title><style>body{font-family:Georgia,serif;background:#f4efe4;color:#19150f;display:grid;place-items:center;height:100vh;margin:0}a{color:#b23b26}</style></head><body><main><p>404</p><h1>This page is not in the issue.</h1><p><a href="/">Return to Weekend Reads</a></p></main></body></html>`,
        );
        return;
      }

      const extension = path.extname(filePath).toLowerCase();
      const headers = {
        'content-type': MIME_TYPES[extension] || 'application/octet-stream',
        'cache-control': extension === '.html' ? 'no-cache' : 'public, max-age=3600',
      };
      response.writeHead(200, headers);
      if (request.method === 'HEAD') {
        response.end();
        return;
      }
      fs.createReadStream(filePath).pipe(response);
    });
  } catch (error) {
    response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(`Internal server error: ${error.message}`);
  }
});

server.listen(port, () => {
  console.log(`Weekend Reads preview: http://localhost:${port}`);
  console.log('Press Ctrl+C to stop.');
});

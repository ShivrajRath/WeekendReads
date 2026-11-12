'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const puppeteer = require('puppeteer');

function fileExists(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function resolveChromeExecutable() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    process.env.PROGRAMFILES
      ? path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe')
      : null,
    process.env['PROGRAMFILES(X86)']
      ? path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe')
      : null,
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fileExists(candidate)) return candidate;
  }

  try {
    const bundled = puppeteer.executablePath();
    if (bundled && fileExists(bundled)) return bundled;
  } catch {
    // No bundled Chromium; fall through.
  }

  return null;
}

async function generatePdf({ printPath, pdfPath, issueDate }) {
  if (!fileExists(printPath)) {
    throw new Error(`Print HTML not found: ${printPath}`);
  }

  const executablePath = resolveChromeExecutable();
  if (!executablePath) {
    throw new Error(
      'No Chrome/Chromium executable found. Install Google Chrome or set PUPPETEER_EXECUTABLE_PATH.',
    );
  }

  console.log(`[pdf] Rendering ${path.basename(printPath)} with ${executablePath}`);

  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--font-render-hinting=none',
        '--disable-gpu',
        '--allow-file-access-from-files',
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1240, height: 1754, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(printPath).href, {
      waitUntil: ['load', 'networkidle0'],
      timeout: 60000,
    });

    let pagedState = null;
    try {
      await page.waitForFunction(
        () =>
          window.__PAGED_READY_STATE__ === 'done' ||
          window.__PAGED_READY_STATE__ === 'error',
        { timeout: 180000, polling: 250 },
      );
      pagedState = await page.evaluate(() => ({
        state: window.__PAGED_READY_STATE__,
        pages: window.__PAGED_PAGES__,
        error: window.__PAGED_ERROR__,
        domPages: document.querySelectorAll('.pagedjs_page').length,
      }));
    } catch (error) {
      console.warn(`[pdf] Paged.js wait timed out; falling back to CSS pagination. ${error.message}`);
    }

    if (pagedState?.state === 'error') {
      console.warn(`[pdf] Paged.js error (${pagedState.error}); using Chrome's CSS pagination.`);
    } else if (pagedState?.state === 'done') {
      console.log(`[pdf] Paged.js composed ${pagedState.pages || pagedState.domPages} pages.`);
    }

    await page.evaluate(() => (document.fonts ? document.fonts.ready : Promise.resolve()));
    await new Promise((resolve) => setTimeout(resolve, 350));

    fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
      tagged: true,
      outline: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      timeout: 180000,
    });

    const stats = fs.statSync(pdfPath);
    if (stats.size < 10_000) {
      throw new Error(`Generated PDF is suspiciously small (${stats.size} bytes).`);
    }

    console.log(`[pdf] Wrote ${path.relative(process.cwd(), pdfPath)} (${(stats.size / 1024).toFixed(0)} KB)`);
    return {
      path: pdfPath,
      bytes: stats.size,
      pages: pagedState?.pages || pagedState?.domPages || null,
      issueDate,
    };
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = { generatePdf, resolveChromeExecutable };

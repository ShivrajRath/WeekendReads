'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const HTML_ENTITIES = {
  amp: '&',
  apos: "'",
  gt: '>',
  hellip: '…',
  ldquo: '“',
  lsquo: '‘',
  lt: '<',
  mdash: '—',
  nbsp: ' ',
  ndash: '–',
  quot: '"',
  rdquo: '”',
  rsquo: '’',
};

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function decodeEntities(value = '') {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (match, name) => HTML_ENTITIES[name.toLowerCase()] ?? match);
}

function safeCodePoint(code) {
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

function stripHtml(value = '') {
  return decodeEntities(
    String(value)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|li|blockquote|tr)>/gi, '\n\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\r/g, '')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeWhitespace(value = '') {
  return String(value)
    .replace(/\r/g, '')
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeInline(value = '') {
  return normalizeWhitespace(value).replace(/\n+/g, ' ');
}

function truncate(value = '', maxLength = 160, { ellipsis = '…', wordBoundary = true } = {}) {
  const text = normalizeInline(value);
  if (text.length <= maxLength) return text;
  let cut = text.slice(0, maxLength);
  if (wordBoundary) {
    const lastSpace = cut.lastIndexOf(' ');
    if (lastSpace > maxLength * 0.6) cut = cut.slice(0, lastSpace);
  }
  return cut.replace(/[\s,;:–—-]+$/, '') + ellipsis;
}

function countWords(value = '') {
  const matches = normalizeInline(value).match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu);
  return matches ? matches.length : 0;
}

function readingTimeMinutes(wordCount, wordsPerMinute = 220) {
  return Math.max(1, Math.round(Number(wordCount || 0) / wordsPerMinute));
}

function tidyProse(value = '') {
  return normalizeInline(value)
    .replace(/^[\s)\]}>»…•·]+/, '')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([(\[])\s+/g, '$1')
    .replace(/\s+([)\]}])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const COMMON_SITE_SUFFIXES = new RegExp(
  `^(${[
    'Aeon Essays',
    'Aeon',
    'Quanta Magazine',
    'The Atlantic',
    'The New Yorker',
    'The Guardian',
    'Frontline',
    'The Hindu',
    'The Indian Express',
    'Mint',
    'Hindustan Times',
    'BBC News',
    'Politico',
    'Nature',
    'MIT Technology Review',
    'Ars Technica',
    'Wired',
    'IEEE Spectrum',
    'Foreign Affairs',
    'Al Jazeera',
    'Noema',
    'The Point',
    'Psyche',
    'Fortune',
    'The Conversation',
    'Project Syndicate',
    'Marginal Revolution',
    'Literary Hub',
    'Carbon Brief',
    'Inside Climate News',
    'Yale Environment 360',
    'Longreads',
    'ProPublica',
    'The Atavist Magazine',
  ]
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')})$`,
  'i',
);

function siteNamesMatch(a = '', b = '') {
  const norm = (value) =>
    String(value)
      .toLowerCase()
      .replace(/^the\s+/, '')
      .replace(/[^a-z0-9]/g, '');
  const left = norm(a);
  const right = norm(b);
  if (!left || !right) return false;
  return left.includes(right) || right.includes(left);
}

/**
 * Remove a trailing publication name from a headline, e.g.
 * "The Case for a Bubble at Life's Start | Quanta Magazine".
 * Only strips when the suffix matches the known source or a common masthead.
 */
function stripSiteSuffix(title = '', siteName = '') {
  let text = normalizeInline(title);
  for (let pass = 0; pass < 2; pass += 1) {
    const match = text.match(/^(.*?)\s+[|–—]\s+([^|–—]{2,80})$/);
    if (!match) break;
    const head = match[1].trim();
    const suffix = match[2].trim();
    if (!head) break;
    if (COMMON_SITE_SUFFIXES.test(suffix) || siteNamesMatch(suffix, siteName)) {
      text = head;
    } else {
      break;
    }
  }
  return text;
}

function slugify(value = '') {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function hashId(value = '') {
  return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 12);
}

function safeUrl(value = '') {
  try {
    const url = new URL(String(value).trim());
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function isPublicHttpUrl(value = '') {
  const url = safeUrl(value);
  if (!url) return false;
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    host === '[::1]' ||
    host === '::1' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    return false;
  }
  return true;
}

function safeJsonParse(value = '') {
  const text = String(value).trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text;
  const first = candidate.indexOf('{');
  const last = candidate.lastIndexOf('}');
  if (first === -1 || last <= first) {
    throw new Error('No JSON object found in model response.');
  }
  return JSON.parse(candidate.slice(first, last + 1));
}

/** A deliberately small Markdown renderer. All input is escaped first. */
function renderMarkdown(markdown = '') {
  const safe = escapeHtml(String(markdown).trim());
  if (!safe) return '';

  const blocks = safe.split(/\n{2,}/);
  const output = [];

  for (const rawBlock of blocks) {
    const block = rawBlock.trim();
    if (!block) continue;

    const heading = block.match(/^(#{2,4})\s+([\s\S]+)$/);
    if (heading) {
      const level = Math.min(4, heading[1].length);
      output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    if (/^&gt;\s?/.test(block)) {
      const quote = block
        .split('\n')
        .map((line) => line.replace(/^&gt;\s?/, ''))
        .join(' ');
      output.push(`<blockquote><p>${inlineMarkdown(quote)}</p></blockquote>`);
      continue;
    }

    if (/^([-*])\s+/m.test(block)) {
      const items = block
        .split('\n')
        .filter((line) => /^([-*])\s+/.test(line.trim()))
        .map((line) => `<li>${inlineMarkdown(line.trim().replace(/^([-*])\s+/, ''))}</li>`);
      if (items.length) {
        output.push(`<ul>${items.join('')}</ul>`);
        continue;
      }
    }

    output.push(`<p>${inlineMarkdown(block).replace(/\n/g, '<br>')}</p>`);
  }

  return output.join('\n');
}

function inlineMarkdown(value) {
  return value
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" rel="noopener noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s.,;:!?)]|$)/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s.,;:!?)]|$)/g, '$1<em>$2</em>');
}

function splitSentences(text = '') {
  const clean = normalizeInline(text);
  if (!clean) return [];
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
    return [...segmenter.segment(clean)]
      .map((part) => part.segment.trim())
      .filter((sentence) => sentence.length > 0);
  }
  return clean.split(/(?<=[.!?])\s+(?=[A-Z0-9"“'])/).filter(Boolean);
}

function splitParagraphs(text = '') {
  return normalizeWhitespace(text)
    .split(/\n{2,}/)
    .map((paragraph) => normalizeInline(paragraph))
    .filter((paragraph) => paragraph.length > 40);
}

function mapLimit(items, limit, mapper) {
  const list = [...items];
  const results = new Array(list.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, list.length)) }, async () => {
    while (cursor < list.length) {
      const index = cursor++;
      results[index] = await mapper(list[index], index);
    }
  });
  return Promise.all(workers).then(() => results);
}

function ensureDir(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' && fallback !== null) return fallback;
    throw error;
  }
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function writeFile(filePath, contents) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, contents, 'utf8');
}

function dateToISO(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function todayISO() {
  return dateToISO(new Date());
}

function parseDateOnly(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate));
  if (!match) throw new Error(`Invalid date: ${isoDate}`);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0));
}

function addDays(isoDate, days) {
  const date = parseDateOnly(isoDate);
  date.setUTCDate(date.getUTCDate() + Number(days));
  return date.toISOString().slice(0, 10);
}

function formatLongDate(isoDate) {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parseDateOnly(isoDate));
}

function formatMediumDate(isoDate) {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parseDateOnly(isoDate));
}

function formatShortDate(isoDate) {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parseDateOnly(isoDate));
}

function formatMonthYear(isoDate) {
  return new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parseDateOnly(isoDate));
}

function weekday(isoDate) {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' }).format(
    parseDateOnly(isoDate),
  );
}

function weekStart(isoDate) {
  const date = parseDateOnly(isoDate);
  const day = date.getUTCDay();
  const delta = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function seasonFor(isoDate) {
  const month = parseDateOnly(isoDate).getUTCMonth() + 1;
  if (month === 12 || month <= 2) return 'Winter';
  if (month <= 5) return 'Spring';
  if (month <= 8) return 'Summer';
  return 'Autumn';
}

function romanNumeral(number) {
  const values = [
    [1000, 'M'],
    [900, 'CM'],
    [500, 'D'],
    [400, 'CD'],
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let n = Number(number);
  let result = '';
  for (const [value, numeral] of values) {
    while (n >= value) {
      result += numeral;
      n -= value;
    }
  }
  return result || 'I';
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stripTrailingEllipsis(value = '') {
  return String(value).replace(/(?:\.{3,}|…)[\s]*$/, '').trimEnd();
}

module.exports = {
  addDays,
  countWords,
  dateToISO,
  decodeEntities,
  ensureDir,
  escapeHtml,
  formatLongDate,
  formatMediumDate,
  formatMonthYear,
  formatShortDate,
  hashId,
  isPublicHttpUrl,
  mapLimit,
  normalizeInline,
  normalizeWhitespace,
  parseDateOnly,
  readingTimeMinutes,
  readJson,
  renderMarkdown,
  romanNumeral,
  safeJsonParse,
  safeUrl,
  seasonFor,
  slugify,
  splitParagraphs,
  splitSentences,
  stripHtml,
  stripSiteSuffix,
  stripTrailingEllipsis,
  tidyProse,
  todayISO,
  truncate,
  uniqueBy,
  weekStart,
  weekday,
  writeFile,
  writeJson,
};

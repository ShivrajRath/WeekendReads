'use strict';

const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const ISSUES_DATA_DIR = path.join(DATA_DIR, 'issues');
const PUBLIC_DIR = path.join(ROOT, 'public');
const PUBLIC_ISSUES_DIR = path.join(PUBLIC_DIR, 'issues');

const CONFIG = {
  root: ROOT,
  dataDir: DATA_DIR,
  issuesDataDir: ISSUES_DATA_DIR,
  publicDir: PUBLIC_DIR,
  publicIssuesDir: PUBLIC_ISSUES_DIR,
  sourcesFile: path.join(DATA_DIR, 'sources.json'),
  siteName: 'Weekend Reads',
  siteTagline: 'A weekly anthology of longform journalism',
  siteUrl: process.env.SITE_URL || '',
  maxArticles: Number(process.env.MAX_ARTICLES || 10),
  windowDays: Number(process.env.WINDOW_DAYS || 7),
  minWords: Number(process.env.MIN_WORDS || 1000),
  feedConcurrency: Number(process.env.FEED_CONCURRENCY || 8),
  articleConcurrency: Number(process.env.ARTICLE_CONCURRENCY || 8),
  enrichPerCategory: Number(process.env.ENRICH_PER_CATEGORY || 24),
  candidatesPerCategory: Number(process.env.CANDIDATES_PER_CATEGORY || 4),
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 20000),
  feedRetries: Number(process.env.FEED_RETRIES || 2),
  wordsPerMinute: Number(process.env.WORDS_PER_MINUTE || 220),
  userAgent:
    process.env.HTTP_USER_AGENT ||
    'WeekendReadsBot/1.0 (+https://github.com/; editorial digest generator; contact: editor@example.com)',
  geminiModels: (process.env.GEMINI_MODELS || 'gemini-2.5-flash,gemini-2.5-pro,gemini-1.5-pro')
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean),
  groqModel: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
  llmTimeoutMs: Number(process.env.LLM_TIMEOUT_MS || 120000),
  useLLM: process.env.USE_LLM !== 'false',
};

const CATEGORY_ORDER = [
  'politics',
  'india',
  'science',
  'technology',
  'global',
  'ideas',
  'business',
  'culture',
  'climate',
  'longform',
];

module.exports = { CATEGORY_ORDER, CONFIG };

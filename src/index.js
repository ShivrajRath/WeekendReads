#!/usr/bin/env node
'use strict';

require('dotenv').config({ quiet: true });

const fs = require('node:fs');
const path = require('node:path');
const { CONFIG } = require('./config');
const { fetchCandidates } = require('./feedFetcher');
const { curateWithLLM } = require('./llmCurator');
const {
  buildIssue,
  createFallbackCuration,
  listExistingIssues,
  providerLabel,
  resolveIssueNumber,
} = require('./issueBuilder');
const { writeStaticSite } = require('./renderEngine');
const { generatePdf } = require('./pdfGenerator');
const {
  ensureDir,
  formatLongDate,
  parseDateOnly,
  readJson,
  todayISO,
  writeJson,
} = require('./utils');

function parseArgs(argv) {
  const options = {
    issueDate: todayISO(),
    pdf: true,
    local: false,
    refresh: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const [flag, inlineValue] = arg.split('=');
    if (flag === '--date') {
      options.issueDate = inlineValue || argv[++i];
    } else if (flag === '--no-pdf') {
      options.pdf = false;
    } else if (flag === '--local') {
      options.local = true;
    } else if (flag === '--refresh') {
      options.refresh = true;
    } else if (flag === '--help' || flag === '-h') {
      options.help = true;
    } else if (arg.trim()) {
      console.warn(`[cli] Ignoring unknown argument: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Weekend Reads generator

Usage:
  node src/index.js [options]

Options:
  --date=YYYY-MM-DD  Issue date to generate (default: today)
  --no-pdf           Skip PDF rendering
  --local            Skip LLM providers and use the local editorial engine
  --refresh          Regenerate even when an issue for the date already exists
  --help             Show this help

Environment:
  GEMINI_API_KEY / GOOGLE_API_KEY   Enables Gemini (model cascade)
  GROQ_API_KEY                      Enables Groq fallback
  GEMINI_MODELS                     Comma-separated Gemini model cascade
  GROQ_MODEL                        Groq model id
  MIN_WORDS                         Longform threshold (default: 1000)
  WINDOW_DAYS                       Source window (default: 7)
  SITE_URL                          Canonical site URL (optional)
`);
}

function validateDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    throw new Error(`Invalid --date value "${value}". Use YYYY-MM-DD.`);
  }
  const date = parseDateOnly(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid calendar date: ${value}`);
  }
  const today = parseDateOnly(todayISO());
  if (date.getTime() > today.getTime() + 86_400_000) {
    throw new Error('Refusing to generate a future issue.');
  }
  return value;
}

function loadSources() {
  if (!fs.existsSync(CONFIG.sourcesFile)) {
    throw new Error(`Missing sources file: ${CONFIG.sourcesFile}`);
  }
  const sources = readJson(CONFIG.sourcesFile);
  if (!Array.isArray(sources.categories) || sources.categories.length === 0) {
    throw new Error('sources.json must contain a non-empty "categories" array.');
  }
  for (const category of sources.categories) {
    if (!category.id || !category.name || !Array.isArray(category.feeds)) {
      throw new Error(`Invalid category in sources.json: ${JSON.stringify(category)}`);
    }
    category.feeds = category.feeds.filter((feed) => feed && feed.url);
  }
  return sources;
}

function printIssueSummary(issue, { pdfResult, sitePaths }) {
  const counts = issue.meta.counts;
  console.log('');
  console.log('  WEEKEND READS');
  console.log(`  Issue ${issue.issue_number_display} · ${formatLongDate(issue.issue_date)}`);
  console.log(`  ${counts.articles} stories · ${counts.sources} sources · ${counts.total_reading_minutes} minutes`);
  console.log(`  Curated with ${providerLabel(issue.meta.curation.provider)}`);
  console.log('');
  console.log(`  Web:    ${path.relative(process.cwd(), sitePaths.issuePath)}`);
  console.log(`  Archive:${path.relative(process.cwd(), sitePaths.archivePath)}`);
  if (pdfResult) {
    console.log(`  PDF:    ${path.relative(process.cwd(), pdfResult.path)} (${(pdfResult.bytes / 1024).toFixed(0)} KB)`);
  } else {
    console.log('  PDF:    skipped');
  }
  console.log('');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const issueDate = validateDate(options.issueDate);
  if (options.local) {
    process.env.USE_LLM = 'false';
    CONFIG.useLLM = false;
  }

  ensureDir(CONFIG.issuesDataDir);
  ensureDir(CONFIG.publicIssuesDir);

  const existing = listExistingIssues().find((issue) => issue.issueDate === issueDate);
  if (existing && !options.refresh) {
    console.log(`[issue] Issue ${issueDate} already exists. Use --refresh to regenerate it.`);
    const latest = [...listExistingIssues()]
      .filter((item) => item.data)
      .sort((a, b) => b.issueDate.localeCompare(a.issueDate))[0];
    writeStaticSite({
      issue: existing.data,
      latestIssue: latest?.data || existing.data,
      allIssues: listExistingIssues().map((item) => item.data).filter(Boolean),
    });
    if (options.pdf) {
      const printPath = path.join(CONFIG.publicIssuesDir, `${issueDate}-print.html`);
      const pdfPath = path.join(CONFIG.publicIssuesDir, `Issue-${issueDate}.pdf`);
      if (fs.existsSync(printPath)) {
        await generatePdf({ printPath, pdfPath, issueDate });
      }
    }
    console.log(`[issue] Re-rendered existing issue ${issueDate}.`);
    return;
  }

  const sources = loadSources();
  const feedResult = await fetchCandidates(sources, { issueDate });

  if (!feedResult.candidates.length) {
    const details = feedResult.failedFeeds.length
      ? ` ${feedResult.failedFeeds.length} feeds failed.`
      : '';
    throw new Error(
      `No eligible longform candidates were found in the ${CONFIG.windowDays}-day window for ${issueDate}.${details} Try again later or adjust MIN_WORDS.`,
    );
  }

  const issueNumber = resolveIssueNumber(issueDate);
  console.log(
    `[issue] Assembling Issue ${String(issueNumber).padStart(2, '0')} for ${formatLongDate(issueDate)} from ${feedResult.candidates.length} candidates.`,
  );

  let llmResult = { curation: null, fallbackChain: [], reason: 'LLM disabled.' };
  if (CONFIG.useLLM) {
    llmResult = await curateWithLLM({
      candidates: feedResult.candidates,
      issueDate,
      issueNumber,
    });
  } else {
    llmResult.reason = 'Local mode requested with --local or USE_LLM=false.';
  }

  let curation = llmResult.curation;
  let fallbackReason = llmResult.reason;

  if (!curation) {
    console.log(`[curator] ${fallbackReason || 'No LLM curation available.'} Using local editorial engine.`);
    curation = createFallbackCuration({
      candidates: feedResult.candidates,
      issueDate,
      issueNumber,
      reason: fallbackReason,
      chain: llmResult.fallbackChain,
    });
    if (!llmResult.fallbackChain?.length && fallbackReason) {
      curation.fallback_chain = [
        { provider: 'local', model: 'weekend-reads-editorial-engine', status: 'used', reason: fallbackReason },
      ];
    }
  }

  const issue = buildIssue({
    issueDate,
    issueNumber,
    curation,
    fetchStats: feedResult.stats,
    failedFeeds: feedResult.failedFeeds,
    reason: fallbackReason,
  });

  const dataPath = path.join(CONFIG.issuesDataDir, `${issueDate}.json`);
  writeJson(dataPath, issue);
  console.log(
    `[issue] Saved ${issue.articles.length} articles with ${issue.meta.counts.sources} sources to ${path.relative(process.cwd(), dataPath)}.`,
  );

  const allIssues = listExistingIssues()
    .map((item) => item.data)
    .filter(Boolean)
    .sort((a, b) => a.issue_date.localeCompare(b.issue_date));
  const latestIssue = allIssues[allIssues.length - 1] || issue;

  const sitePaths = writeStaticSite({ issue, latestIssue, allIssues });

  let pdfResult = null;
  if (options.pdf) {
    try {
      pdfResult = await generatePdf({
        printPath: sitePaths.printPath,
        pdfPath: path.join(CONFIG.publicIssuesDir, `Issue-${issueDate}.pdf`),
        issueDate,
      });
    } catch (error) {
      console.error(`[pdf] Failed to generate PDF: ${error.message}`);
      console.error('[pdf] The web and print HTML editions were generated; rerun with --no-pdf to skip PDF.');
      throw error;
    }
  }

  printIssueSummary(issue, { pdfResult, sitePaths });

  const coverage = issue.meta.counts.categories;
  if (coverage < 8) {
    console.warn(
      `[issue] Only ${coverage}/${sources.categories.length} sections had eligible stories. Lower MIN_WORDS or add more longform feeds for fuller issues.`,
    );
  }
}

main().catch((error) => {
  console.error(`\n[error] ${error.stack || error.message}`);
  process.exitCode = 1;
});

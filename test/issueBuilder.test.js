'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { CONFIG, CATEGORY_ORDER } = require('../src/config');
const {
  buildIssue,
  listExistingIssues,
  providerLabel,
  resolveIssueNumber,
} = require('../src/issueBuilder');
const { buildLocalCuration } = require('../src/localCurator');

function makeCandidates() {
  return CATEGORY_ORDER.map((category, index) => ({
    id: `story-${category}`,
    category,
    categoryName: category,
    categoryShortName: category,
    title: `${category} story`,
    link: `https://example.com/${category}`,
    publishedAt: '2026-11-08T09:00:00.000Z',
    author: 'Test Author',
    sourceName: `Source ${index + 1}`,
    sourceWeight: 1,
    excerpt: 'A clean summary of the reporting that follows.',
    contentText: Array.from(
      { length: 20 },
      (_, paragraph) =>
        `Paragraph ${paragraph + 1} explains the reporting in detail, with enough words to form a usable sentence for the local editorial engine.`,
    ).join('\n\n'),
    wordCount: 1200,
    readingTimeMinutes: 6,
  }));
}

function makeCuration() {
  return buildLocalCuration({
    candidates: makeCandidates(),
    issueDate: '2026-11-10',
    issueNumber: 1,
  });
}

test('assembles a dated issue with stable metadata and links', () => {
  const issue = buildIssue({
    issueDate: '2026-11-10',
    issueNumber: 1,
    curation: makeCuration(),
    fetchStats: {
      windowDays: 7,
      minWords: 1000,
      feedsAttempted: 40,
      feedsSucceeded: 37,
      entriesScanned: 1200,
      categoriesWithCandidates: CATEGORY_ORDER,
      durationMs: 23000,
    },
    failedFeeds: [{ category: 'science', source: 'Example', error: 'HTTP 503' }],
  });

  assert.equal(issue.issue_date, '2026-11-10');
  assert.equal(issue.issue_date_long, 'Tuesday, 10 November 2026');
  assert.equal(issue.issue_date_medium, '10 November 2026');
  assert.equal(issue.issue_date_short, '10 Nov 2026');
  assert.equal(issue.issue_number, 1);
  assert.equal(issue.issue_number_display, '01');
  assert.equal(issue.weekday, 'Tuesday');
  assert.equal(issue.week_label, 'Week of 9 November 2026');
  assert.equal(issue.season, 'Autumn 2026');
  assert.equal(issue.volume, 'I');
  assert.equal(issue.articles.length, 10);
  assert.equal(issue.articles.filter((article) => article.featured).length, 1);
  assert.deepEqual(
    issue.articles.map((article) => article.position),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  );
  assert.equal(issue.meta.counts.articles, 10);
  assert.equal(issue.meta.counts.categories, 10);
  assert.equal(issue.meta.counts.sources, 10);
  assert.equal(issue.meta.ingestion.failed_feeds.length, 1);
  assert.equal(issue.meta.curation.mode, 'local');
  assert.equal(issue.meta.curation.fallback_chain.at(-1).provider, 'local');
  assert.deepEqual(issue.links, {
    web: 'issues/2026-11-10.html',
    print: 'issues/2026-11-10-print.html',
    pdf: 'issues/Issue-2026-11-10.pdf',
    data: 'issues/2026-11-10.json',
  });
});

test('rejects an empty curation', () => {
  assert.throws(
    () =>
      buildIssue({
        issueDate: '2026-11-10',
        issueNumber: 1,
        curation: { articles: [], editor_note: '' },
      }),
    /without articles/,
  );
});

test('formats provider labels for the colophon', () => {
  assert.equal(providerLabel('gemini:gemini-2.5-flash'), 'Gemini · gemini-2.5-flash');
  assert.equal(providerLabel('groq:llama-3.3-70b-versatile'), 'Groq · llama-3.3-70b-versatile');
  assert.equal(providerLabel('local:extractive'), 'Local editorial engine');
  assert.equal(providerLabel(null), 'Weekend Reads editorial desk');
});

test('lists archived issues and resolves numbers from the dated archive', () => {
  const originalDir = CONFIG.issuesDataDir;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weekend-reads-issues-'));
  try {
    CONFIG.issuesDataDir = tempDir;
    fs.writeFileSync(
      path.join(tempDir, '2026-11-03.json'),
      JSON.stringify({ issue_number: 4, issue_date: '2026-11-03' }),
    );
    fs.writeFileSync(
      path.join(tempDir, '2026-11-10.json'),
      JSON.stringify({ issue_number: 5, issue_date: '2026-11-10' }),
    );
    fs.writeFileSync(path.join(tempDir, 'notes.json'), JSON.stringify({ ignored: true }));

    const issues = listExistingIssues();
    assert.deepEqual(
      issues.map((issue) => issue.issueDate),
      ['2026-11-03', '2026-11-10'],
    );
    assert.equal(issues[1].issueNumber, 5);
    assert.equal(resolveIssueNumber('2026-11-10'), 5);
    assert.equal(resolveIssueNumber('2026-11-17'), 3);
  } finally {
    CONFIG.issuesDataDir = originalDir;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

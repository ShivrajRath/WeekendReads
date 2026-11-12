'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CATEGORY_ORDER } = require('../src/config');
const { buildPrompt, mapLLMResponse, promptPayload } = require('../src/llmCurator');

function makeCandidate(category, index) {
  const sentences = Array.from(
    { length: 22 },
    (_, i) =>
      `The ${category} inquiry recorded finding ${i + 1} after reviewing evidence from district ${i + 7} and interviewing officials about the programme.`,
  );
  sentences[3] =
    '"The record is clear enough for the public to judge," one investigator told the committee.';
  return {
    id: `${category}-${index}`,
    category,
    categoryName: category,
    categoryShortName: category,
    title: `${category} headline ${index}`,
    link: `https://example.com/${category}/${index}`,
    publishedAt: '2026-11-08T09:00:00.000Z',
    author: 'Test Author',
    sourceName: 'Example Review',
    sourceWeight: 1,
    excerpt: 'A clean summary of the reporting.',
    contentText: sentences.join(' '),
    wordCount: 1600,
    readingTimeMinutes: 7,
  };
}

function onePerCategory() {
  return CATEGORY_ORDER.map((category, index) => makeCandidate(category, index));
}

function longText(words) {
  return Array.from({ length: words }, (_, index) => `word${index + 1}`).join(' ');
}

test('builds a prompt with at most three candidates per section', () => {
  const candidates = CATEGORY_ORDER.flatMap((category) =>
    [0, 1, 2, 3, 4].map((index) => makeCandidate(category, index)),
  );
  const payload = promptPayload(candidates, '2026-11-10');
  assert.equal(payload.length, CATEGORY_ORDER.length);
  assert.ok(payload.every((section) => section.candidates.length === 3));

  const prompt = buildPrompt({ candidates, issueDate: '2026-11-10', issueNumber: 1 });
  assert.match(prompt, /Assemble Issue 01 of Weekend Reads for Tuesday, 10 November 2026/);
  assert.match(prompt, /SECTION: politics/);
  assert.match(prompt, /https:\/\/example\.com\/politics\/0/);
  assert.match(prompt, /CANDIDATES/);
});

test('validates model selections, ignores invented sources and backfills every section', () => {
  const candidates = onePerCategory();
  const response = {
    issue_date: '2026-11-10',
    issue_number: 1,
    editor_note: longText(75),
    articles: [
      {
        candidate_index: 0,
        category: 'politics',
        title: 'An invented replacement headline',
        source_url: 'https://evil.example/injected',
        executive_summary: longText(70),
        key_takeaways: ['One clear point', 'A second point', 'A third point'],
        key_quote: 'The record is clear enough for the public to judge.',
        digest_body: longText(180),
      },
      {
        candidate_index: 0,
        category: 'politics',
        title: 'A duplicate of the same story',
        source_url: 'https://example.com/politics/0',
        executive_summary: longText(70),
        key_takeaways: ['One', 'Two', 'Three'],
        key_quote: 'A duplicate quote that should not appear twice.',
        digest_body: longText(180),
      },
      {
        candidate_index: 999,
        category: 'culture',
        title: 'A candidate that does not exist',
        source_url: 'https://example.com/nothing',
        executive_summary: longText(70),
        key_takeaways: ['One', 'Two', 'Three'],
        key_quote: 'An invented quote from an invented story.',
        digest_body: longText(180),
      },
    ],
  };

  const mapped = mapLLMResponse(response, candidates, {
    issueDate: '2026-11-10',
    issueNumber: 1,
  });

  assert.equal(mapped.articles.length, 10);
  assert.equal(new Set(mapped.articles.map((article) => article.category)).size, 10);
  assert.equal(mapped.articles.filter((article) => article.featured).length, 1);
  assert.equal(mapped.articles.filter((article) => article.title.includes('duplicate')).length, 0);
  assert.equal(mapped.articles.filter((article) => article.title.includes('invented')).length, 0);
  assert.equal(mapped.articles.some((article) => article.source_url.includes('evil.example')), false);
  assert.equal(mapped.articles.some((article) => article.source_url.includes('nothing')), false);

  const politics = mapped.articles.find((article) => article.category === 'politics');
  assert.equal(politics.title, 'politics headline 0');
  assert.equal(politics.source_url, 'https://example.com/politics/0');
  assert.match(mapped.editor_note, /^word1 word2/);
});

test('throws when neither the model nor the candidate pool can produce a story', () => {
  assert.throws(
    () =>
      mapLLMResponse(
        {
          editor_note: longText(70),
          articles: [],
        },
        [],
        { issueDate: '2026-11-10', issueNumber: 1 },
      ),
    /no usable articles/,
  );
});

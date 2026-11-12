'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CATEGORY_ORDER } = require('../src/config');
const {
  buildLocalCuration,
  buildLocalDigest,
  selectOnePerCategory,
} = require('../src/localCurator');

const SUBJECTS = [
  'The parliamentary committee',
  'A regional court',
  'The state electricity board',
  'Independent researchers',
  'The finance ministry',
  'A coalition of mayors',
  'The national statistics office',
  'Local health workers',
  'The central bank',
  'A network of libraries',
  'The transport authority',
  'Investigators',
  'The agriculture department',
  'A group of historians',
  'The election commission',
  'Public prosecutors',
  'The water regulator',
  'A panel of economists',
  'The housing agency',
  'Community organisers',
];

const VERBS = [
  'confirmed',
  'examined',
  'challenged',
  'documented',
  'questioned',
  'expanded',
  'reviewed',
  'estimated',
  'rejected',
  'reinterpreted',
];

const OBJECTS = [
  'the hidden cost of the settlement programme',
  'a decade of quietly shifting procurement rules',
  'the gap between published targets and delivered homes',
  'the long aftermath of the boundary dispute',
  'the uneven geography of the new industrial policy',
  'the archive of letters kept out of the official history',
  'the relationship between rainfall records and crop insurance',
  'the practical limits of the new transparency law',
  'the second-order effects of the currency intervention',
  'the way local councils negotiate with private developers',
  'the missing minutes of the emergency meeting',
  'the promises made to displaced families',
  'the data behind the headline unemployment figure',
  'the quiet transfer of public land',
  'the unreported failures of the pilot scheme',
  'the arguments that persuaded the swing voters',
  'the cost of delaying the drainage project',
  'the assumptions inside the fiscal forecast',
  'the people left out of the resettlement plan',
  'the gap between consultation and consent',
];

const DETAILS = [
  'across four districts',
  'after a two-year inquiry',
  'in a report published this week',
  'during the final weeks of the session',
  'despite repeated warnings from engineers',
  'according to documents obtained under the act',
  'in testimony before the committee',
  'after months of quieter negotiations',
  'at a meeting that was not listed publicly',
  'in three separate provinces',
];

function makeCandidate(category, index, overrides = {}) {
  const categoryName = category.charAt(0).toUpperCase() + category.slice(1);
  const sentences = [];
  for (let i = 0; i < 30; i += 1) {
    const subject = SUBJECTS[(i + index) % SUBJECTS.length];
    const verb = VERBS[(i * 3 + index) % VERBS.length];
    const object = OBJECTS[(i * 7 + index) % OBJECTS.length];
    const detail = DETAILS[(i * 5 + index) % DETAILS.length];
    sentences.push(`${subject} ${verb} ${object} ${detail}.`);
  }
  sentences[6] =
    '"This is the sentence readers should remember," said one official who reviewed the evidence.';
  sentences[15] =
    'The numbers matter because they show how quickly the assumptions changed after the first year.';

  return {
    id: `candidate-${category}-${index}`,
    category,
    categoryName,
    categoryShortName: categoryName,
    title: `${categoryName} story number ${index + 1}`,
    link: `https://example.com/${category}/${index + 1}`,
    publishedAt: '2026-11-08T09:00:00.000Z',
    author: 'Test Author',
    sourceName: 'Example Review',
    sourceWeight: 1.1,
    excerpt: 'A clean summary of the reporting.',
    contentText: sentences.join(' '),
    wordCount: 1800,
    readingTimeMinutes: 8,
    ...overrides,
  };
}

function makeCandidates() {
  return CATEGORY_ORDER.map((category, index) => makeCandidate(category, index));
}

test('builds a faithful local digest with three sections and a clean quote', () => {
  const candidate = makeCandidate('science', 0);
  const digest = buildLocalDigest(candidate);

  assert.ok(digest.executive_summary.split(/\s+/).length >= 60);
  assert.equal(digest.key_takeaways.length, 3);
  assert.ok(digest.key_takeaways.every((item) => item.length > 20));
  assert.match(digest.digest_body, /### The story/);
  assert.match(digest.digest_body, /### What the reporting shows/);
  assert.match(digest.digest_body, /### Why it matters/);
  assert.ok(digest.key_quote.length > 40);
  assert.doesNotMatch(digest.key_quote, /^[)\]}>]/);
  assert.ok(digest.dek.length > 20);
});

test('selects exactly one candidate per available category', () => {
  const candidates = makeCandidates();
  const selected = selectOnePerCategory(candidates, '2026-11-10');

  assert.equal(selected.length, CATEGORY_ORDER.length);
  assert.deepEqual(
    selected.map((candidate) => candidate.category),
    CATEGORY_ORDER,
  );
});

test('builds a dated issue with one story per section', () => {
  const curation = buildLocalCuration({
    candidates: makeCandidates(),
    issueDate: '2026-11-10',
    issueNumber: 1,
  });

  assert.equal(curation.provider, 'local:extractive');
  assert.equal(curation.articles.length, CATEGORY_ORDER.length);
  assert.equal(new Set(curation.articles.map((article) => article.category)).size, CATEGORY_ORDER.length);
  assert.equal(curation.articles.filter((article) => article.featured).length, 1);
  assert.deepEqual(
    curation.articles.map((article) => article.position),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  );
  assert.match(curation.editor_note, /Issue 01 arrives on Tuesday, 10 November 2026/);
  assert.match(curation.editor_note, /Every digest links back to the original publication/);

  for (const article of curation.articles) {
    assert.equal(article.source_url.startsWith('https://example.com/'), true);
    assert.ok(article.digest_body.length > 300);
    assert.equal(article.key_takeaways.length, 3);
  }
});

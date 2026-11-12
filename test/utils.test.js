'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  addDays,
  countWords,
  formatLongDate,
  formatMediumDate,
  formatShortDate,
  renderMarkdown,
  romanNumeral,
  safeJsonParse,
  seasonFor,
  stripSiteSuffix,
  tidyProse,
  weekStart,
  weekday,
} = require('../src/utils');

test('formats the issue date in the forms used across the magazine', () => {
  assert.equal(formatLongDate('2026-11-10'), 'Tuesday, 10 November 2026');
  assert.equal(formatMediumDate('2026-11-10'), '10 November 2026');
  assert.equal(formatShortDate('2026-11-10'), '10 Nov 2026');
  assert.equal(weekday('2026-11-10'), 'Tuesday');
  assert.equal(weekStart('2026-11-10'), '2026-11-09');
  assert.equal(weekStart('2026-11-15'), '2026-11-09');
  assert.equal(addDays('2026-11-10', 7), '2026-11-17');
  assert.equal(seasonFor('2026-11-10'), 'Autumn');
  assert.equal(seasonFor('2026-01-15'), 'Winter');
  assert.equal(romanNumeral(1), 'I');
  assert.equal(romanNumeral(4), 'IV');
  assert.equal(romanNumeral(2026), 'MMXXVI');
});

test('counts words without counting punctuation as words', () => {
  assert.equal(countWords('One two three.'), 3);
  assert.equal(countWords('A well-known fact — and another.'), 5);
  assert.equal(countWords(''), 0);
});

test('renders safe Markdown blocks and escapes dangerous HTML', () => {
  const html = renderMarkdown(
    '### The story\n\n**Bold** and *italic* with [a link](https://example.com).\n\n> A quoted line.\n\n- One\n- Two',
  );

  assert.match(html, /<h3>The story<\/h3>/);
  assert.match(html, /<strong>Bold<\/strong>/);
  assert.match(html, /<em>italic<\/em>/);
  assert.match(html, /<a href="https:\/\/example.com" rel="noopener noreferrer">a link<\/a>/);
  assert.match(html, /<blockquote><p>A quoted line.<\/p><\/blockquote>/);
  assert.match(html, /<ul><li>One<\/li><li>Two<\/li><\/ul>/);

  const attack = renderMarkdown('<script>alert("xss")</script>\n\n<img src=x onerror=alert(1)>');
  assert.doesNotMatch(attack, /<script/i);
  assert.doesNotMatch(attack, /<img/i);
  assert.match(attack, /&lt;script&gt;/);
  assert.match(attack, /&lt;img/);
});

test('parses fenced and noisy JSON model responses', () => {
  assert.deepEqual(safeJsonParse('```json\n{"issue_date":"2026-11-10"}\n```'), {
    issue_date: '2026-11-10',
  });
  assert.deepEqual(safeJsonParse('Here is the issue: {"articles":[]} — done.'), { articles: [] });
  assert.throws(() => safeJsonParse('no object here'), /No JSON object/);
});

test('cleans publication suffixes only when they match the source', () => {
  assert.equal(
    stripSiteSuffix('The Case for a Bubble at Life’s Start | Quanta Magazine', 'Quanta Magazine'),
    'The Case for a Bubble at Life’s Start',
  );
  assert.equal(
    stripSiteSuffix('How does Roshi Joan Halifax make sense of her Buddhist life? | Aeon Essays', 'Aeon'),
    'How does Roshi Joan Halifax make sense of her Buddhist life?',
  );
  assert.equal(
    stripSiteSuffix('A title with a real | pipe in it', 'Aeon'),
    'A title with a real | pipe in it',
  );
  assert.equal(stripSiteSuffix('Plain headline', 'Quanta Magazine'), 'Plain headline');
});

test('tidies prose without changing meaning', () => {
  assert.equal(tidyProse('  ) A sentence , with stray spaces .  '), 'A sentence, with stray spaces.');
  assert.equal(tidyProse('Text ( like this ) here'), 'Text (like this) here');
});

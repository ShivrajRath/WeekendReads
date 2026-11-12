'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  cleanArticleText,
  cleanExcerpt,
  cleanHeadline,
  entryIsWithinWindow,
  entryLooksEditorial,
} = require('../src/feedFetcher');
const { CONFIG } = require('../src/config');

test('keeps only entries inside the seven-day window', () => {
  const originalWindow = CONFIG.windowDays;
  CONFIG.windowDays = 7;
  try {
    assert.equal(entryIsWithinWindow(new Date('2026-11-09T12:00:00Z'), '2026-11-10'), true);
    assert.equal(entryIsWithinWindow(new Date('2026-11-03T12:00:00Z'), '2026-11-10'), true);
    assert.equal(entryIsWithinWindow(new Date('2026-11-03T11:59:00Z'), '2026-11-10'), false);
    assert.equal(entryIsWithinWindow(new Date('2026-11-11T00:00:00Z'), '2026-11-10'), true);
    assert.equal(entryIsWithinWindow(new Date('2026-11-11T13:00:00Z'), '2026-11-10'), false);
    assert.equal(entryIsWithinWindow(new Date('not a date'), '2026-11-10'), false);
  } finally {
    CONFIG.windowDays = originalWindow;
  }
});

test('blocks non-editorial and obituary entries', () => {
  const good = {
    title: 'The long argument about how cities remember their dead',
    link: 'https://example.com/story',
  };
  assert.equal(entryLooksEditorial(good), true);

  const checks = [
    { title: 'Speech Processing Pioneer Dies at 93', link: 'https://example.com/obit' },
    { title: 'In memoriam: a life in letters', link: 'https://example.com/memoriam' },
    { title: 'Watch: the week in pictures', link: 'https://example.com/watch' },
    { title: 'The morning briefing for Tuesday', link: 'https://example.com/briefing' },
    { title: 'A genuinely long headline', link: 'https://example.com/video/story' },
    {
      title: 'Evolving metal extraction processes',
      link: 'https://example.com/sponsored/metal',
      categories: ['Engineering', 'sponsored'],
    },
  ];
  for (const entry of checks) {
    assert.equal(entryLooksEditorial(entry), false, entry.title);
  }

  assert.equal(entryLooksEditorial({ title: 'Short', link: 'https://example.com/a' }), false);
  assert.equal(entryLooksEditorial({ title: good.title, link: 'javascript:alert(1)' }), false);
});

test('removes feed boilerplate from article text and excerpts', () => {
  const text = cleanArticleText(
    [
      'The first real paragraph contains enough words to survive the filter.',
      'Subscribe to our newsletter for more stories like this one.',
      'Read on Aeon',
      'The post The Case for a Bubble first appeared on Quanta Magazine.',
      'A second real paragraph also stays in the extracted body.',
    ].join('\n\n'),
  );

  assert.match(text, /first real paragraph/);
  assert.match(text, /second real paragraph/);
  assert.doesNotMatch(text, /Subscribe to our newsletter/);

  const repaired = cleanArticleText(
    [
      'H alifax’s first encounter with illness came decades earlier.',
      '[Read: another dispatch from the campaign] Garcia, for his part, struck no conciliatory tone.',
    ].join('\n\n'),
  );
  assert.match(repaired, /Halifax’s first encounter/);
  assert.match(repaired, /Garcia, for his part/);
  assert.doesNotMatch(repaired, /\[Read:/);

  const atlantic = cleanArticleText(
    [
      'Photographs by Sophie Green',
      'This article was featured in the One Story to Read Today newsletter.',
      'Sign up for it here.',
      'On a Hallmark movie set, it is always Christmas but rarely winter.',
      'Updated at 12:15 p.m. ET on Nov. 10, 2026',
    ].join('\n\n'),
  );
  assert.match(atlantic, /On a Hallmark movie set/);
  assert.doesNotMatch(atlantic, /Photographs by|newsletter|Sign up for it here|Updated at/);

  const proPublica = cleanArticleText(
    [
      'A Little-Known Investment: Bill Gates has quietly accumulated a stake in a landfill operator.',
      'Climate Pollution: Inspectors found methane escaping from landfills.',
      'These highlights were written by the reporters and editors who worked on this story.',
      'In November 2015, world leaders descended on Paris to negotiate a historic agreement.',
    ].join('\n\n'),
  );
  assert.match(proPublica, /In November 2015/);
  assert.doesNotMatch(proPublica, /A Little-Known Investment|These highlights/);

  const carbonBrief = cleanArticleText(
    [
      'Carbon dioxide emissions are projected to fall in 2026.',
      'This guest post is by:',
      'Dr Zeke Hausfather, Carbon Brief’s climate science contributor',
      'Prof Pierre Friedlingstein, chair of mathematical modelling at the University of Exeter.',
      'The 21st edition of the annual global carbon budget report was published today.',
    ].join('\n\n'),
  );
  assert.match(carbonBrief, /Carbon dioxide emissions/);
  assert.match(carbonBrief, /21st edition/);
  assert.doesNotMatch(carbonBrief, /This guest post|Zeke|Pierre/);

  assert.equal(
    cleanExcerpt('A useful summary of the reporting. Read on Aeon'),
    'A useful summary of the reporting.',
  );
  assert.equal(
    cleanExcerpt(
      'A useful summary of the reporting. The post The Case for a Bubble first appeared on Quanta Magazine.',
    ),
    'A useful summary of the reporting.',
  );
  assert.equal(cleanExcerpt('- by Ben Daitz A useful summary of the reporting.'), 'A useful summary of the reporting.');
});

test('removes publication suffixes from extracted headlines', () => {
  assert.equal(
    cleanHeadline('How does Roshi Joan Halifax make sense of her Buddhist life? | Aeon Essays', 'Aeon'),
    'How does Roshi Joan Halifax make sense of her Buddhist life?',
  );
  assert.equal(
    cleanHeadline('The Case for a Bubble at Life’s Start | Quanta Magazine', 'Quanta Magazine'),
    'The Case for a Bubble at Life’s Start',
  );
  assert.equal(
    cleanHeadline('Why Pete Hegseth Faces Impeachment | The Atlantic', 'The Atlantic'),
    'Why Pete Hegseth Faces Impeachment',
  );
  assert.equal(cleanHeadline('A normal headline', 'Aeon'), 'A normal headline');
});

'use strict';

const Parser = require('rss-parser');
const { JSDOM, VirtualConsole } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const { CONFIG } = require('./config');
const {
  addDays,
  countWords,
  hashId,
  isPublicHttpUrl,
  mapLimit,
  normalizeInline,
  normalizeWhitespace,
  parseDateOnly,
  readingTimeMinutes,
  safeUrl,
  stripHtml,
  stripSiteSuffix,
  tidyProse,
  truncate,
  uniqueBy,
} = require('./utils');

const TITLE_BLOCKLIST = [
  /\bpodcasts?\b/i,
  /\baudio\b/i,
  /\b(video|videos)\b/i,
  /\bwatch\b/i,
  /\blisten\b/i,
  /\blive\b/i,
  /\bas it happened\b/i,
  /\blive updates?\b/i,
  /\bbriefing\b/i,
  /\bnewsletter\b/i,
  /\bcrossword\b/i,
  /\bquiz\b/i,
  /\bcartoon\b/i,
  /\bin pictures\b/i,
  /\bphotos?\b/i,
  /\bhoroscope\b/i,
  /\bweather\b/i,
  /\bobituar/i,
  /\bin memoriam\b/i,
  /\b(dies|died) at\b/i,
  /\bremembering\b/i,
  /\bletters?\b/i,
  /\bthe daily\b/i,
  /\bmorning briefing\b/i,
  /\bevening report\b/i,
  /\bwhat is\b/i,
  /\bhow to\b/i,
  /\bquiz\b/i,
  /\bthis week in\b/i,
];

const URL_BLOCKLIST = [
  /\/video\//i,
  /\/videos\//i,
  /\/podcast/i,
  /\/audio\//i,
  /\/live\//i,
  /\/gallery\//i,
  /\/pictures\//i,
  /\/crossword/i,
  /\/quiz/i,
  /\/newsletters?\//i,
  /\/cartoon/i,
  /\/interactive\//i,
];

const BOILERPLATE_PATTERNS = [
  /^sign up\b/i,
  /^subscribe\b/i,
  /^read more\b/i,
  /^read on\b/i,
  /^continue reading\b/i,
  /^the post .+ first appeared on\b/i,
  /^listen to\b/i,
  /^watch\b/i,
  /^follow us\b/i,
  /^share this\b/i,
  /^advertisement\b/i,
  /^supported by\b/i,
  /^photographs? by\b/i,
  /^illustrations? by\b/i,
  /^updated at\b/i,
  /^this article was featured in\b/i,
  /^sign up for it here\b/i,
  /^this guest post is by\b/i,
  /^these highlights were written\b/i,
  /^sources?:\s/i,
  /^methods?:\s/i,
  /^note:\s/i,
  /^chart:\s/i,
  /^the authors? (?:do not|does not)\b/i,
  /^[A-Z][\w.'’-]+(?:\s+[A-Z][\w.'’-]+){0,2}\s+for\s+(ProPublica|The Atlantic|The New Yorker|The Guardian|Wired|The Conversation|Carbon Brief|Frontline|Foreign Affairs|Quanta Magazine|Aeon|MIT Technology Review|IEEE Spectrum)\s*$/i,
  /^photograph(er)?:/i,
  /^illustration:/i,
  /^image:/i,
  /^credit:/i,
  /^getty images\b/i,
  /^this article (was|is) (originally )?published\b/i,
  /^this story (was|is)\b/i,
  /^©/u,
  /^all rights reserved\b/i,
];

const parser = new Parser({
  customFields: {
    item: [
      ['content:encoded', 'contentEncoded'],
      ['dc:creator', 'dcCreator'],
      ['media:content', 'mediaContent'],
      ['media:thumbnail', 'mediaThumbnail'],
    ],
  },
});

function log(message) {
  console.log(`[feeds] ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchText(url, { timeout = CONFIG.requestTimeoutMs, retries = 2 } = {}) {
  if (!isPublicHttpUrl(url)) {
    throw new Error(`Refusing to fetch non-public URL: ${url}`);
  }

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(timeout),
        headers: {
          'user-agent': CONFIG.userAgent,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'en-GB,en;q=0.9',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
      }

      const length = Number(response.headers.get('content-length') || 0);
      if (length > 8 * 1024 * 1024) {
        throw new Error('Response is larger than 8 MB.');
      }

      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > 8 * 1024 * 1024) {
        throw new Error('Response is larger than 8 MB.');
      }

      return {
        text: new TextDecoder('utf-8').decode(buffer),
        contentType: response.headers.get('content-type') || '',
        finalUrl: response.url || url,
      };
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await sleep(500 * (attempt + 1));
      }
    }
  }
  throw lastError;
}

function entryIsWithinWindow(date, issueDate) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return false;
  const issueNoon = parseDateOnly(issueDate);
  const cutoff = new Date(issueNoon.getTime() - CONFIG.windowDays * 24 * 60 * 60 * 1000);
  const end = new Date(issueNoon.getTime() + 24 * 60 * 60 * 1000);
  return date >= cutoff && date < end;
}

function entryLooksEditorial(entry) {
  const title = normalizeInline(entry.title || '');
  if (title.length < 18) return false;
  if (TITLE_BLOCKLIST.some((pattern) => pattern.test(title))) return false;

  const categories = Array.isArray(entry.categories) ? entry.categories : [];
  if (
    categories.some((category) =>
      /sponsored|advertisement|advertising|paid (?:content|post)|partner content/i.test(
        typeof category === 'string' ? category : category?._ || '',
      ),
    )
  ) {
    return false;
  }

  const link = safeUrl(entry.link || '');
  if (!link) return false;
  if (URL_BLOCKLIST.some((pattern) => pattern.test(link))) return false;
  return true;
}

function titleKey(title) {
  return String(title)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function getEntryContent(entry) {
  const raw =
    entry.contentEncoded ||
    entry.content ||
    entry.summary ||
    entry.contentSnippet ||
    entry.description ||
    '';
  return normalizeWhitespace(stripHtml(raw));
}

function getEntryAuthor(entry) {
  const author = entry.dcCreator || entry.creator || entry.author || '';
  return truncate(normalizeInline(author), 100) || 'Staff';
}

function getEntryImage(entry) {
  const media = entry.mediaContent;
  if (media) {
    if (typeof media === 'string') return safeUrl(media);
    if (media.$ && media.$.url) return safeUrl(media.$.url);
    if (Array.isArray(media) && media[0]?.$?.url) return safeUrl(media[0].$.url);
  }
  const thumbnail = entry.mediaThumbnail;
  if (thumbnail?.$?.url) return safeUrl(thumbnail.$.url);
  if (entry.enclosure?.url && /^image\//.test(entry.enclosure.type || '')) {
    return safeUrl(entry.enclosure.url);
  }
  return null;
}

function cleanArticleText(rawText) {
  const repaired = String(rawText || '')
    .replace(/(^|\n)([B-HJ-Z])\s+([a-z]{3,})/g, '$1$2$3')
    .replace(/\[(?:Read|Related|More|See|Also)[^\]]*\]\s*/gi, ' ')
    .replace(/\bSource images?:[^.]*\.\s*/gi, ' ');

  let paragraphs = normalizeWhitespace(repaired)
    .split(/\n{2,}/)
    .map((paragraph) => normalizeInline(paragraph))
    .map((paragraph) => {
      if (!/\b(Getty Images|Reuters|Associated Press|AP Photo|AFP)\b/i.test(paragraph)) {
        return paragraph;
      }
      if (paragraph.split(/\s+/).length <= 40) return '';
      return paragraph
        .replace(/\b[A-Z][\w.'’-]+(?:\s+[A-Z][\w.'’-]+){0,2}\/[A-Z][\w.'’ -]{2,40}\s+via\s+Getty Images\s*/g, ' ')
        .replace(/\b(?:Getty Images|Reuters|Associated Press|AP Photo|AFP)\b[^.]*\.?\s*$/i, ' ')
        .trim();
    })
    .map((paragraph) =>
      paragraph.replace(
        /^([A-Z][\w.'’-]+(?:\s+[A-Z][\w.'’-]+){0,2})\s+for\s+(ProPublica|The Atlantic|The New Yorker|The Guardian|Wired|The Conversation|Carbon Brief|Frontline|Foreign Affairs|Quanta Magazine|Aeon|MIT Technology Review|IEEE Spectrum)\b\.?\s+/i,
        '',
      ),
    )
    .filter((paragraph) => paragraph.length > 0);

  // ProPublica and similar outlets prepend a summary block before the lede.
  const highlightsEnd = paragraphs.findIndex((paragraph) =>
    /^these highlights were written\b/i.test(paragraph),
  );
  if (highlightsEnd >= 0 && highlightsEnd < 12) {
    paragraphs = paragraphs.slice(highlightsEnd + 1);
  }

  // Remove a guest-post credit block, including the author affiliation lines.
  const guestIndex = paragraphs.findIndex((paragraph) => /^this guest post is by\b/i.test(paragraph));
  if (guestIndex >= 0) {
    let end = guestIndex + 1;
    while (end < paragraphs.length && end <= guestIndex + 4) {
      const paragraph = paragraphs[end];
      const words = paragraph.split(/\s+/).length;
      const looksLikeCredit =
        /(carbon brief|university|institute|college|school|project|dr\.?\s|prof\.?\s|professor|editor|correspondent|reporter)/i.test(
          paragraph,
        );
      if (words < 45 && looksLikeCredit) end += 1;
      else break;
    }
    paragraphs.splice(guestIndex, end - guestIndex);
  }

  paragraphs = paragraphs
    .filter((paragraph) => !BOILERPLATE_PATTERNS.some((pattern) => pattern.test(paragraph)))
    .filter((paragraph) => paragraph.split(/\s+/).length > 4 || /[.!?]$/.test(paragraph))
    .filter(
      (paragraph) =>
        !(
          paragraph.split(/\s+/).length <= 16 &&
          !/[.!?…”’]$/.test(paragraph)
        ),
    )
    .filter(
      (paragraph) =>
        !(
          paragraph.split(/\s+/).length <= 40 &&
          /\b(Getty Images|Reuters|Associated Press|AP Photo|AFP)\b/i.test(paragraph)
        ),
    );

  const deduped = [];
  const seen = new Set();
  for (const paragraph of paragraphs) {
    const key = paragraph.toLowerCase().slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(paragraph);
  }
  return deduped.join('\n\n');
}

const EXCERPT_TAIL_PATTERNS = [
  /\s*Read on [A-Z][\w .&'’-]{1,50}\s*$/i,
  /\s*Read more(?: about .*?)?\s*$/i,
  /\s*Continue reading.*$/i,
  /\s*The post .{0,240}? first appeared on .{0,100}?$/i,
  /\s*This (?:article|story) (?:was|is) (?:originally )?published.*$/i,
  /\s+-\s*by [A-Z][\w .'’-]{2,60}$/,
];

function cleanExcerpt(rawText) {
  let text = stripHtml(rawText || '');
  for (const pattern of EXCERPT_TAIL_PATTERNS) text = text.replace(pattern, '');
  text = text.replace(/^\s*[-–—]?\s*by\s+[A-Z][\w'’-]+(?:\s+[A-Z][\w'’-]+){0,3}\s+/, '');
  return tidyProse(text);
}

function cleanHeadline(rawTitle, siteName = '') {
  let title = tidyProse(stripSiteSuffix(rawTitle || '', siteName));
  for (const pattern of EXCERPT_TAIL_PATTERNS) title = title.replace(pattern, '');
  return title.trim();
}

function htmlBlocksToText(html) {
  const withBreaks = String(html || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<figure\b[^>]*>[\s\S]*?<\/figure>/gi, ' ')
    .replace(/<figcaption\b[^>]*>[\s\S]*?<\/figcaption>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h[1-6]|blockquote|li|div)>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ');
  return cleanArticleText(stripHtml(withBreaks));
}

function parseJsonLd(document) {
  const scripts = [...document.querySelectorAll('script[type="application/ld+json"]')];
  const records = [];
  for (const script of scripts.slice(0, 4)) {
    try {
      const parsed = JSON.parse(script.textContent);
      if (Array.isArray(parsed)) records.push(...parsed);
      else if (parsed['@graph']) records.push(...parsed['@graph']);
      else records.push(parsed);
    } catch {
      // Ignore malformed JSON-LD blocks.
    }
  }
  return records.filter((record) => record && typeof record === 'object');
}

function findJsonLdArticle(document) {
  function isArticle(record) {
    const type = record['@type'];
    return (
      type === 'Article' ||
      type === 'NewsArticle' ||
      type === 'ReportageNewsArticle' ||
      type === 'BlogPosting' ||
      (Array.isArray(type) && type.includes('Article'))
    );
  }

  const records = parseJsonLd(document);
  return records.find(isArticle) || {};
}

function extractAuthorFromJsonLd(record) {
  if (!record.author) return '';
  const authors = Array.isArray(record.author) ? record.author : [record.author];
  return authors
    .map((author) => (typeof author === 'string' ? author : author?.name || ''))
    .filter(Boolean)
    .join(', ');
}

async function extractArticle(url, sourceName) {
  const { text: html, contentType, finalUrl } = await fetchText(url, {
    retries: 1,
  });

  if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
    throw new Error(`Unsupported content type: ${contentType}`);
  }

  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(html, { url: finalUrl || url, virtualConsole });
  const { document } = dom.window;

  const canonical =
    document.querySelector('link[rel="canonical"]')?.getAttribute('href') || finalUrl || url;
  const ogTitle = document.querySelector('meta[property="og:title"]')?.content || '';
  const ogImage =
    document.querySelector('meta[property="og:image"]')?.content ||
    document.querySelector('meta[name="twitter:image"]')?.content ||
    '';
  const metaAuthor = document.querySelector('meta[name="author"]')?.content || '';
  const published =
    document.querySelector('meta[property="article:published_time"]')?.content ||
    document.querySelector('time[datetime]')?.getAttribute('datetime') ||
    '';
  const siteName =
    document.querySelector('meta[property="og:site_name"]')?.content || sourceName;

  const jsonLd = findJsonLdArticle(document);
  const jsonLdAuthor = extractAuthorFromJsonLd(jsonLd);
  const jsonLdPublished = jsonLd.datePublished || '';

  for (const selector of [
    'script',
    'style',
    'noscript',
    'nav',
    'footer',
    'aside',
    'form',
    'figure',
    'figcaption',
    'iframe',
    '[aria-hidden="true"]',
  ]) {
    document.querySelectorAll(selector).forEach((node) => node.remove());
  }

  let article = null;
  try {
    article = new Readability(document.cloneNode(true), {
      charThreshold: 600,
      keepClasses: false,
      nbTopCandidates: 6,
    }).parse();
  } catch {
    article = null;
  }

  const text = cleanArticleText(htmlBlocksToText(article?.content || ''));
  const wordCount = countWords(text);

  return {
    text,
    wordCount,
    title: truncate(normalizeInline(article?.title || ogTitle), 220),
    author: truncate(normalizeInline(article?.byline || jsonLdAuthor || metaAuthor), 100),
    siteName: truncate(normalizeInline(article?.siteName || siteName), 100),
    publishedAt: article?.publishedTime || published || jsonLdPublished,
    imageUrl: safeUrl(ogImage),
    canonicalUrl: safeUrl(canonical),
    finalUrl: safeUrl(finalUrl) || safeUrl(url),
  };
}

function buildCandidate(entry, meta, article) {
  const articleText = article?.text || '';
  const feedText = cleanArticleText(entry.contentText || '');
  const content =
    countWords(articleText) >= countWords(feedText) ? articleText : feedText;
  const wordCount = countWords(content);
  const link = article?.canonicalUrl || entry.link;
  const siteName = article?.siteName || meta.source.name;
  const headline =
    cleanHeadline(article?.title || entry.title, siteName) ||
    cleanHeadline(entry.title, meta.source.name);
  const contentParagraphs = content
    .split(/\n{2,}/)
    .map((paragraph) => normalizeInline(paragraph))
    .filter((paragraph) => paragraph.split(/\s+/).length >= 8);
  const excerptSource =
    cleanExcerpt(contentParagraphs[0] || '') || cleanExcerpt(entry.excerpt);
  return {
    id: hashId(link),
    category: meta.category.id,
    categoryName: meta.category.name,
    categoryShortName: meta.category.shortName || meta.category.name,
    sourceName: meta.source.name,
    sourceFeed: meta.source.url,
    sourceWeight: Number(meta.source.weight || 1),
    title: truncate(headline, 220),
    link,
    pubDate: entry.pubDate.toISOString(),
    publishedAt: entry.pubDate.toISOString(),
    author: truncate(normalizeInline(article?.author || entry.author), 100) || 'Staff',
    excerpt: truncate(excerptSource, 280),
    contentText: content,
    wordCount,
    readingTimeMinutes: readingTimeMinutes(wordCount, CONFIG.wordsPerMinute),
    imageUrl: article?.imageUrl || entry.imageUrl || null,
    extraction: article?.wordCount >= wordCount ? 'article' : 'feed',
  };
}

function preliminaryScore(entry, meta) {
  const ageHours = Math.max(0, (Date.now() - entry.pubDate.getTime()) / 3_600_000);
  const recency = Math.max(0, 7 * 24 - ageHours) / 24;
  const length = Math.min(entry.fullWordCount || 0, 5000) / 1000;
  return recency * 1.4 + Number(meta.source.weight || 1) * 4 + length * 0.8;
}

function pickDiverse(entries, limit) {
  const bySource = new Map();
  for (const entry of entries) {
    const key = entry.sourceFeed;
    if (!bySource.has(key)) bySource.set(key, []);
    bySource.get(key).push(entry);
  }
  const queues = [...bySource.values()];
  const picked = [];
  let round = 0;
  while (picked.length < limit) {
    let added = false;
    for (const queue of queues) {
      if (picked.length >= limit) break;
      const item = queue[round];
      if (item) {
        picked.push(item);
        added = true;
      }
    }
    if (!added) break;
    round += 1;
  }
  return picked;
}

async function fetchFeed(source, category) {
  const feedUrl = safeUrl(source.url);
  if (!feedUrl) throw new Error('Invalid feed URL.');

  const { text } = await fetchText(feedUrl, {
    retries: CONFIG.feedRetries,
    timeout: CONFIG.requestTimeoutMs,
  });
  const feed = await parser.parseString(text);
  const items = Array.isArray(feed.items) ? feed.items : [];
  return items.map((item) => {
    const link = safeUrl(item.link || item.guid || '');
    const date = new Date(item.isoDate || item.pubDate || item.date || '');
    const contentText = getEntryContent(item);
    return {
      title: normalizeInline(item.title || feed.title || ''),
      link,
      pubDate: date,
      author: getEntryAuthor(item),
      excerpt: truncate(item.contentSnippet || contentText, 280),
      contentText,
      fullWordCount: countWords(contentText),
      imageUrl: getEntryImage(item),
      categories: Array.isArray(item.categories)
        ? item.categories.map((category) => String(category || ''))
        : [],
      sourceFeed: feedUrl,
      sourceName: source.name,
      category,
      sourceWeight: Number(source.weight || 1),
    };
  });
}

async function collectFeedEntries(sources) {
  const categories = Array.isArray(sources.categories) ? sources.categories : [];
  const jobs = [];
  for (const category of categories) {
    for (const source of category.feeds || []) {
      jobs.push({ category, source });
    }
  }

  const results = await mapLimit(jobs, CONFIG.feedConcurrency, async ({ category, source }) => {
    try {
      const rawEntries = await fetchFeed(source, category);
      const entries = rawEntries.filter(
        (entry) =>
          entry.pubDate instanceof Date &&
          !Number.isNaN(entry.pubDate.getTime()) &&
          entry.link &&
          entryLooksEditorial(entry),
      );
      return { category, source, entries, error: null };
    } catch (error) {
      return { category, source, entries: [], error };
    }
  });

  const failedFeeds = [];
  const entriesByCategory = new Map();
  for (const result of results) {
    if (result.error) {
      failedFeeds.push({
        category: result.category.id,
        source: result.source.name,
        url: result.source.url,
        error: result.error.message,
      });
      continue;
    }
    if (!entriesByCategory.has(result.category.id)) {
      entriesByCategory.set(result.category.id, []);
    }
    entriesByCategory.get(result.category.id).push(
      ...result.entries.map((entry) => ({ ...entry, category: result.category, source: result.source })),
    );
  }

  return { categories, entriesByCategory, failedFeeds, feedsAttempted: jobs.length };
}

function dedupeEntries(entries) {
  const byLink = uniqueBy(entries, (entry) => entry.link);
  return uniqueBy(byLink, (entry) => titleKey(entry.title).slice(0, 90));
}

async function fetchCandidates(sources, { issueDate }) {
  const started = Date.now();
  const { categories, entriesByCategory, failedFeeds, feedsAttempted } =
    await collectFeedEntries(sources);

  let entriesScanned = 0;
  for (const entries of entriesByCategory.values()) entriesScanned += entries.length;

  const categoryJobs = [];
  for (const category of categories) {
    const allEntries = entriesByCategory.get(category.id) || [];
    const inWindow = allEntries.filter((entry) => entryIsWithinWindow(entry.pubDate, issueDate));
    const entries = dedupeEntries(inWindow).sort((a, b) => {
      const dateDiff = b.pubDate.getTime() - a.pubDate.getTime();
      if (dateDiff !== 0) return dateDiff;
      return (
        preliminaryScore(b, { source: { weight: b.sourceWeight } }) -
        preliminaryScore(a, { source: { weight: a.sourceWeight } })
      );
    });
    const picked = pickDiverse(entries, CONFIG.enrichPerCategory);
    categoryJobs.push({ category, entries: picked, totalInWindow: entries.length });
  }

  const enriched = await mapLimit(
    categoryJobs,
    Math.min(categoryJobs.length, 4),
    async ({ category, entries, totalInWindow }) => {
      const accepted = [];
      const rejected = [];

      for (const entry of entries) {
        if (accepted.length >= CONFIG.candidatesPerCategory) break;

        let article = null;
        let extractionError = null;
        const feedWordCount = countWords(entry.contentText);
        const needsPageFetch = feedWordCount < CONFIG.minWords;

        if (needsPageFetch) {
          try {
            article = await extractArticle(entry.link, entry.sourceName);
          } catch (error) {
            extractionError = error.message;
          }
        }

        const candidate = buildCandidate(
          { ...entry, category: category.id },
          { category, source: entry.source },
          article,
        );

        if (
          candidate.wordCount >= CONFIG.minWords &&
          candidate.contentText &&
          candidate.contentText.split(/\n{2,}/).length >= 3
        ) {
          accepted.push(candidate);
        } else {
          rejected.push({
            title: entry.title,
            link: entry.link,
            words: candidate.wordCount,
            error: extractionError,
          });
        }
      }

      return { category, entries, totalInWindow, accepted, rejected };
    },
  );

  const candidates = [];
  const categoriesWithCandidates = [];
  const categoryStats = [];
  const rejectedArticles = [];

  for (const job of enriched) {
    if (job.accepted.length) {
      candidates.push(...job.accepted);
      categoriesWithCandidates.push(job.category.id);
    }
    categoryStats.push({
      id: job.category.id,
      name: job.category.name,
      inWindow: job.totalInWindow,
      considered: job.entries.length,
      accepted: job.accepted.length,
    });
    rejectedArticles.push(
      ...job.rejected.slice(0, 3).map((article) => ({
        category: job.category.id,
        title: article.title,
        words: article.words,
        error: article.error,
      })),
    );
  }

  const filtered = dedupeCandidates(candidates);
  const durationMs = Date.now() - started;

  log(
    `${filtered.length} longform candidates from ${categoriesWithCandidates.length}/${categories.length} categories ` +
      `(${feedsAttempted - failedFeeds.length}/${feedsAttempted} feeds, ${entriesScanned} entries, ${(durationMs / 1000).toFixed(1)}s)`,
  );

  return {
    candidates: filtered,
    stats: {
      issueDate,
      windowDays: CONFIG.windowDays,
      minWords: CONFIG.minWords,
      feedsAttempted,
      feedsSucceeded: feedsAttempted - failedFeeds.length,
      entriesScanned,
      categoriesWithCandidates,
      categoryStats,
      rejectedArticles: rejectedArticles.slice(0, 20),
      durationMs,
    },
    failedFeeds,
  };
}

function dedupeCandidates(candidates) {
  const sorted = [...candidates].sort((a, b) => b.wordCount - a.wordCount);
  const byLink = uniqueBy(sorted, (candidate) => candidate.link);
  return uniqueBy(byLink, (candidate) => titleKey(candidate.title).slice(0, 90));
}

module.exports = {
  extractArticle,
  fetchCandidates,
  entryIsWithinWindow,
  entryLooksEditorial,
  cleanArticleText,
  cleanExcerpt,
  cleanHeadline,
};

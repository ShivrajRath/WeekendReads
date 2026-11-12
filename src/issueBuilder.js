'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { CATEGORY_ORDER, CONFIG } = require('./config');
const { buildLocalCuration } = require('./localCurator');
const {
  formatLongDate,
  formatMediumDate,
  formatShortDate,
  hashId,
  normalizeInline,
  parseDateOnly,
  romanNumeral,
  seasonFor,
  truncate,
  weekStart,
} = require('./utils');

function listExistingIssues() {
  if (!fs.existsSync(CONFIG.issuesDataDir)) return [];
  return fs
    .readdirSync(CONFIG.issuesDataDir)
    .filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file))
    .map((file) => {
      const issueDate = file.replace(/\.json$/, '');
      try {
        const data = JSON.parse(fs.readFileSync(path.join(CONFIG.issuesDataDir, file), 'utf8'));
        return {
          issueDate,
          issueNumber: Number(data.issue_number || 0),
          data,
        };
      } catch {
        return { issueDate, issueNumber: 0, data: null };
      }
    })
    .sort((a, b) => a.issueDate.localeCompare(b.issueDate));
}

function resolveIssueNumber(issueDate) {
  const existing = listExistingIssues();
  const current = existing.find((issue) => issue.issueDate === issueDate);
  if (current && current.issueNumber > 0) return current.issueNumber;
  const earlier = existing.filter((issue) => issue.issueDate < issueDate);
  return earlier.length + 1;
}

function providerLabel(provider) {
  if (!provider) return 'Weekend Reads editorial desk';
  if (provider.startsWith('gemini:')) {
    const model = provider.slice('gemini:'.length);
    return `Gemini · ${model}`;
  }
  if (provider.startsWith('groq:')) {
    const model = provider.slice('groq:'.length);
    return `Groq · ${model}`;
  }
  if (provider.startsWith('local:')) return 'Local editorial engine';
  return provider;
}

function normaliseArticle(article, index) {
  const sourceUrl = article.source_url || article.link || '';
  const category = CATEGORY_ORDER.includes(article.category)
    ? article.category
    : CATEGORY_ORDER[index % CATEGORY_ORDER.length];

  return {
    id: article.id || hashId(`${article.title}-${sourceUrl}`),
    category,
    category_name: article.category_name || article.categoryName || 'Feature',
    category_short_name:
      article.category_short_name || article.categoryShortName || article.category_name || 'Feature',
    title: normalizeInline(article.title || 'Untitled'),
    dek: truncate(article.dek || article.executive_summary || '', 240),
    original_author: normalizeInline(article.original_author || article.author || 'Staff'),
    original_source: normalizeInline(article.original_source || article.sourceName || 'Original publication'),
    source_url: sourceUrl,
    published_at: article.published_at || article.publishedAt || null,
    reading_time_minutes: Math.max(1, Number(article.reading_time_minutes || 1)),
    word_count: Math.max(0, Number(article.word_count || 0)),
    executive_summary: normalizeInline(article.executive_summary || ''),
    key_takeaways: Array.isArray(article.key_takeaways)
      ? article.key_takeaways.map((item) => normalizeInline(item)).filter(Boolean).slice(0, 3)
      : [],
    key_quote: normalizeInline(article.key_quote || ''),
    digest_body: String(article.digest_body || '').trim(),
    image_url: article.image_url || null,
    featured: Boolean(article.featured),
    position: index + 1,
    source_weight: Number(article.source_weight || 1),
    selection_score: Number(article.selection_score || 0),
  };
}

function buildIssue({
  issueDate,
  issueNumber,
  curation,
  fetchStats = {},
  failedFeeds = [],
  reason = null,
  generatedAt = new Date().toISOString(),
}) {
  let articles = Array.isArray(curation.articles) ? curation.articles : [];
  if (!articles.length) {
    throw new Error('Cannot build an issue without articles.');
  }

  articles = articles.slice(0, CONFIG.maxArticles);

  // Exactly one featured story.
  if (!articles.some((article) => article.featured)) {
    articles[0].featured = true;
  } else {
    let seenFeatured = false;
    for (const article of articles) {
      if (article.featured && !seenFeatured) {
        seenFeatured = true;
      } else {
        article.featured = false;
      }
    }
  }

  const featured = articles.find((article) => article.featured);
  const categoryRank = new Map(CATEGORY_ORDER.map((category, index) => [category, index]));
  const ordered = [
    featured,
    ...articles
      .filter((article) => article !== featured)
      .sort((a, b) => {
        const categoryDiff =
          (categoryRank.get(a.category) ?? 99) - (categoryRank.get(b.category) ?? 99);
        if (categoryDiff !== 0) return categoryDiff;
        return (a.position || 0) - (b.position || 0);
      }),
  ].filter(Boolean);

  const normalized = ordered.map(normaliseArticle);
  normalized.forEach((article, index) => {
    article.position = index + 1;
  });

  const totalReadingTime = normalized.reduce(
    (sum, article) => sum + Number(article.reading_time_minutes || 0),
    0,
  );
  const totalWords = normalized.reduce((sum, article) => sum + Number(article.word_count || 0), 0);
  const sources = [...new Set(normalized.map((article) => article.original_source))];
  const issueYear = parseDateOnly(issueDate).getUTCFullYear();
  const volume = romanNumeral(issueYear - 2025);

  const fallbackChain = Array.isArray(curation.fallback_chain) ? [...curation.fallback_chain] : [];
  if (
    curation.provider?.startsWith('local:') &&
    !fallbackChain.some((entry) => entry.provider === 'local' && entry.status === 'used')
  ) {
    fallbackChain.push({
      provider: 'local',
      model: curation.model || 'weekend-reads-editorial-engine',
      status: 'used',
      reason: reason || 'Local editorial engine.',
    });
  }

  return {
    schema_version: 1,
    issue_date: issueDate,
    issue_number: issueNumber,
    issue_number_display: String(issueNumber).padStart(2, '0'),
    issue_date_long: formatLongDate(issueDate),
    issue_date_medium: formatMediumDate(issueDate),
    issue_date_short: formatShortDate(issueDate),
    weekday: formatLongDate(issueDate).split(',')[0],
    week_label: `Week of ${formatMediumDate(weekStart(issueDate))}`,
    season: `${seasonFor(issueDate)} ${issueYear}`,
    volume,
    editor_note: String(curation.editor_note || '').trim(),
    articles: normalized,
    meta: {
      generated_at: generatedAt,
      curation: {
        provider: curation.provider || 'local:extractive',
        provider_label: providerLabel(curation.provider),
        model: curation.model || null,
        mode: curation.provider?.startsWith('local:') ? 'local' : 'llm',
        fallback_chain: fallbackChain,
      },
      counts: {
        articles: normalized.length,
        sources: sources.length,
        categories: new Set(normalized.map((article) => article.category)).size,
        total_reading_minutes: totalReadingTime,
        total_source_words: totalWords,
      },
      sources,
      ingestion: {
        window_days: fetchStats.windowDays ?? CONFIG.windowDays,
        min_words: fetchStats.minWords ?? CONFIG.minWords,
        feeds_attempted: fetchStats.feedsAttempted ?? null,
        feeds_succeeded: fetchStats.feedsSucceeded ?? null,
        entries_scanned: fetchStats.entriesScanned ?? null,
        categories_with_candidates: fetchStats.categoriesWithCandidates ?? [],
        category_stats: fetchStats.categoryStats ?? [],
        duration_ms: fetchStats.durationMs ?? null,
        failed_feeds: failedFeeds.slice(0, 30).map((feed) => ({
          source: feed.source,
          category: feed.category,
          error: truncate(feed.error, 140),
        })),
      },
    },
    links: {
      web: `issues/${issueDate}.html`,
      print: `issues/${issueDate}-print.html`,
      pdf: `issues/Issue-${issueDate}.pdf`,
      data: `issues/${issueDate}.json`,
    },
  };
}

function createFallbackCuration({ candidates, issueDate, issueNumber, reason, chain }) {
  const local = buildLocalCuration({ candidates, issueDate, issueNumber });
  return {
    ...local,
    fallback_chain: [...(chain || []), { provider: 'local', model: local.model, status: 'used', reason }],
  };
}

module.exports = {
  buildIssue,
  createFallbackCuration,
  listExistingIssues,
  providerLabel,
  resolveIssueNumber,
};

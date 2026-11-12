'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { CONFIG, CATEGORY_ORDER } = require('./config');
const {
  ensureDir,
  escapeHtml,
  formatLongDate,
  formatShortDate,
  renderMarkdown,
  truncate,
  writeFile,
  writeJson,
} = require('./utils');

function esc(value) {
  return escapeHtml(value ?? '');
}

function attr(value) {
  return escapeHtml(value ?? '');
}

function absoluteUrl(relativePath) {
  if (!CONFIG.siteUrl) return relativePath;
  const base = CONFIG.siteUrl.endsWith('/') ? CONFIG.siteUrl : `${CONFIG.siteUrl}/`;
  try {
    return new URL(relativePath, base).toString();
  } catch {
    return relativePath;
  }
}

function issueFacts(issue) {
  const articles = issue.articles || [];
  const featured = articles.find((article) => article.featured) || articles[0];
  const categories = [];
  for (const article of articles) {
    if (!categories.some((category) => category.id === article.category)) {
      categories.push({
        id: article.category,
        name: article.category_short_name || article.category_name,
        fullName: article.category_name,
        count: articles.filter((item) => item.category === article.category).length,
      });
    }
  }
  return {
    featured,
    categories,
    totalMinutes: issue.meta?.counts?.total_reading_minutes ??
      articles.reduce((sum, article) => sum + Number(article.reading_time_minutes || 0), 0),
    articleCount: articles.length,
    sourceCount: issue.meta?.counts?.sources ?? new Set(articles.map((a) => a.original_source)).size,
  };
}

function storyId(article) {
  return `story-${String(article.position).padStart(2, '0')}-${article.category}`;
}

function sourceDomain(url = '') {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'source';
  }
}

function publishedLabel(article, issue) {
  const raw = article.published_at;
  if (!raw) return formatShortDate(issue.issue_date);
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return formatShortDate(issue.issue_date);
  const iso = date.toISOString().slice(0, 10);
  return formatShortDate(iso);
}

function cleanQuote(value = '') {
  return String(value).replace(/^[\s"'“”‘’]+|[\s"'“”‘’]+$/g, '');
}

function coverArt() {
  return `<svg class="cover-art-svg" viewBox="0 0 520 520" role="presentation" aria-hidden="true" focusable="false">
  <defs>
    <pattern id="coverHatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
      <line x1="0" y1="0" x2="0" y2="7" stroke="var(--ink)" stroke-width="1" opacity=".22"/>
    </pattern>
  </defs>
  <circle cx="292" cy="236" r="158" fill="var(--accent)"/>
  <circle cx="292" cy="236" r="158" fill="url(#coverHatch)"/>
  <circle cx="292" cy="236" r="208" fill="none" stroke="var(--ink)" stroke-width="1" opacity=".35"/>
  <circle cx="292" cy="236" r="248" fill="none" stroke="var(--ink)" stroke-width="1" opacity=".18"/>
  <path d="M34 380h452M34 398h452M34 416h452M34 434h452" stroke="var(--ink)" stroke-width="1" opacity=".25"/>
  <path d="M94 236a158 158 0 0 1 316 0" fill="none" stroke="var(--paper)" stroke-width="2" opacity=".55"/>
  <g fill="var(--ink)">
    <circle cx="292" cy="236" r="4"/>
    <rect x="52" y="52" width="18" height="18"/>
    <rect x="76" y="52" width="4" height="18"/>
  </g>
  <text x="42" y="110" fill="var(--ink)" font-family="Inter, sans-serif" font-size="13" letter-spacing="4">EST. 2026</text>
  <text x="42" y="136" fill="var(--ink)" font-family="Inter, sans-serif" font-size="11" letter-spacing="2.5" opacity=".65">LONGFORM / WEEKLY</text>
</svg>`;
}

function themeBootstrap() {
  return `<script>(function(){try{var t=localStorage.getItem('wr-theme');if(!t){t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme='light';}})();</script>`;
}

function themeToggle() {
  return `<button class="theme-toggle" type="button" data-theme-toggle aria-label="Switch colour theme">
    <span class="theme-icon" aria-hidden="true">◐</span>
    <span class="theme-label">Night</span>
  </button>`;
}

function head({
  title,
  description,
  prefix = '.',
  canonicalPath,
  type = 'website',
  jsonLd = null,
  bodyClass = '',
}) {
  const canonical = canonicalPath ? absoluteUrl(canonicalPath) : '';
  const social = [
    `<meta property="og:site_name" content="${esc(CONFIG.siteName)}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:type" content="${esc(type)}">`,
    canonical ? `<meta property="og:url" content="${esc(canonical)}">` : '',
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(description)}">`,
  ]
    .filter(Boolean)
    .join('\n  ');

  return `<!doctype html>
<html lang="en" data-theme="light">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  ${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ''}
  ${social}
  <link rel="icon" href="${prefix}/favicon.svg" type="image/svg+xml">
  <link rel="preload" href="${prefix}/fonts/fraunces-latin.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="${prefix}/fonts/source-serif-4-latin.woff2" as="font" type="font/woff2" crossorigin>
  ${themeBootstrap()}
  <link rel="stylesheet" href="${prefix}/styles.css">
  ${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replaceAll('<', '\\u003c')}</script>` : ''}
</head>
<body id="top" class="${esc(bodyClass)}">
  <a class="skip-link" href="#main-content">Skip to content</a>
  <div class="reading-progress" aria-hidden="true"><span data-reading-progress></span></div>`;
}

function siteHeader({ issue, prefix, latest = false, current = 'issue' }) {
  const archiveHref = `${prefix}/archive.html`;
  const homeHref = `${prefix}/index.html`;
  const pdfHref = issue
    ? latest
      ? issue.links.pdf
      : issue.links.pdf.replace(/^issues\//, '')
    : '';
  return `<header class="site-header">
    <div class="utility-bar">
      <div class="utility-left">
        <a href="${archiveHref}">Archive</a>
        <span class="utility-rule" aria-hidden="true"></span>
        <a href="${homeHref}">Latest issue</a>
      </div>
      <div class="utility-centre" aria-hidden="true">Independent · Longform · Weekly</div>
      <div class="utility-right">
        ${issue ? `<a class="utility-pdf" href="${pdfHref}">PDF ↓</a>` : ''}
        ${themeToggle()}
      </div>
    </div>
    <div class="masthead">
      <p class="masthead-kicker">${esc(CONFIG.siteTagline)}</p>
      <a class="wordmark" href="${homeHref}" aria-label="Weekend Reads home">
        <span>Weekend</span><em>Reads</em>
      </a>
      <div class="masthead-rule" aria-hidden="true"><span></span><b>✳</b><span></span></div>
      ${
        issue
          ? `<p class="masthead-issue"><time datetime="${esc(issue.issue_date)}">${esc(issue.issue_date_long)}</time><span class="dot" aria-hidden="true">·</span><span>Vol. ${esc(issue.volume)} / No. ${esc(issue.issue_number_display)}</span><span class="dot" aria-hidden="true">·</span><span>${issue.meta?.counts?.articles || issue.articles.length} stories</span></p>`
          : `<p class="masthead-issue">The complete archive of editions</p>`
      }
    </div>
    <nav class="utility-mobile" aria-label="Primary">
      <a href="${homeHref}">Latest</a>
      <a href="${archiveHref}">Archive</a>
      ${issue ? `<a href="${pdfHref}">PDF</a>` : ''}
      ${themeToggle()}
    </nav>
  </header>`;
}

function coverSection(issue) {
  const { featured, totalMinutes, sourceCount } = issueFacts(issue);
  if (!featured) return '';
  const otherArticles = issue.articles.filter((article) => article !== featured).slice(0, 4);
  const coverLines = otherArticles
    .map(
      (article) => `<li>
        <span>${esc(article.category_short_name || article.category_name)}</span>
        <a href="#${storyId(article)}">${esc(article.title)}</a>
      </li>`,
    )
    .join('');

  return `<section class="cover" aria-labelledby="cover-title">
    <div class="cover-decoration">${coverArt()}</div>
    <div class="cover-grid">
      <div class="cover-copy">
        <p class="eyebrow"><span class="eyebrow-line"></span> Cover story · ${esc(featured.category_name)}</p>
        <h1 class="cover-title" id="cover-title"><a href="#${storyId(featured)}">${esc(featured.title)}</a></h1>
        <p class="cover-dek">${esc(featured.dek || featured.executive_summary)}</p>
        <p class="cover-byline">By ${esc(featured.original_author)} <span aria-hidden="true">·</span> ${esc(featured.original_source)} <span aria-hidden="true">·</span> <time datetime="${esc(featured.published_at || issue.issue_date)}">${esc(publishedLabel(featured, issue))}</time></p>
        <div class="cover-actions">
          <a class="button button--solid" href="#${storyId(featured)}">Begin reading <span aria-hidden="true">→</span></a>
          <span class="reading-badge">${esc(featured.reading_time_minutes)} min read</span>
        </div>
      </div>
      <aside class="cover-aside" aria-label="Issue details">
        <div class="issue-stamp">
          <span class="issue-stamp-label">Issue</span>
          <span class="issue-stamp-number">${esc(issue.issue_number_display)}</span>
          <time class="issue-stamp-date" datetime="${esc(issue.issue_date)}">${esc(issue.issue_date_medium)}</time>
          <span class="issue-stamp-season">${esc(issue.season)}</span>
        </div>
        <dl class="issue-stats">
          <div><dt>Stories</dt><dd>${issue.articles.length}</dd></div>
          <div><dt>Reading</dt><dd>${totalMinutes}<small>min</small></dd></div>
          <div><dt>Sources</dt><dd>${sourceCount}</dd></div>
        </dl>
        <p class="cover-aside-note">Ten pieces, one weekend. No infinite feed, no hurry.</p>
      </aside>
    </div>
    ${
      coverLines
        ? `<div class="cover-lines">
      <p class="cover-lines-label">Also in this issue</p>
      <ul>${coverLines}</ul>
    </div>`
        : ''
    }
  </section>`;
}

function editorNote(issue) {
  return `<section class="editor-note" aria-labelledby="editor-note-title">
    <div class="editor-note-mark" aria-hidden="true">“</div>
    <div class="editor-note-inner">
      <p class="eyebrow" id="editor-note-title">From the editor</p>
      <div class="editor-note-copy">${renderMarkdown(issue.editor_note || '')}</div>
      <p class="editor-note-signoff">— The Weekend Reads desk <span aria-hidden="true">·</span> <time datetime="${esc(issue.issue_date)}">${esc(issue.issue_date_medium)}</time></p>
    </div>
  </section>`;
}

function toolbar(issue, { latest = false } = {}) {
  const { categories } = issueFacts(issue);
  const pdfHref = latest ? issue.links.pdf : issue.links.pdf.replace(/^issues\//, '');
  const pills = categories
    .map(
      (category) =>
        `<button type="button" class="filter-pill" data-filter="${esc(category.id)}" aria-pressed="false">${esc(category.name)} <span>${category.count}</span></button>`,
    )
    .join('');
  return `<div class="toolbar" id="toolbar">
    <div class="toolbar-heading">
      <p class="eyebrow">The issue</p>
      <h2>${issue.articles.length} stories for the weekend</h2>
    </div>
    <div class="toolbar-controls">
      <div class="filter-row" role="group" aria-label="Filter stories by section">
        <button type="button" class="filter-pill is-active" data-filter="all" aria-pressed="true">All <span>${issue.articles.length}</span></button>
        ${pills}
      </div>
      <div class="toolbar-actions">
        <div class="layout-toggle" role="group" aria-label="Contents layout">
          <button type="button" data-layout="grid" class="is-active" aria-pressed="true" title="Grid view" aria-label="Grid view">▦</button>
          <button type="button" data-layout="list" aria-pressed="false" title="List view" aria-label="List view">☰</button>
        </div>
        <a class="toolbar-pdf" href="${pdfHref}" download>Download PDF</a>
      </div>
    </div>
    <p class="filter-status" data-filter-status aria-live="polite">Showing all ${issue.articles.length} stories</p>
  </div>`;
}

function contentsSection(issue) {
  const cards = issue.articles
    .map((article) => {
      const id = storyId(article);
      return `<article class="content-card${article.featured ? ' content-card--featured' : ''}" data-category="${esc(article.category)}">
        <a class="content-card-link" href="#${id}">
          <div class="content-card-top">
            <span class="content-card-number">${String(article.position).padStart(2, '0')}</span>
            <span class="content-card-category">${esc(article.category_short_name || article.category_name)}</span>
            ${article.featured ? '<span class="content-card-flag">Cover story</span>' : ''}
          </div>
          <h3 class="content-card-title">${esc(article.title)}</h3>
          <p class="content-card-dek">${esc(article.dek || article.executive_summary)}</p>
          <div class="content-card-meta"><span>${esc(article.original_source)}</span><span aria-hidden="true">·</span><span>${esc(article.reading_time_minutes)} min</span></div>
          <span class="content-card-arrow" aria-hidden="true">↗</span>
        </a>
      </article>`;
    })
    .join('');

  return `<section class="contents" id="contents" aria-labelledby="contents-title">
    <h2 class="sr-only" id="contents-title">Contents</h2>
    <div class="contents-grid">${cards}</div>
    <p class="empty-filter" data-empty-filter hidden>No stories in this section. <button type="button" data-reset-filter>Show all stories</button></p>
  </section>`;
}

function takeaways(article) {
  if (!Array.isArray(article.key_takeaways) || !article.key_takeaways.length) return '';
  return `<div class="takeaways">
    <p class="rail-label">Three things to know</p>
    <ol>${article.key_takeaways
      .slice(0, 3)
      .map((item) => `<li>${esc(item)}</li>`)
      .join('')}</ol>
  </div>`;
}

function storySection(article, issue, index) {
  const id = storyId(article);
  const reverse = index % 2 === 0;
  return `<article class="story${article.featured ? ' story--featured' : ''}${reverse ? ' story--reverse' : ''}" id="${id}" data-category="${esc(article.category)}" aria-labelledby="${id}-title">
    <header class="story-header">
      <div class="story-index" aria-hidden="true">${String(article.position).padStart(2, '0')}</div>
      <div class="story-heading">
        <p class="story-kicker"><span class="story-category">${esc(article.category_name)}</span><span class="dot" aria-hidden="true">·</span><time datetime="${esc(article.published_at || issue.issue_date)}">${esc(publishedLabel(article, issue))}</time><span class="dot" aria-hidden="true">·</span><span>${esc(article.reading_time_minutes)} min read</span></p>
        <h2 id="${id}-title">${esc(article.title)}</h2>
        <p class="story-dek">${esc(article.dek || '')}</p>
        <p class="story-byline">By <strong>${esc(article.original_author)}</strong> for <a href="${attr(article.source_url)}" target="_blank" rel="noopener noreferrer">${esc(article.original_source)}</a></p>
      </div>
    </header>
    <div class="story-body">
      <aside class="story-rail">
        ${takeaways(article)}
        <dl class="story-meta">
          <div><dt>Published</dt><dd><time datetime="${esc(article.published_at || issue.issue_date)}">${esc(publishedLabel(article, issue))}</time></dd></div>
          <div><dt>Length</dt><dd>${Number(article.word_count || 0).toLocaleString('en-GB')} words</dd></div>
          <div><dt>Reading time</dt><dd>${esc(article.reading_time_minutes)} minutes</dd></div>
        </dl>
        <a class="source-link" href="${attr(article.source_url)}" target="_blank" rel="noopener noreferrer">Read at ${esc(article.original_source)} <span aria-hidden="true">↗</span></a>
      </aside>
      <div class="story-content">
        <div class="editor-summary">
          <p class="editor-summary-label">The short version</p>
          <p>${esc(article.executive_summary)}</p>
        </div>
        ${
          article.key_quote
            ? `<blockquote class="pull-quote"><p>“${esc(cleanQuote(article.key_quote))}”</p></blockquote>`
            : ''
        }
        <div class="digest">${renderMarkdown(article.digest_body)}</div>
        <div class="story-end">
          <span class="end-mark" aria-hidden="true">■</span>
          <a class="source-link source-link--inline" href="${attr(article.source_url)}" target="_blank" rel="noopener noreferrer">Continue at ${esc(article.original_source)} <span aria-hidden="true">↗</span></a>
        </div>
        <a class="back-to-contents" href="#contents">Back to contents <span aria-hidden="true">↑</span></a>
      </div>
    </div>
  </article>`;
}

function colophon(issue, { latest = false, prefix = '..' } = {}) {
  const { totalMinutes, sourceCount } = issueFacts(issue);
  const pdfHref = latest ? issue.links.pdf : issue.links.pdf.replace(/^issues\//, '');
  const printHref = latest ? issue.links.print : issue.links.print.replace(/^issues\//, '');
  const permalinkHref = latest ? issue.links.web : issue.links.web.replace(/^issues\//, '');
  return `<footer class="site-footer">
    <div class="footer-top">
      <div class="footer-brand">
        <span class="footer-wordmark">Weekend <em>Reads</em></span>
        <p>${esc(CONFIG.siteTagline)}</p>
      </div>
      <div class="footer-issue">
        <p class="eyebrow">This edition</p>
        <p>Issue ${esc(issue.issue_number_display)} · <time datetime="${esc(issue.issue_date)}">${esc(issue.issue_date_long)}</time></p>
        <p>${issue.articles.length} stories · ${sourceCount} sources · ${totalMinutes} minutes of reading</p>
      </div>
      <div class="footer-links">
        <a href="${pdfHref}">Download the PDF</a>
        <a href="${printHref}">Print view</a>
        <a href="#top">Back to top ↑</a>
      </div>
    </div>
    <div class="footer-bottom">
      <p>All reporting and quotations remain the property of the original publishers. Weekend Reads publishes editorial summaries and links to the source. No article text is reproduced in full.</p>
      <p class="colophon-line">Edited with ${esc(issue.meta?.curation?.provider_label || 'the Weekend Reads desk')} · Generated ${esc(formatGeneratedAt(issue.meta?.generated_at))} · <a href="${permalinkHref}">Permalink</a></p>
    </div>
  </footer>`;
}

function formatGeneratedAt(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(date);
}

function articleJsonLd(issue) {
  return {
    '@context': 'https://schema.org',
    '@type': 'PublicationIssue',
    name: `${CONFIG.siteName} — Issue ${issue.issue_number_display}`,
    issueNumber: issue.issue_number,
    datePublished: issue.issue_date,
    description: issue.editor_note?.slice(0, 300) || '',
    isPartOf: {
      '@type': 'Periodical',
      name: CONFIG.siteName,
    },
    hasPart: issue.articles.map((article) => ({
      '@type': 'Article',
      headline: article.title,
      author: { '@type': 'Person', name: article.original_author },
      publisher: { '@type': 'Organization', name: article.original_source },
      url: article.source_url,
      datePublished: article.published_at,
    })),
  };
}

function renderIssuePage(issue, { latest = false, prefix = '..' } = {}) {
  const toolbarHtml = toolbar(issue, { latest });
  const title = `${CONFIG.siteName} · Issue ${issue.issue_number_display} · ${issue.issue_date_medium}`;
  const description = truncate(
    issue.editor_note || `${issue.articles.length} longform stories selected for ${issue.issue_date_long}.`,
    170,
  );

  const stories = issue.articles
    .map((article, index) => storySection(article, issue, index))
    .join('\n');

  const relatedLinks = issue.articles
    .slice(1, 4)
    .map(
      (article) =>
        `<a href="#${storyId(article)}"><span>${esc(article.category_short_name)}</span>${esc(article.title)}</a>`,
    )
    .join('');

  return `${head({
    title,
    description,
    prefix,
    canonicalPath: `issues/${issue.issue_date}.html`,
    type: 'article',
    jsonLd: articleJsonLd(issue),
    bodyClass: 'page-issue',
  })}
  ${siteHeader({ issue, prefix, latest, current: 'issue' })}
  <main id="main-content">
    ${coverSection(issue)}
    ${editorNote(issue)}
    ${toolbarHtml}
    ${contentsSection(issue)}
    <div class="story-list">
      ${stories}
    </div>
    <section class="issue-tail" aria-labelledby="issue-tail-title">
      <div>
        <p class="eyebrow">End note</p>
        <h2 id="issue-tail-title">That's the issue.</h2>
        <p>${issue.articles.length} stories, chosen for the weekend. If one stays with you, follow the link and read the original. The next edition will be assembled on Friday.</p>
      </div>
      <div class="issue-tail-links">
        <p class="rail-label">Keep reading</p>
        ${relatedLinks}
        <a class="issue-tail-archive" href="${prefix}/archive.html">Browse the archive <span aria-hidden="true">→</span></a>
      </div>
    </section>
  </main>
  ${colophon(issue, { latest, prefix })}
  <script src="${prefix}/app.js" defer></script>
</body>
</html>
`;
}

function archiveCard(issue, index) {
  const { featured } = issueFacts(issue);
  const counts = issue.meta?.counts || {};
  return `<article class="archive-card${index === 0 ? ' archive-card--latest' : ''}">
    <div class="archive-date-block">
      <span class="archive-month">${esc(new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(new Date(`${issue.issue_date}T12:00:00Z`)).toUpperCase())}</span>
      <span class="archive-day">${esc(issue.issue_date.slice(8, 10))}</span>
      <span class="archive-year">${esc(issue.issue_date.slice(0, 4))}</span>
    </div>
    <div class="archive-card-body">
      <p class="archive-kicker">Issue ${esc(issue.issue_number_display)} <span aria-hidden="true">·</span> ${esc(issue.weekday)} <span aria-hidden="true">·</span> ${esc(issue.volume)}</p>
      <h2><a href="issues/${esc(issue.issue_date)}.html">${esc(featured?.title || `Issue ${issue.issue_number_display}`)}</a></h2>
      <p class="archive-dek">${esc(truncate(featured?.dek || issue.editor_note || '', 190))}</p>
      <div class="archive-meta">
        <span>${counts.articles || issue.articles.length} stories</span>
        <span>${counts.total_reading_minutes || 0} min</span>
        <span>${counts.sources || 0} sources</span>
        <span>${esc(featured?.category_short_name || '')}</span>
      </div>
      <div class="archive-links">
        <a class="button button--small" href="issues/${esc(issue.issue_date)}.html">Read issue <span aria-hidden="true">→</span></a>
        <a class="text-link" href="issues/Issue-${esc(issue.issue_date)}.pdf" download>PDF ↓</a>
        <a class="text-link" href="issues/${esc(issue.issue_date)}-print.html">Print view</a>
      </div>
    </div>
    <div class="archive-number" aria-hidden="true">${esc(issue.issue_number_display)}</div>
  </article>`;
}

function renderArchivePage(issues, { latestIssue }) {
  const sorted = [...issues].sort((a, b) => b.issue_date.localeCompare(a.issue_date));
  const cards = sorted.map((issue, index) => archiveCard(issue, index)).join('\n');
  const title = `Archive · ${CONFIG.siteName}`;
  const description = `Every edition of ${CONFIG.siteName}, a weekly anthology of longform journalism.`;
  const latest = latestIssue || sorted[0];
  const totalStories = sorted.reduce((sum, issue) => sum + (issue.articles?.length || 0), 0);

  return `${head({
    title,
    description,
    prefix: '.',
    canonicalPath: 'archive.html',
    bodyClass: 'page-archive',
  })}
  ${siteHeader({ issue: latest, prefix: '.', latest: true, current: 'archive' })}
  <main id="main-content">
    <section class="archive-hero">
      <p class="eyebrow"><span class="eyebrow-line"></span> The archive</p>
      <div class="archive-hero-grid">
        <h1>Every issue,<br><em>kept.</em></h1>
        <div class="archive-hero-side">
          <p>${sorted.length} ${sorted.length === 1 ? 'edition' : 'editions'} · ${totalStories} stories. A slow library of longform journalism, assembled one weekend at a time.</p>
          ${latest ? `<a class="button button--solid" href="issues/${esc(latest.issue_date)}.html">Read the latest <span aria-hidden="true">→</span></a>` : ''}
        </div>
      </div>
    </section>
    <section class="archive-list" aria-label="Issues">
      ${cards || '<p class="archive-empty">The first issue is being assembled. Check back soon.</p>'}
    </section>
  </main>
  <footer class="site-footer site-footer--archive">
    <div class="footer-top">
      <div class="footer-brand"><span class="footer-wordmark">Weekend <em>Reads</em></span><p>${esc(CONFIG.siteTagline)}</p></div>
      <div class="footer-issue"><p class="eyebrow">Colophon</p><p>Built as a static magazine. Curated weekly from the open web.</p><p>All rights remain with original publishers.</p></div>
      <div class="footer-links"><a href="index.html">Latest issue</a><a href="#top">Back to top ↑</a></div>
    </div>
    <div class="footer-bottom"><p>Every edition is dated and archived. The PDF edition is typeset for A4 and ready to print.</p></div>
  </footer>
  <script src="app.js" defer></script>
</body>
</html>
`;
}

function printCover(issue) {
  const { featured } = issueFacts(issue);
  const coverLines = issue.articles
    .filter((article) => article !== featured)
    .slice(0, 4)
    .map(
      (article) =>
        `<li><span>${esc(article.category_short_name)}</span><strong>${esc(article.title)}</strong></li>`,
    )
    .join('');
  return `<section class="print-cover" data-issue="${esc(issue.issue_date)}">
    <div class="print-cover-art">${coverArt()}</div>
    <div class="print-cover-top">
      <span>Weekend Reads</span>
      <span>Vol. ${esc(issue.volume)} / No. ${esc(issue.issue_number_display)}</span>
    </div>
    <div class="print-cover-main">
      <p class="print-eyebrow">A weekly anthology of longform journalism</p>
      <h1 class="print-wordmark">Weekend <em>Reads</em></h1>
      <div class="print-cover-rule"></div>
      <p class="print-cover-label">Cover story · ${esc(featured?.category_name || '')}</p>
      <h2 class="print-cover-title">${esc(featured?.title || '')}</h2>
      <p class="print-cover-dek">${esc(featured?.dek || '')}</p>
      <p class="print-cover-byline">By ${esc(featured?.original_author || '')} · ${esc(featured?.original_source || '')}</p>
    </div>
    <div class="print-cover-bottom">
      <div class="print-issue-date">
        <span>Issue ${esc(issue.issue_number_display)}</span>
        <time datetime="${esc(issue.issue_date)}">${esc(issue.issue_date_long)}</time>
        <span>${esc(issue.season)}</span>
      </div>
      <ul class="print-cover-lines">${coverLines}</ul>
    </div>
  </section>`;
}

function printToc(issue) {
  const items = issue.articles
    .map(
      (article) =>
        `<li><a href="#${storyId(article)}"><span class="toc-num">${String(article.position).padStart(2, '0')}</span><span class="toc-cat">${esc(article.category_short_name)}</span><span class="toc-title">${esc(article.title)}</span><span class="toc-source">${esc(article.original_source)}</span></a></li>`,
    )
    .join('');
  return `<section class="print-toc">
    <header class="print-toc-header">
      <p class="print-eyebrow">Issue ${esc(issue.issue_number_display)} · <time datetime="${esc(issue.issue_date)}">${esc(issue.issue_date_long)}</time></p>
      <h2>Contents</h2>
      <p class="print-toc-dek">${esc(issue.articles.length)} stories · ${esc(issue.meta?.counts?.total_reading_minutes || 0)} minutes of reading</p>
    </header>
    <div class="print-toc-note">${renderMarkdown(issue.editor_note || '')}</div>
    <ol class="print-toc-list">${items}</ol>
    <p class="print-toc-foot">Every digest is an editorial summary. Follow the printed source link to read the original.</p>
  </section>`;
}

function printStory(article, issue, index) {
  return `<article class="print-story" id="${storyId(article)}" data-category="${esc(article.category)}">
    <header class="print-story-header">
      <div class="print-story-number">${String(article.position).padStart(2, '0')}</div>
      <div class="print-story-head">
        <p class="print-story-category"><span class="print-category-name">${esc(article.category_name)}</span> <span class="print-reading">· ${esc(article.reading_time_minutes)} min read</span></p>
        <h2>${esc(article.title)}</h2>
        <p class="print-story-dek">${esc(article.dek || '')}</p>
        <p class="print-story-byline">By ${esc(article.original_author)} · ${esc(article.original_source)} · <time datetime="${esc(article.published_at || issue.issue_date)}">${esc(publishedLabel(article, issue))}</time></p>
      </div>
    </header>
    <div class="print-story-summary">
      <p class="print-summary-label">The short version</p>
      <p>${esc(article.executive_summary)}</p>
    </div>
    <div class="print-story-body">
      ${
        article.key_quote
          ? `<blockquote class="print-pullquote"><p>“${esc(cleanQuote(article.key_quote))}”</p></blockquote>`
          : ''
      }
      ${renderMarkdown(article.digest_body)}
      <div class="print-takeaways">
        <p class="print-summary-label">Three things to know</p>
        <ol>${(article.key_takeaways || []).slice(0, 3).map((item) => `<li>${esc(item)}</li>`).join('')}</ol>
      </div>
      <p class="print-source">Original source: <strong>${esc(article.original_source)}</strong> — <span class="print-url">${esc(article.source_url)}</span></p>
    </div>
  </article>`;
}

function printColophon(issue) {
  const sources = issue.articles
    .map(
      (article) =>
        `<li><strong>${esc(article.title)}</strong> — ${esc(article.original_author)}, ${esc(article.original_source)}<br><span class="print-url">${esc(article.source_url)}</span></li>`,
    )
    .join('');
  return `<section class="print-colophon">
    <p class="print-eyebrow">Colophon</p>
    <h2>About this issue</h2>
    <p>Issue ${esc(issue.issue_number_display)} was edited for ${esc(issue.issue_date_long)} by the Weekend Reads desk. It gathers ${issue.articles.length} longform stories from ${issue.meta?.counts?.sources || 0} publications. Summaries are editorial digests, not replacements for the originals; all reporting and quotations remain with their publishers.</p>
    <p><strong>Editing:</strong> ${esc(issue.meta?.curation?.provider_label || 'Weekend Reads editorial desk')}. <strong>Generated:</strong> ${esc(formatGeneratedAt(issue.meta?.generated_at))}.</p>
    <h3>Sources in this issue</h3>
    <ol class="print-source-list">${sources}</ol>
    <p class="print-colophon-end">Weekend Reads · Issue ${esc(issue.issue_number_display)} · <time datetime="${esc(issue.issue_date)}">${esc(issue.issue_date_long)}</time> · End.</p>
  </section>`;
}

function renderPrintPage(issue) {
  const stories = issue.articles.map((article, index) => printStory(article, issue, index)).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(CONFIG.siteName)} — Issue ${esc(issue.issue_number_display)} — ${esc(issue.issue_date_long)} (Print)</title>
  <meta name="description" content="Print edition of ${esc(CONFIG.siteName)} issue ${esc(issue.issue_number_display)}, dated ${esc(issue.issue_date_long)}.">
  <link rel="icon" href="../favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="../print.css">
  <script>window.PagedConfig = { auto: false };</script>
  <script src="../vendor/paged.polyfill.js"></script>
</head>
<body class="print-body">
  <div class="print-magazine" id="magazine">
    ${printCover(issue)}
    ${printToc(issue)}
    ${stories}
    ${printColophon(issue)}
  </div>
  <script>
    (function () {
      window.__PAGED_READY_STATE__ = 'pending';
      window.__PAGED_PAGES__ = 0;
      window.__PAGED_ERROR__ = null;
      window.__PAGED_READY__ = (async function () {
        try {
          if (document.fonts && document.fonts.ready) await document.fonts.ready;
          if (!window.PagedPolyfill || typeof window.PagedPolyfill.preview !== 'function') {
            throw new Error('Paged.js failed to load.');
          }
          var flow = await window.PagedPolyfill.preview();
          window.__PAGED_PAGES__ = flow && flow.total ? flow.total : document.querySelectorAll('.pagedjs_page').length;
          window.__PAGED_READY_STATE__ = 'done';
          return window.__PAGED_PAGES__;
        } catch (error) {
          window.__PAGED_ERROR__ = String(error && error.message ? error.message : error);
          window.__PAGED_READY_STATE__ = 'error';
          return 0;
        }
      })();
    })();
  </script>
</body>
</html>
`;
}

function issueToSummary(issue) {
  const { featured } = issueFacts(issue);
  return {
    issue_date: issue.issue_date,
    issue_date_long: issue.issue_date_long,
    issue_number: issue.issue_number,
    issue_number_display: issue.issue_number_display,
    weekday: issue.weekday,
    volume: issue.volume,
    article_count: issue.articles.length,
    reading_minutes: issue.meta?.counts?.total_reading_minutes || 0,
    source_count: issue.meta?.counts?.sources || 0,
    cover_title: featured?.title || '',
    cover_category: featured?.category_name || '',
    url: `issues/${issue.issue_date}.html`,
    pdf: `issues/Issue-${issue.issue_date}.pdf`,
    print: `issues/${issue.issue_date}-print.html`,
    data: `issues/${issue.issue_date}.json`,
  };
}

function writeStaticSite({ issue, latestIssue, allIssues }) {
  ensureDir(CONFIG.publicIssuesDir);
  const issuesPath = path.join(CONFIG.publicIssuesDir, `${issue.issue_date}.html`);
  const printPath = path.join(CONFIG.publicIssuesDir, `${issue.issue_date}-print.html`);
  const dataPath = path.join(CONFIG.publicIssuesDir, `${issue.issue_date}.json`);
  const siteIssues = allIssues && allIssues.length ? allIssues : [issue];
  const latest = latestIssue || siteIssues[0] || issue;

  writeFile(issuesPath, renderIssuePage(issue, { latest: false, prefix: '..' }));
  writeFile(printPath, renderPrintPage(issue));
  writeJson(dataPath, issue);

  writeFile(
    path.join(CONFIG.publicDir, 'index.html'),
    renderIssuePage(latest, { latest: true, prefix: '.' }),
  );
  writeFile(path.join(CONFIG.publicDir, 'archive.html'), renderArchivePage(siteIssues, { latestIssue: latest }));

  const summaries = [...siteIssues]
    .sort((a, b) => b.issue_date.localeCompare(a.issue_date))
    .map(issueToSummary);
  writeJson(path.join(CONFIG.publicIssuesDir, 'index.json'), {
    generated_at: new Date().toISOString(),
    latest: summaries[0] || null,
    issues: summaries,
  });

  writeFile(
    path.join(CONFIG.publicIssuesDir, 'index.html'),
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Issues · Weekend Reads</title><meta http-equiv="refresh" content="0; url=../archive.html"><link rel="canonical" href="../archive.html"></head><body><p><a href="../archive.html">Browse the Weekend Reads archive</a>.</p></body></html>`,
  );

  writeFile(path.join(CONFIG.publicDir, '.nojekyll'), '');
  writeFile(
    path.join(CONFIG.publicDir, 'robots.txt'),
    `User-agent: *\nAllow: /\n${CONFIG.siteUrl ? `Sitemap: ${absoluteUrl('sitemap.xml')}\n` : ''}`,
  );

  if (CONFIG.siteUrl) {
    const urls = [
      '',
      'archive.html',
      ...siteIssues.map((item) => `issues/${item.issue_date}.html`),
    ];
    writeFile(
      path.join(CONFIG.publicDir, 'sitemap.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
        .map((url) => `  <url><loc>${esc(absoluteUrl(url))}</loc></url>`)
        .join('\n')}\n</urlset>\n`,
    );
  }

  return {
    issuePath: issuesPath,
    printPath,
    dataPath,
    indexPath: path.join(CONFIG.publicDir, 'index.html'),
    archivePath: path.join(CONFIG.publicDir, 'archive.html'),
  };
}

module.exports = {
  coverArt,
  formatGeneratedAt,
  renderArchivePage,
  renderIssuePage,
  renderPrintPage,
  storyId,
  writeStaticSite,
};

'use strict';

const { CATEGORY_ORDER, CONFIG } = require('./config');
const {
  countWords,
  formatLongDate,
  parseDateOnly,
  readingTimeMinutes,
  splitSentences,
  stripHtml,
  stripTrailingEllipsis,
  tidyProse,
  truncate,
} = require('./utils');

const STOPWORDS = new Set(
  `a about above after again against all also am an and any are aren't as at be because been before being below between both but by can can't cannot could couldn't did didn't do does doesn't doing don't down during each few for from further get got had hadn't has hasn't have haven't having he he'd he'll he's her here here's hers herself him himself his how how's however i i'd i'll i'm i've if in into is isn't it it's its itself just let's like make makes many may me might more most much must mustn't my myself new no nor not now of off on once one only or other ought our ours ourselves out over own same say says said she she'd she'll she's should shouldn't since so some such than that that's the their theirs them themselves then there there's these they they'd they'll they're they've this those though through to too under until up very was wasn't we we'd we'll we're we've were weren't what what's when when's where where's which while who who's whom why why's will with within without won't would wouldn't yet you you'd you'll you're you've your yours yourself yourselves also told according often still even back way two three first last long time year years people world one`.split(
    /\s+/,
  ),
);

const CONSEQUENCE_WORDS =
  /\b(because|therefore|means|suggests|reveals|shows|could|would|will|might|risk|future|consequence|important|matters|challenge|however|but|yet|instead|unless|if|despite)\b/i;

function cleanSentence(sentence) {
  return tidyProse(
    String(sentence)
      .replace(/^[\s\-–—•)\]}>»]+/, '')
      .replace(/\s+/g, ' '),
  );
}

function contentWords(text) {
  return (String(text).toLowerCase().match(/[a-z][a-z'’-]{2,}/g) || []).filter(
    (word) => !STOPWORDS.has(word) && word.length > 2,
  );
}

function sentenceData(text) {
  return splitSentences(stripHtml(text))
    .map(cleanSentence)
    .filter((sentence) => sentence.length >= 35 && sentence.length <= 420)
    .filter((sentence) => !/^(read more|listen|watch|sign up|subscribe|image|photo|credit)/i.test(sentence))
    .filter((sentence) => !/^\d{1,2},\s+\d{4}\b/.test(sentence))
    .filter(
      (sentence) =>
        !/^(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4}\b/i.test(
          sentence,
        ),
    )
    .map((sentence, index) => ({
      text: sentence,
      index,
      words: contentWords(sentence),
    }));
}

function scoreSentences(sentences, title = '') {
  const titleWords = new Set(contentWords(title));
  const documentFrequency = new Map();
  for (const sentence of sentences) {
    for (const word of new Set(sentence.words)) {
      documentFrequency.set(word, (documentFrequency.get(word) || 0) + 1);
    }
  }

  const total = Math.max(1, sentences.length);
  return sentences.map((sentence, index) => {
    const uniqueWords = [...new Set(sentence.words)];
    const frequencyScore =
      uniqueWords.reduce((sum, word) => {
        const df = documentFrequency.get(word) || 1;
        return sum + Math.log(1 + total / df);
      }, 0) / Math.sqrt(Math.max(6, sentence.words.length));

    const positionBonus =
      index === 0 ? 2.6 : index === 1 ? 2.1 : index === 2 ? 1.6 : index === 3 ? 1.1 : 0;
    const titleOverlap = uniqueWords.filter((word) => titleWords.has(word)).length * 0.35;
    const quoteBonus = /["“”]/.test(sentence.text) ? 0.45 : 0;
    const numberBonus = /\b(\d{1,3}(,\d{3})+|\d+%|\d{4})\b/.test(sentence.text) ? 0.35 : 0;
    const consequenceBonus = CONSEQUENCE_WORDS.test(sentence.text) ? 0.35 : 0;
    const length = sentence.text.split(/\s+/).length;
    const lengthPenalty = length < 10 ? 0.8 : length > 45 ? 0.45 : 0;

    return {
      ...sentence,
      score:
        frequencyScore +
        positionBonus +
        titleOverlap +
        quoteBonus +
        numberBonus +
        consequenceBonus -
        lengthPenalty,
    };
  });
}

function overlapRatio(a, b) {
  const setA = new Set(a);
  const setB = new Set(b);
  if (!setA.size || !setB.size) return 0;
  let intersection = 0;
  for (const word of setA) if (setB.has(word)) intersection += 1;
  return intersection / Math.min(setA.size, setB.size);
}

function selectSentences(ranked, count, { exclude = [], minIndex = 0, maxIndex = Infinity } = {}) {
  const chosen = [...exclude];
  const results = [];
  for (const sentence of ranked) {
    if (results.length >= count) break;
    if (sentence.index < minIndex || sentence.index > maxIndex) continue;
    if (chosen.some((existing) => existing.text === sentence.text)) continue;
    if (chosen.some((existing) => overlapRatio(existing.words, sentence.words) > 0.65)) continue;
    results.push(sentence);
    chosen.push(sentence);
  }
  return results;
}

function joinSentences(sentences, { maxWords = 160 } = {}) {
  const sorted = [...sentences].sort((a, b) => a.index - b.index);
  const parts = [];
  let words = 0;
  for (const sentence of sorted) {
    const sentenceWords = sentence.text.split(/\s+/).length;
    if (words + sentenceWords > maxWords && parts.length > 0) break;
    parts.push(stripTrailingEllipsis(sentence.text));
    words += sentenceWords;
  }
  return parts.join(' ');
}

function sentenceExcerpt(text, maxLength = 220) {
  const clean = tidyProse(stripTrailingEllipsis(text));
  if (clean.length <= maxLength) return clean;
  const sentences = splitSentences(clean).map((sentence) => tidyProse(sentence));
  const parts = [];
  let length = 0;
  for (const sentence of sentences) {
    if (!sentence) continue;
    if (parts.length && length + sentence.length + 1 > maxLength) break;
    parts.push(sentence);
    length += sentence.length + 1;
  }
  if (parts.length) return parts.join(' ');
  return truncate(clean, maxLength, { wordBoundary: true });
}

function makeTakeaway(sentence) {
  let text = tidyProse(stripTrailingEllipsis(sentence.text))
    .replace(/^(And|But|So|Yet|However|Still|Instead|Meanwhile|Indeed|Perhaps|Of course),?\s+/i, '')
    .replace(/\s+/g, ' ');
  if (text.length > 180) {
    const clauseCut = text.slice(0, 170).search(/[;—](?=[^;—]+$)/);
    text =
      clauseCut > 80
        ? `${text.slice(0, clauseCut).trim()}.`
        : truncate(text, 165, { wordBoundary: true });
  }
  if (!/[.!?][”’"']?$/.test(text) && !text.endsWith('…')) text += '.';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function isCitationSentence(text) {
  return (
    /\(\d{4}\)|\bdoi:|\bhttps?:\/\/|\bpp?\.\s*\d|\bet al\.|\b(?:eds?\.|ed\.)\b|\bUniversity Press\b|\bfirst edition\b/i.test(
      text,
    ) ||
    /^[A-Z][\w'’-]+,\s+[A-Z][\w'’-]+\s+\(\d{4}\)/.test(text)
  );
}

function isPromptSentence(text) {
  return /^(pick|choose|which of the following|test yourself|quiz|answer:|select one)\b/i.test(
    text,
  );
}

function hasBrokenQuotes(text) {
  const open = (text.match(/“/g) || []).length;
  const close = (text.match(/”/g) || []).length;
  if (open !== close) return true;
  if (((text.match(/"/g) || []).length) % 2 !== 0) return true;
  if (/”[ ]+[A-Z]/.test(text)) return true;
  if (/“[ ]+[A-Z]/.test(text)) return true;
  return false;
}

function isBioSentence(text) {
  return /\b(?:is|was)\s+(?:a|an|the)?\s*(?:(?:senior|resident|contributing|staff|associate|assistant|lead|chief|managing|editorial|research|visiting|adjunct)\s+)*(?:fellow|professor|writer|editor|reporter|correspondent|columnist|analyst|researcher|scholar|lecturer|director)\b/i.test(
    text,
  );
}

function isDisclosureSentence(text) {
  return /\b(?:do not|does not)\s+work for, consult, own shares\b|\breceive funding from any\b|\bno relevant affiliations\b|\bbeyond their academic appointment\b/i.test(
    text,
  );
}

function isMalformedSentence(text) {
  if (/\b([A-Z][a-z]+)\s+\d+(?:\.\d+)?%\s+\1\b/.test(text)) return true;
  if (/^[A-Z][a-z]+\s+\d+(?:\.\d+)?%\s+[A-Z][a-z]+\s+is\b/.test(text)) return true;
  return false;
}

function longestQuoteLength(text) {
  const matches = [...text.matchAll(/[“"]([^”"]{20,})[”"]/g)];
  return matches.reduce((max, match) => Math.max(max, match[1].length), 0);
}

function extractQuoteText(text) {
  const clean = tidyProse(text);
  const match = clean.match(/[“"]([^”"]{50,240})[”"]/);
  if (match) {
    const inner = match[1].trim().replace(/[,;:–—-]+$/, '').trim();
    if (inner.length >= 50) return inner;
  }
  return clean.replace(/^["“'‘]+|["”'’]+$/g, '').trim();
}

function sentenceIsUsable(sentence) {
  return (
    !isCitationSentence(sentence.text) &&
    !isPromptSentence(sentence.text) &&
    !isBioSentence(sentence.text) &&
    !isDisclosureSentence(sentence.text) &&
    !isMalformedSentence(sentence.text) &&
    !hasBrokenQuotes(sentence.text)
  );
}

function pickKeyQuote(ranked) {
  for (const sentence of ranked) {
    if (sentence.text.length < 60 || sentence.text.length > 300) continue;
    if (longestQuoteLength(sentence.text) < 50) continue;
    const quote = extractQuoteText(sentence.text);
    if (quote.length < 50 || quote.length > 240) continue;
    if (!/^[A-Z0-9“"']/.test(quote)) continue;
    if (/^(do|have|what|how|why|when|where|who|which|can|could|would|will|is|are)\b.*\?$/i.test(quote)) {
      continue;
    }
    return /[.!?…”’"]$/.test(quote) ? quote : `${quote}.`;
  }
  return '';
}

function buildDigest(ranked, summarySentences, used) {
  const selected = [...summarySentences];
  const total = ranked.length;
  const third = Math.max(1, Math.floor(total / 3));

  const story = selectSentences(ranked, 4, {
    exclude: selected,
    minIndex: 0,
    maxIndex: Math.max(3, third * 2),
  });
  selected.push(...story);

  const reporting = selectSentences(ranked, 5, {
    exclude: selected,
    minIndex: Math.max(0, Math.floor(total * 0.12)),
    maxIndex: Math.max(4, Math.floor(total * 0.82)),
  });
  selected.push(...reporting);

  const why = selectSentences(ranked, 4, {
    exclude: selected,
    minIndex: Math.max(2, Math.floor(total * 0.35)),
    maxIndex: total - 1,
  });
  selected.push(...why);

  const storyText = joinSentences(story, { maxWords: 170 });
  const reportingText = joinSentences(reporting, { maxWords: 225 });
  const whyText = joinSentences(why, { maxWords: 160 });

  const parts = [];
  if (storyText) parts.push(`### The story\n\n${storyText}`);
  if (reportingText) parts.push(`### What the reporting shows\n\n${reportingText}`);
  if (whyText) parts.push(`### Why it matters\n\n${whyText}`);

  if (used) {
    for (const sentence of selected) used.add(sentence.text);
  }

  if (parts.length === 0) {
    const fallback = joinSentences(selectSentences(ranked, 6), { maxWords: 260 });
    return fallback || '';
  }
  return parts.join('\n\n');
}

function buildLocalDigest(candidate) {
  const text = stripHtml(candidate.contentText || '');
  const sentences = sentenceData(text);
  const ranked = scoreSentences(sentences, candidate.title).sort((a, b) => b.score - a.score);

  const dekSentenceCount = sentences.length > 1 ? 2 : 1;
  const dekSentences = sentences.slice(0, dekSentenceCount);
  const dekTexts = new Set(dekSentences.map((sentence) => sentence.text));
  const dek = sentenceExcerpt(dekSentences.map((sentence) => sentence.text).join(' '), 220);

  // The dek already carries the opening sentences, so the digest starts after them.
  const rankedUsable = ranked
    .filter((sentence) => !dekTexts.has(sentence.text))
    .filter(sentenceIsUsable);
  const summaryCount = Math.min(4, Math.max(3, Math.ceil(sentences.length / 9)));
  const summarySentences = selectSentences(rankedUsable, summaryCount);
  const executiveSummary =
    joinSentences(summarySentences, { maxWords: 120 }) ||
    truncate(candidate.excerpt || candidate.contentText, 600);

  const takeawayPool = rankedUsable.filter(
    (sentence) => sentence.text.length >= 55 && sentence.text.length <= 175,
  );
  const longerTakeawayPool = rankedUsable.filter(
    (sentence) => sentence.text.length >= 55 && sentence.text.length <= 200,
  );
  const takeawaySentences = selectSentences(
    takeawayPool.length >= 3 ? takeawayPool : longerTakeawayPool,
    4,
    { exclude: summarySentences },
  );
  const keyTakeaways = takeawaySentences.slice(0, 3).map(makeTakeaway);
  while (keyTakeaways.length < 3) {
    keyTakeaways.push(
      makeTakeaway({
        text:
          keyTakeaways.length === 0
            ? `${candidate.title} is the featured story in ${candidate.categoryName}.`
            : `Read the full report at ${candidate.sourceName}.`,
      }),
    );
  }

  // Build the digest first so the pull quote can avoid repeating any sentence in it.
  const digestSentences = new Set(summarySentences.map((sentence) => sentence.text));
  const digestBody = buildDigest(rankedUsable, summarySentences, digestSentences);

  // Keep the pull quote distinct from the digest's opening sentences.
  const quotePool = rankedUsable.filter((sentence) => !digestSentences.has(sentence.text));
  const quoted = pickKeyQuote(quotePool) || pickKeyQuote(rankedUsable);
  const fallbackQuote =
    quotePool.find(
      (sentence) => sentence.text.length >= 50 && sentence.text.length <= 220,
    ) ||
    rankedUsable.find(
      (sentence) => sentence.text.length >= 50 && sentence.text.length <= 220,
    );
  const fallbackText = fallbackQuote
    ? tidyProse(fallbackQuote.text).replace(/^["“'‘]+|["”'’]+$/g, '').trim()
    : '';
  const quoteText = quoted || fallbackText;
  const keyQuote =
    quoteText.length > 240 ? truncate(quoteText, 220, { wordBoundary: true }) : quoteText;

  return {
    executive_summary: executiveSummary,
    key_takeaways: keyTakeaways,
    key_quote: keyQuote,
    digest_body: digestBody,
    dek,
  };
}

function candidateScore(candidate, issueDate) {
  const issueNoon = parseDateOnly(issueDate).getTime();
  const published = new Date(candidate.publishedAt || candidate.pubDate).getTime();
  const ageDays = Number.isNaN(published)
    ? 7
    : Math.max(0, Math.min(7, (issueNoon - published) / 86_400_000));
  const recency = (7 - ageDays) * 1.5;
  const length = Math.min(candidate.wordCount, 7000) / 1000;
  const lengthScore = Math.min(8, length * 1.4);
  const source = Number(candidate.sourceWeight || 1) * 8;
  const paragraphBonus = candidate.contentText.split(/\n{2,}/).length >= 8 ? 2 : 0;
  const numbersBonus = (candidate.contentText.match(/\b\d+(\.\d+)?%?\b/g) || []).length >= 5 ? 1 : 0;
  return source + recency + lengthScore + paragraphBonus + numbersBonus;
}

function selectOnePerCategory(candidates, issueDate) {
  const grouped = new Map();
  for (const candidate of candidates) {
    if (!grouped.has(candidate.category)) grouped.set(candidate.category, []);
    grouped.get(candidate.category).push(candidate);
  }

  const selected = [];
  for (const categoryId of CATEGORY_ORDER) {
    const pool = grouped.get(categoryId);
    if (!pool?.length) continue;
    const sorted = [...pool].sort(
      (a, b) => candidateScore(b, issueDate) - candidateScore(a, issueDate),
    );
    selected.push(sorted[0]);
  }
  return selected.slice(0, CONFIG.maxArticles);
}

function buildEditorNote({ articles, issueDate, issueNumber }) {
  if (!articles.length) {
    return 'This issue is being assembled. Please check back shortly.';
  }

  const cover = articles.find((article) => article.featured) || articles[0];
  const rest = articles.filter((article) => article !== cover);
  const categories = [
    ...new Set(rest.map((article) => article.category_short_name || article.category_name)),
  ];
  const categoryLine =
    categories.length > 1
      ? `${categories.slice(0, -1).join(', ')} and ${categories[categories.length - 1]}`
      : categories[0] || 'the week';

  return [
    `Issue ${String(issueNumber).padStart(2, '0')} arrives on ${formatLongDate(issueDate)}. The cover story is “${cover.title},” from ${cover.original_source}.`,
    `It sits alongside ${rest.length} pieces moving through ${categoryLine}. Each was chosen for reporting that rewards a slower read. There is no single thread running through the issue, except perhaps attention itself: the willingness to stay with a subject long enough to see its edges.`,
    `Every digest links back to the original publication. If a story stays with you, read it there.`,
  ].join('\n\n');
}

function buildLocalCuration({ candidates, issueDate, issueNumber }) {
  const selected = selectOnePerCategory(candidates, issueDate);
  if (!selected.length) {
    throw new Error('No eligible longform candidates were found for this issue.');
  }

  const digestById = new Map();
  for (const candidate of selected) {
    digestById.set(candidate.id, buildLocalDigest(candidate));
  }

  const featuredCandidate = [...selected].sort(
    (a, b) => candidateScore(b, issueDate) - candidateScore(a, issueDate),
  )[0];

  const articles = selected.map((candidate, index) => {
    const digest = digestById.get(candidate.id);
    return {
      id: candidate.id,
      category: candidate.category,
      category_name: candidate.categoryName,
      category_short_name: candidate.categoryShortName,
      title: candidate.title,
      dek: digest.dek,
      original_author: candidate.author || 'Staff',
      original_source: candidate.sourceName,
      source_url: candidate.link,
      published_at: candidate.publishedAt,
      reading_time_minutes:
        candidate.readingTimeMinutes ||
        readingTimeMinutes(candidate.wordCount, CONFIG.wordsPerMinute),
      word_count: candidate.wordCount,
      executive_summary: digest.executive_summary,
      key_takeaways: digest.key_takeaways,
      key_quote: digest.key_quote,
      digest_body: digest.digest_body,
      image_url: candidate.imageUrl || null,
      featured: candidate.id === featuredCandidate.id,
      position: 0,
      source_weight: candidate.sourceWeight,
      selection_score: Number(candidateScore(candidate, issueDate).toFixed(2)),
      local_order: index,
    };
  });

  const featured = articles.find((article) => article.featured);
  const ordered = featured
    ? [featured, ...articles.filter((article) => article !== featured)]
    : articles;
  ordered.forEach((article, index) => {
    article.position = index + 1;
  });

  return {
    articles: ordered,
    editor_note: buildEditorNote({ articles: ordered, issueDate, issueNumber }),
    provider: 'local:extractive',
    model: 'weekend-reads-editorial-engine',
    fallback_chain: [],
  };
}

module.exports = {
  buildLocalCuration,
  buildLocalDigest,
  buildEditorNote,
  candidateScore,
  contentWords,
  scoreSentences,
  sentenceData,
  selectOnePerCategory,
};

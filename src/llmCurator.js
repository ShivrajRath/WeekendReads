'use strict';

const { CATEGORY_ORDER, CONFIG } = require('./config');
const { buildLocalCuration, buildLocalDigest, candidateScore } = require('./localCurator');
const {
  formatLongDate,
  normalizeInline,
  readingTimeMinutes,
  safeJsonParse,
  safeUrl,
  truncate,
} = require('./utils');

const SYSTEM_INSTRUCTION = `You are the managing editor of Weekend Reads, a discerning weekly magazine of longform journalism.
Your job is to choose the strongest piece for each section and write a concise, faithful editorial digest.
You work only from the supplied candidates. Never invent facts, quotations, URLs, authors, or publications.
Write with clarity and restraint: a sharp magazine editor, not a marketing copywriter. Avoid clichés, throat-clearing and generic AI phrasing.
Every digest must be grounded in the supplied article text and must link the reader back to the original source.`;

function log(message) {
  console.log(`[curator] ${message}`);
}

function promptPayload(candidates, issueDate) {
  const byCategory = new Map();
  for (const candidate of candidates) {
    if (!byCategory.has(candidate.category)) byCategory.set(candidate.category, []);
    byCategory.get(candidate.category).push(candidate);
  }

  const sections = [];
  let globalIndex = 0;
  for (const categoryId of CATEGORY_ORDER) {
    const pool = (byCategory.get(categoryId) || [])
      .sort((a, b) => candidateScore(b, issueDate) - candidateScore(a, issueDate))
      .slice(0, 3);
    if (!pool.length) continue;

    const categoryName = pool[0].categoryName;
    const items = pool.map((candidate) => {
      const index = globalIndex++;
      return {
        index,
        title: candidate.title,
        source: candidate.sourceName,
        author: candidate.author,
        published: candidate.publishedAt,
        words: candidate.wordCount,
        url: candidate.link,
        excerpt: normalizeInline(candidate.excerpt || candidate.contentText).slice(0, 300),
        body_excerpt: normalizeInline(candidate.contentText).slice(0, 1500),
      };
    });
    sections.push({ category: categoryId, category_name: categoryName, candidates: items });
  }
  return sections;
}

function buildPrompt({ candidates, issueDate, issueNumber }) {
  const sections = promptPayload(candidates, issueDate);
  const candidateText = sections
    .map((section) => {
      const items = section.candidates
        .map(
          (candidate) =>
            [
              `  [Candidate ${candidate.index}]`,
              `  Title: ${candidate.title}`,
              `  Publication: ${candidate.source}`,
              `  Author: ${candidate.author}`,
              `  Published: ${candidate.published}`,
              `  Length: ${candidate.words} words`,
              `  URL: ${candidate.url}`,
              `  Excerpt: ${candidate.excerpt}`,
              `  Article text excerpt: ${candidate.body_excerpt}`,
            ].join('\n'),
        )
        .join('\n\n');
      return `SECTION: ${section.category_name} (category id: ${section.category})\n\n${items}`;
    })
    .join('\n\n---\n\n');

  return `Assemble Issue ${String(issueNumber).padStart(2, '0')} of Weekend Reads for ${formatLongDate(issueDate)}.

TASK
1. Choose at most one article for each section below. Use only the numbered candidates provided.
2. Select no more than 10 articles in total. Prefer articles with genuine reporting depth, specificity, and lasting interest. Avoid wire copy, listicles, celebrity gossip and thin news briefs.
3. Write the issue's editor's note (90–140 words) introducing the selection without summarising every piece.
4. For each selected article, write:
   - executive_summary: 120–160 words, faithful to the reporting, no new claims.
   - key_takeaways: exactly 3 bullets, each under 22 words, concrete and distinct.
   - key_quote: a short direct quotation of no more than 35 words from the supplied text, or a memorable sentence from the article clearly marked as paraphrase if no quote is available.
   - digest_body: 400–550 words of Markdown, with exactly three subheadings: "### The story", "### What the reporting shows", "### Why it matters". Specific, vivid, measured. Do not use first person. Do not refer to "the article" repeatedly.
5. Keep the original headline, author, publication and URL exactly as supplied. Do not rewrite the headline.
6. Output valid JSON only. No code fences, no commentary.

JSON SCHEMA
{
  "issue_date": "${issueDate}",
  "issue_number": ${Number(issueNumber)},
  "editor_note": "string",
  "articles": [
    {
      "candidate_index": 0,
      "category": "category id",
      "title": "exact supplied title",
      "original_author": "string",
      "original_source": "string",
      "source_url": "exact supplied URL",
      "executive_summary": "string",
      "key_takeaways": ["string", "string", "string"],
      "key_quote": "string",
      "digest_body": "string"
    }
  ]
}

CANDIDATES

${candidateText}`;
}

function timeoutSignal(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

async function requestGemini({ apiKey, model, prompt, timeoutMs }) {
  const { GoogleGenAI } = require('@google/genai');
  const ai = new GoogleGenAI({ apiKey });
  const { signal, clear } = timeoutSignal(timeoutMs);
  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.6,
        topP: 0.9,
        maxOutputTokens: 16000,
        responseMimeType: 'application/json',
        abortSignal: signal,
      },
    });
    const text = response.text;
    if (!text || !text.trim()) {
      throw new Error(`Empty response (finish reason: ${response.candidates?.[0]?.finishReason || 'unknown'})`);
    }
    return text;
  } finally {
    clear();
  }
}

async function requestGroq({ apiKey, model, prompt, timeoutMs }) {
  const Groq = require('groq-sdk');
  const groq = new Groq({ apiKey, timeout: timeoutMs, maxRetries: 0 });
  const { signal, clear } = timeoutSignal(timeoutMs);
  try {
    const response = await groq.chat.completions.create(
      {
        model,
        messages: [
          { role: 'system', content: SYSTEM_INSTRUCTION },
          { role: 'user', content: prompt },
        ],
        temperature: 0.6,
        max_tokens: 8000,
        response_format: { type: 'json_object' },
      },
      { signal },
    );
    const text = response.choices?.[0]?.message?.content;
    if (!text || !text.trim()) throw new Error('Empty response from Groq.');
    return text;
  } finally {
    clear();
  }
}

function normaliseList(value, fallback = []) {
  if (Array.isArray(value)) {
    const items = value
      .map((item) => normalizeInline(String(item || '')))
      .filter(Boolean)
      .slice(0, 5);
    if (items.length) return items;
  }
  return fallback;
}

function mapLLMResponse(response, candidates, { issueDate, issueNumber }) {
  const candidatePool = candidates.slice();
  const byIndex = new Map(candidatePool.map((candidate, index) => [index, candidate]));
  const byUrl = new Map(candidatePool.map((candidate) => [candidate.link, candidate]));
  const byTitle = new Map(
    candidatePool.map((candidate) => [candidate.title.toLowerCase().slice(0, 100), candidate]),
  );

  const used = new Set();
  const articles = [];

  for (const raw of Array.isArray(response.articles) ? response.articles : []) {
    if (articles.length >= CONFIG.maxArticles) break;

    let candidate = null;
    const suppliedUrl = safeUrl(raw.source_url || '');
    if (Number.isInteger(raw.candidate_index) && byIndex.has(raw.candidate_index)) {
      candidate = byIndex.get(raw.candidate_index);
    }
    if (!candidate && suppliedUrl && byUrl.has(suppliedUrl)) {
      candidate = byUrl.get(suppliedUrl);
    }
    if (!candidate && raw.title) {
      candidate = byTitle.get(String(raw.title).toLowerCase().trim().slice(0, 100));
    }
    if (!candidate || used.has(candidate.id)) continue;

    const local = buildLocalDigest(candidate);
    const category = CATEGORY_ORDER.includes(candidate.category)
      ? candidate.category
      : CATEGORY_ORDER.includes(raw.category)
        ? raw.category
        : candidate.category;

    const executiveSummary = normalizeInline(raw.executive_summary || '');
    const digestBody = String(raw.digest_body || '').trim();
    const keyQuote = normalizeInline(raw.key_quote || '');
    const takeaways = normaliseList(raw.key_takeaways, local.key_takeaways);

    const article = {
      id: candidate.id,
      category,
      category_name: candidate.categoryName,
      category_short_name: candidate.categoryShortName,
      title: candidate.title,
      dek: local.dek,
      original_author: candidate.author || 'Staff',
      original_source: candidate.sourceName,
      source_url: candidate.link,
      published_at: candidate.publishedAt,
      reading_time_minutes:
        candidate.readingTimeMinutes || readingTimeMinutes(candidate.wordCount, CONFIG.wordsPerMinute),
      word_count: candidate.wordCount,
      executive_summary:
        executiveSummary.split(/\s+/).length >= 45
          ? executiveSummary
          : local.executive_summary,
      key_takeaways: takeaways.length >= 3 ? takeaways.slice(0, 3) : local.key_takeaways,
      key_quote: keyQuote.length >= 12 ? keyQuote : local.key_quote,
      digest_body:
        digestBody.split(/\s+/).length >= 150 ? digestBody : local.digest_body,
      image_url: candidate.imageUrl || null,
      featured: false,
      position: 0,
      source_weight: candidate.sourceWeight,
      selection_score: Number(candidateScore(candidate, issueDate).toFixed(2)),
    };

    if (!articles.some((existing) => existing.category === category)) {
      articles.push(article);
      used.add(candidate.id);
    }
  }

  // Backfill any missing sections with the local editor's choice.
  const available = candidates.filter(
    (candidate) => !used.has(candidate.id) && !articles.some((article) => article.category === candidate.category),
  );
  if (available.length && articles.length < CONFIG.maxArticles) {
    const local = buildLocalCuration({
      candidates: available,
      issueDate,
      issueNumber,
    });
    for (const article of local.articles) {
      if (articles.length >= CONFIG.maxArticles) break;
      if (articles.some((existing) => existing.category === article.category)) continue;
      articles.push(article);
    }
  }

  if (!articles.length) throw new Error('The model returned no usable articles.');

  articles.forEach((article) => {
    article.featured = false;
  });
  const featured = [...articles].sort(
    (a, b) => b.selection_score - a.selection_score,
  )[0];
  featured.featured = true;
  const ordered = [featured, ...articles.filter((article) => article !== featured)];
  ordered.forEach((article, index) => {
    article.position = index + 1;
  });

  const localNote = buildLocalCuration({
    candidates,
    issueDate,
    issueNumber,
  }).editor_note;
  const editorNote = normalizeInline(response.editor_note || '');
  const finalEditorNote =
    editorNote.split(/\s+/).length >= 60 ? String(response.editor_note).trim() : localNote;

  return {
    articles: ordered,
    editor_note: finalEditorNote,
  };
}

async function curateWithLLM({ candidates, issueDate, issueNumber }) {
  if (!CONFIG.useLLM) {
    return { curation: null, fallbackChain: [], reason: 'LLM use disabled by USE_LLM=false.' };
  }

  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  const fallbackChain = [];

  if (!geminiKey && !groqKey) {
    return {
      curation: null,
      fallbackChain,
      reason: 'No GEMINI_API_KEY, GOOGLE_API_KEY or GROQ_API_KEY configured.',
    };
  }

  const prompt = buildPrompt({ candidates, issueDate, issueNumber });

  if (geminiKey) {
    for (const model of CONFIG.geminiModels) {
      const started = Date.now();
      try {
        log(`Trying Gemini model ${model}…`);
        const text = await requestGemini({
          apiKey: geminiKey,
          model,
          prompt,
          timeoutMs: CONFIG.llmTimeoutMs,
        });
        const parsed = safeJsonParse(text);
        const curation = mapLLMResponse(parsed, candidates, { issueDate, issueNumber });
        fallbackChain.push({
          provider: 'gemini',
          model,
          status: 'success',
          duration_ms: Date.now() - started,
        });
        log(`Gemini ${model} succeeded (${curation.articles.length} articles).`);
        return {
          curation: {
            ...curation,
            provider: `gemini:${model}`,
            model,
            fallback_chain: fallbackChain,
          },
          fallbackChain,
          reason: null,
        };
      } catch (error) {
        const message = error.name === 'AbortError' ? 'Request timed out.' : error.message;
        fallbackChain.push({
          provider: 'gemini',
          model,
          status: 'failed',
          error: truncate(message, 240),
          duration_ms: Date.now() - started,
        });
        log(`Gemini ${model} failed: ${truncate(message, 160)}`);
      }
    }
  }

  if (groqKey) {
    const started = Date.now();
    try {
      log(`Trying Groq model ${CONFIG.groqModel}…`);
      const text = await requestGroq({
        apiKey: groqKey,
        model: CONFIG.groqModel,
        prompt,
        timeoutMs: CONFIG.llmTimeoutMs,
      });
      const parsed = safeJsonParse(text);
      const curation = mapLLMResponse(parsed, candidates, { issueDate, issueNumber });
      fallbackChain.push({
        provider: 'groq',
        model: CONFIG.groqModel,
        status: 'success',
        duration_ms: Date.now() - started,
      });
      log(`Groq ${CONFIG.groqModel} succeeded (${curation.articles.length} articles).`);
      return {
        curation: {
          ...curation,
          provider: `groq:${CONFIG.groqModel}`,
          model: CONFIG.groqModel,
          fallback_chain: fallbackChain,
        },
        fallbackChain,
        reason: null,
      };
    } catch (error) {
      const message = error.name === 'AbortError' ? 'Request timed out.' : error.message;
      fallbackChain.push({
        provider: 'groq',
        model: CONFIG.groqModel,
        status: 'failed',
        error: truncate(message, 240),
        duration_ms: Date.now() - started,
      });
      log(`Groq failed: ${truncate(message, 160)}`);
    }
  }

  return {
    curation: null,
    fallbackChain,
    reason: 'All configured model providers failed; using the local editorial engine.',
  };
}

module.exports = {
  buildPrompt,
  curateWithLLM,
  mapLLMResponse,
  promptPayload,
  requestGemini,
  requestGroq,
};

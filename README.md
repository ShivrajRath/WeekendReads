# Weekend Reads

An automated weekly editorial magazine. Every Friday, Weekend Reads scans a curated set of longform RSS feeds, chooses up to ten pieces across ten sections, writes an editorial digest for each, and publishes two editions:

- a responsive **web magazine**;
- a dated, paginated **A4 print edition** and downloadable PDF.

Each edition is dated, numbered, archived and permanently addressable.

The current edition lives at [`public/index.html`](public/index.html). Dated editions live at `public/issues/YYYY-MM-DD.html`, with the matching PDF at `public/issues/Issue-YYYY-MM-DD.pdf`.

---

## How it works

```text
data/sources.json
       │
       ▼
RSS/Atom ingestion ── 7-day window ── 1,000+ words ── dedupe
       │
       ▼
Candidate extraction (Readability + jsdom)
       │
       ▼
Curation cascade
  1. Gemini model cascade
  2. Groq fallback
  3. Local extractive editorial engine
       │
       ▼
One story per section, maximum ten
       │
       ├── data/issues/YYYY-MM-DD.json      archived source of truth
       ├── public/issues/YYYY-MM-DD.html    dated web edition
       ├── public/issues/YYYY-MM-DD.json    public issue data
       ├── public/index.html                latest edition
       ├── public/archive.html              every dated edition
       ├── public/issues/YYYY-MM-DD-print.html
       └── public/issues/Issue-YYYY-MM-DD.pdf
```

The generator is deliberately fail-safe. Missing API keys, a rate-limited model, a dead feed or a paywalled article never stops the issue: the pipeline degrades to the next provider and, ultimately, to the deterministic local editorial engine.

### The ten sections

| Section | Category id | Purpose |
| --- | --- | --- |
| Politics | `politics` | Power, institutions and public decisions |
| India Focus | `india` | Reporting and argument from India |
| Science & Nature | `science` | Discovery, evidence and the natural world |
| Emerging Technology | `technology` | The systems remaking how we live |
| Global Affairs & Geopolitics | `global` | Borders, alliances and the world order |
| Philosophy & Ideas | `ideas` | Essays that test assumptions |
| Business & Economics | `business` | Markets, work and the economy |
| Society & Culture | `culture` | Art, books, film and contemporary life |
| Climate & Environment | `climate` | Science and politics of the planet |
| Longform Deep Dives | `longform` | Narrative reporting with room to breathe |

At most one article is selected per section, and no more than ten articles are published.

---

## Requirements

- Node.js **20 or newer**
- npm
- Google Chrome or Chromium for PDF generation
  - On Linux the generator checks `/usr/bin/google-chrome`, `/usr/bin/google-chrome-stable`, `/usr/bin/chromium`, `/usr/bin/chromium-browser` and `/snap/bin/chromium`.
  - On macOS it checks the standard application paths.
  - You can also set `PUPPETEER_EXECUTABLE_PATH`.
- Optional: a Gemini API key and/or a Groq API key for model-written digests.

Puppeteer is configured not to download its own Chromium (`.puppeteerrc.cjs`); the generator uses the system browser. This keeps installs lean and works in CI.

---

## Quick start

```bash
git clone <your-repository-url> WeekendReads
cd WeekendReads
npm install
cp .env.example .env       # optional: add API keys
npm run dev                # preview at http://localhost:4173
```

Generate today's issue, including the PDF:

```bash
npm run generate
```

Generate without a PDF:

```bash
npm run generate:no-pdf
```

Force the local editorial engine, even if API keys exist:

```bash
node src/index.js --local --refresh
```

Choose a date and refresh an existing edition:

```bash
node src/index.js --date=2026-11-13 --refresh
```

### CLI options

| Option | Meaning |
| --- | --- |
| `--date=YYYY-MM-DD` | Issue date to generate. Defaults to the local date. |
| `--refresh` | Regenerate even if that date already exists. |
| `--local` | Skip Gemini/Groq and use the local editorial engine. |
| `--no-pdf` | Generate web and print HTML, but skip Puppeteer. |
| `--help` | Print usage. |

Future dates are rejected. Existing dates are re-rendered without refetching unless `--refresh` is supplied.

---

## Configuration

Copy `.env.example` to `.env`. All values are optional.

| Variable | Default | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | — | Enables the Gemini model cascade. |
| `GOOGLE_API_KEY` | — | Alternative Gemini key name. |
| `GROQ_API_KEY` | — | Enables the Groq fallback. |
| `GEMINI_MODELS` | `gemini-2.5-flash,gemini-2.5-pro,gemini-1.5-pro` | Ordered Gemini cascade. |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | Groq model. |
| `USE_LLM` | `true` | Set `false` to force local curation. |
| `MIN_WORDS` | `1000` | Minimum extracted word count. |
| `WINDOW_DAYS` | `7` | Publication window ending on the issue date. |
| `MAX_ARTICLES` | `10` | Hard cap on stories per issue. |
| `ENRICH_PER_CATEGORY` | `24` | Feed entries considered per section before extraction. |
| `CANDIDATES_PER_CATEGORY` | `4` | Accepted longform candidates per section. |
| `WORDS_PER_MINUTE` | `220` | Reading-time calculation. |
| `FEED_CONCURRENCY` | `8` | Parallel feed requests. |
| `FEED_RETRIES` | `2` | Retries per feed request. |
| `REQUEST_TIMEOUT_MS` | `20000` | Per-request timeout. |
| `LLM_TIMEOUT_MS` | `120000` | Per-model timeout. |
| `SITE_URL` | — | Canonical public URL for metadata and sitemap generation. |
| `PUPPETEER_EXECUTABLE_PATH` | auto-detect | Chrome/Chromium binary. |
| `PORT` | `4173` | Local preview server port. |

### Enabling AI curation

Add at least one key to `.env` or to the repository secrets:

```bash
GEMINI_API_KEY=...
GROQ_API_KEY=...
```

The cascade is:

1. each model in `GEMINI_MODELS`, in order;
2. `GROQ_MODEL`;
3. the local extractive engine.

Every attempted provider is recorded in `meta.curation.fallback_chain` in the issue JSON and shown in the colophon. Model output is validated against the supplied candidate set: unknown URLs, duplicate stories and invented candidates are discarded, missing sections are backfilled locally, and model prose is only accepted when it meets minimum length thresholds.

### Enabling the local engine

The local engine is deterministic and needs no network beyond the feeds:

```bash
node src/index.js --local
# or
USE_LLM=false node src/index.js
```

It ranks sentences with a TF-IDF-style scorer, selects a coherent extractive summary, writes three takeaways, pulls a quote, and builds a three-part digest. It is intentionally conservative: it never invents facts and links every piece back to its publisher.

---

## Dated issues and the archive

Issue identity is derived from the issue date:

- issue JSON: `data/issues/2026-11-13.json`
- public JSON: `public/issues/2026-11-13.json`
- web edition: `public/issues/2026-11-13.html`
- print edition: `public/issues/2026-11-13-print.html`
- PDF: `public/issues/Issue-2026-11-13.pdf`
- archive entry: `public/archive.html`
- issue index: `public/issues/index.json`

The newest issue is also rendered at `public/index.html`. Issue numbers are assigned from the existing dated archive, and the volume is derived from the year (Volume I begins in 2026). The date appears in the masthead, cover stamp, editor's note, page footers, archive entry, PDF metadata and release title.

---

## Print edition

The print view uses Paged.js and CSS Paged Media:

- A4 page size and editorial margins;
- a dated cover page;
- a contents page with live `target-counter()` page numbers;
- two-column article text with widow/orphan control;
- running section headers and issue-date footers;
- `NN / NN` page numbering;
- a colophon with the full source list.

Puppeteer loads the print page, waits for Paged.js to finish composing, then writes the PDF with backgrounds enabled. If Paged.js fails or times out, the generator falls back to Chrome's native CSS pagination rather than failing the run.

```bash
npm run generate
pdfinfo public/issues/Issue-YYYY-MM-DD.pdf
```

---

## Editing sources

Sources live in [`data/sources.json`](data/sources.json). Each category has a `feeds` array:

```json
{
  "name": "Example Review",
  "url": "https://example.com/feed.xml",
  "weight": 1.15
}
```

- `name` is the publication name shown in the issue.
- `url` must be an HTTP(S) RSS or Atom feed.
- `weight` biases selection: higher values are preferred when scores are close.

Add as many feeds per category as you like. The generator tolerates failures and will report unsuccessful feeds in the issue metadata. Prefer feeds with full article bodies or at least a usable excerpt; the extractor follows article links when a feed entry is shorter than `MIN_WORDS`.

To change section names or order, edit `data/sources.json` and the `CATEGORY_ORDER` array in [`src/config.js`](src/config.js).

---

## GitHub Actions

The workflow is [`.github/workflows/generate_magazine.yml`](.github/workflows/generate_magazine.yml). It runs:

- every **Friday at 04:00 UTC** (`0 4 * * 5`);
- on demand via **Actions → Generate weekly issue → Run workflow**, with an optional date.

It performs the following:

1. checks out the repository and installs Node 20 with npm caching;
2. installs dependencies and Chrome;
3. runs the generator for the requested date (today in UTC by default);
4. verifies the JSON, web, print and PDF files;
5. commits the dated data, web pages, archive and PDF back to the branch;
6. deploys `public/` to GitHub Pages;
7. creates a dated GitHub Release tagged `issue-YYYY-MM-DD` with the PDF attached.

### Repository setup

1. Push the repository to GitHub with the workflow on the default branch.
2. In **Settings → Pages**, set **Source** to **GitHub Actions**.
3. In **Settings → Secrets and variables → Actions**, add any of:
   - `GEMINI_API_KEY`
   - `GOOGLE_API_KEY`
   - `GROQ_API_KEY`
4. Optionally add repository **variables**:
   - `SITE_URL` — e.g. `https://your-user.github.io/WeekendReads`
   - `GEMINI_MODELS`, `GROQ_MODEL`, `MIN_WORDS`, `WINDOW_DAYS`, `ENRICH_PER_CATEGORY`
5. If your default branch is not `main`, update the workflow's push target or rely on `GITHUB_REF_NAME` (it already uses the triggering branch).

The workflow requests `contents: write`, `pages: write` and `id-token: write`. If branch protection blocks bot commits, allow the workflow token to bypass protection or switch the commit step to a pull request.

Without API keys the scheduled build still succeeds using the local editorial engine, so the weekly publication never goes dark.

---

## Project layout

```text
.github/workflows/generate_magazine.yml   weekly build, Pages deploy, release
data/sources.json                         curated feeds and section metadata
data/issues/YYYY-MM-DD.json               archived issue source of truth
public/index.html                         latest web edition
public/archive.html                       dated archive
public/issues/                            dated web, print, JSON and PDF files
public/styles.css                         screen edition
public/print.css                          A4 / Paged.js edition
public/app.js                             filters, layout, theme, progress
src/index.js                              CLI orchestrator
src/config.js                             paths, categories, environment
src/feedFetcher.js                        RSS ingestion and article extraction
src/llmCurator.js                         Gemini/Groq cascade and validation
src/localCurator.js                       deterministic fallback editor
src/issueBuilder.js                       dated issue assembly and numbering
src/renderEngine.js                       web, archive and print renderers
src/pdfGenerator.js                       Puppeteer PDF generation
src/server.js                             local static preview server
src/utils.js                              dates, HTML safety, Markdown, helpers
test/                                     unit tests (node:test)
scripts/prepare-assets.js                 vendors Paged.js after install
```

---

## Tests

```bash
npm test
```

The test suite covers:

- date formatting, week boundaries, seasons and issue numbering;
- HTML escaping and the small Markdown renderer (including XSS payloads);
- headline and excerpt cleanup;
- the 7-day window and editorial blocklist;
- one-article-per-section local curation;
- issue assembly, metadata and link paths;
- LLM response validation, dedupe and local backfill.

Tests are offline and do not call model providers or publisher websites.

---

## Troubleshooting

**No Chrome found for PDF generation**
Install Google Chrome or Chromium, or set `PUPPETEER_EXECUTABLE_PATH=/path/to/chrome`. You can still build the web edition with `npm run generate:no-pdf`.

**No eligible candidates**
Feeds may be stale, blocked or temporarily unavailable. Lower `MIN_WORDS`, widen `WINDOW_DAYS`, add more feeds, or retry later. The feed summary in the log reports how many feeds and entries were scanned.

**Paged.js takes a long time**
Large issues with ten long digests can take a while to compose. The generator waits up to three minutes, then falls back to Chrome's pagination. Check the print view directly to confirm page breaks.

**A model provider is rate-limited**
That is expected; the cascade moves to the next Gemini model, then Groq, then the local engine. The fallback chain is recorded in the issue JSON.

**Fonts do not load in the PDF**
The local WOFF2 files in `public/fonts/` are loaded with `file://` URLs. Make sure they exist and that Chrome can read the repository path. Run `npm run build:assets` if Paged.js or the fonts are missing after a fresh install.

**CSS parsing warnings during ingestion**
`jsdom` can print harmless CSS parser warnings from publisher pages. They do not affect extraction or the generated issue.

---

## Content rights

Weekend Reads publishes original editorial summaries of, and links to, reporting by other publications. Headlines, quotations and reporting remain the property of their original publishers. The generator does not reproduce full articles. Always link readers back to the source, respect paywalls and terms of use, and remove a feed if a publisher requests it.

## Licence

Application code is provided for use and adaptation by the repository owner. Bundled typefaces are licensed under the SIL Open Font License; their licence files are in `public/fonts/`. Paged.js is distributed under its own MIT licence.

# Ticker Desk

Turns press releases into broadcast-style news tickers (**10 words or fewer**) for a Malayalam news channel. An editor adds announcements, reviews each ticker beside its source, edits, reorders, approves, and exports the approved set as JSON.

Announcements and tickers can be **English or Malayalam**. By default the ticker is in the same language as the announcement; a selector forces Malayalam or English.

## Run it

```bash
npm install
cp .env.example .env.local     # then paste your free key into GEMINI_API_KEY
npm run dev                    # http://localhost:3000
```

Free API key (no billing): <https://aistudio.google.com/apikey>.
Check the current free model name in AI Studio and set `GEMINI_MODEL` if needed (see `.env.example`).

No key yet? Set `MOCK_LLM=1` in `.env.local` to try the interface with a fake model (it just takes the first 8 words, so it is **not** a real summariser).

Deploy: push to GitHub, import into Vercel (free Hobby plan), and add `GEMINI_API_KEY` (and optionally `GEMINI_MODEL`) as environment variables.

## How to use it

1. **Add announcements**: one at a time, or many at once (paste; separate with a blank line, or with `---` lines to keep multi-paragraph releases together), or upload a `.txt` file. A live count shows how many were detected.
2. **Tickers generate automatically** and appear beside their source.
3. **Review**: edit the wording (live `n/10` word counter), drag rows or use ↑/↓ to reorder, regenerate, delete (with undo), approve.
4. **Export**: *Export N approved (JSON)* downloads only the approved tickers in your running order, or *Copy JSON*.

Work is saved in the browser (`localStorage`), so a refresh loses nothing.

## How tickers stay faithful

A single clever prompt is not enough, so there are four layers:

1. **Strict prompt**: use only what is written; never add numbers, names, dates, causes or consequences; keep hedges ("alleged", "reportedly") and tense; vague stays vague. The announcement is wrapped as *data*, so instructions hidden inside it are ignored.
2. **Extract, then compress**: the model must first list the facts it relies on (`facts_used`), then write the ticker. The editor can see that list.
3. **Code checks (no AI)**: the 10-word limit is enforced in code, and every number in the ticker must appear in the source. This understands Malayalam digits (൦–൯), Indian grouping (`1,20,000`), spelled-out numbers ("three", "മൂന്ന്") and scale words (crore/കോടി, lakh/ലക്ഷം).
4. **A second AI call fact-checks** the ticker against the source (changed certainty, wrong attribution, invented cause, any unsupported claim).

If a layer fails, the model retries (up to 3 attempts) with specific feedback. If it still fails, the ticker is **kept but flagged** with a warning badge and a plain-language reason. It is never silently passed. A ticker over 10 words cannot be approved until shortened. Edits by the editor are re-checked live (word limit and numbers); editing an approved ticker returns it to "needs review".

## Free-tier handling

Free Gemini quotas are small. Requests run 2 at a time; on a rate-limit response the whole queue pauses, shows a notice, backs off (exponentially, max 60 s) and resumes by itself. Nothing is lost.

## Export format

```json
{
  "schema_version": "1.0",
  "exported_at": "2026-10-28T10:30:00.000Z",
  "total_approved": 1,
  "tickers": [
    {
      "position": 1,
      "id": "…",
      "text": "New Periyar bridge to be built at Aluva",
      "language": "en",
      "word_count": 8,
      "edited_by_editor": false,
      "source": { "announcement_id": "…", "text": "…full announcement…", "language": "en" }
    }
  ]
}
```

Approved items only, in review order, positions 1..n. The payload is validated against a schema (`lib/export.ts`) before download. Malayalam is written as real characters, UTF-8.

## Tests

```bash
npm test        # 36 fast tests, no network: splitting, language, word count, number checks, retry loop, review rules, export
npm run eval    # LIVE: runs fixtures/tricky.ts (13 tempting announcements) through the real model; uses free quota
```

`npm run eval` needs a real key (it won't work with `MOCK_LLM=1`).

## Code map

| Path | What |
|---|---|
| `lib/text.ts` | normalising, splitting, language detection, word count |
| `lib/checks.ts` | deterministic number / length checks |
| `lib/prompts.ts` | the prompts (the part to tune) |
| `lib/llm.ts` | `Llm` interface, Gemini client, mock |
| `lib/pipeline.ts` | generate → check → verify → retry |
| `app/api/generate/route.ts` | one announcement per request |
| `lib/state.ts` | review-workflow reducer (edit/approve/reorder/undo) |
| `lib/useSession.ts` | persistence + client queue with backoff |
| `lib/export.ts` | export schema and builder |
| `components/` | `InputPanel`, `TickerRow`, `Toolbar` |

## Known limits

- Name checking across languages is best-effort: when a Malayalam ticker is written from an English release, names are transliterated, so string matching can't verify them. The AI fact-check covers it, but it is not perfect. The editor has the final say.
- Numbers are never converted: "1 crore" is not treated as "10 million". The prompt says never to convert, and the check flags it if the model does.
- Free-tier model names and limits change; confirm them in AI Studio.
- Word count is whitespace-separated tokens; `₹5 കോടി` counts as 2.
- Not built: CSV/JSON import, CSV export, a backup model provider, response caching.

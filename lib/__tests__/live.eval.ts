/**
 * LIVE evaluation: runs the tricky fixtures through the real Gemini model.
 * Needs GEMINI_API_KEY in .env.local. Uses free-tier quota, so it is NOT part
 * of `npm test`. Run with `npm run eval`.
 */
import { appendFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FIXTURES } from "../../fixtures/tricky";
import { llmFromEnv, RateLimitError } from "../llm";
import { runPipeline } from "../pipeline";
import { countWords, detectLanguage } from "../text";
import { GenerateResponse } from "../types";

const llm = llmFromEnv();
const RESULTS = "eval-results.md";
writeFileSync(RESULTS, `# Live evaluation results (${new Date().toISOString()})\n\n`);

async function generate(source: string, targetLang?: "ml" | "en"): Promise<GenerateResponse> {
  const sourceLang = detectLanguage(source);
  for (let attempt = 0; ; attempt++) {
    try {
      return await runPipeline(llm, { source, sourceLang, targetLang: targetLang ?? sourceLang });
    } catch (e) {
      if (e instanceof RateLimitError && attempt < 5) {
        await new Promise((r) => setTimeout(r, e.retryAfterMs + 1000));
        continue;
      }
      throw e;
    }
  }
}

describe("tricky fixtures (live model)", () => {
  // EVAL_REPEAT=5 runs every selected fixture 5 times: model output varies between runs.
  const repeat = Number(process.env.EVAL_REPEAT ?? 1);
  for (const f of FIXTURES.flatMap((f) => Array.from({ length: repeat }, (_, i) => ({ ...f, name: repeat > 1 ? `${f.name} #${i + 1}` : f.name })))) {
    it(f.name, async () => {
      const r = await generate(f.source, f.targetLang);
      // Always saved to a file: vitest hides console output for passing tests.
      appendFileSync(
        RESULTS,
        `## ${f.name}\n- Source: ${f.source}\n- Ticker: **${r.ticker}** (${countWords(r.ticker)} words, ${r.attempts} attempt${r.attempts > 1 ? "s" : ""})\n- Warnings: ${r.warnings.join(", ") || "none"}\n\n`,
      );
      expect(countWords(r.ticker)).toBeLessThanOrEqual(10);
      expect(r.warnings).toEqual([]);
      for (const p of f.forbid ?? []) expect(r.ticker).not.toMatch(p);
      for (const p of f.require ?? []) expect(r.ticker).toMatch(p);
    });
  }
});

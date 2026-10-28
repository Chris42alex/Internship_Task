import { checkTicker, deterministicWarnings, hardProblems } from "./checks";
import { Llm, RateLimitError } from "./llm";
import { cleanTicker } from "./text";
import { GenerateResponse, Lang, Warning } from "./types";

type Attempt = {
  ticker: string;
  factsUsed: string[];
  warnings: Warning[];
  notes: string[];
  problems: string[];
  /** Lower is better; used to pick the best attempt if none passes. */
  score: number;
};

/**
 * generate -> deterministic checks -> LLM verifier -> retry with feedback.
 * Never returns a "silent pass": if no attempt is clean, the least-bad one
 * comes back with warnings so the editor decides.
 */
export async function runPipeline(
  llm: Llm,
  p: { source: string; sourceLang: Lang; targetLang: Lang },
  maxAttempts = 3,
): Promise<GenerateResponse> {
  const attempts: Attempt[] = [];
  let previous: { ticker: string; problems: string[] } | undefined;

  for (let i = 0; i < maxAttempts; i++) {
    const gen = await llm.generate({ ...p, previous });
    const ticker = cleanTicker(gen.ticker);

    if (!ticker) {
      previous = { ticker: "", problems: ["The ticker was empty. Write one."] };
      continue;
    }

    const chk = checkTicker(p.source, ticker);
    const hard = hardProblems(chk);

    if (hard.length) {
      const d = deterministicWarnings(p.source, ticker);
      attempts.push({
        ticker,
        factsUsed: gen.factsUsed,
        warnings: d.warnings,
        notes: d.notes,
        problems: hard,
        score: (chk.overLimit ? 1 : 0) + chk.numbersMissing.length * 2 + chk.scalesMissing.length * 2,
      });
      previous = { ticker, problems: hard };
      continue;
    }

    let verdict: { supported: boolean; unsupportedClaims: string[] };
    try {
      verdict = await llm.verify({
        source: p.source,
        ticker,
        suspectNames: chk.suspectNames,
        hedgeDropped: chk.hedgeDropped,
      });
    } catch (e) {
      if (e instanceof RateLimitError) throw e;
      // Verifier unavailable: hand back the ticker, honestly marked as unchecked.
      return {
        ticker,
        factsUsed: gen.factsUsed,
        warnings: ["unverified"],
        notes: ["Fact-check step failed; review against the source."],
        attempts: i + 1,
      };
    }

    if (verdict.supported) {
      return { ticker, factsUsed: gen.factsUsed, warnings: [], notes: [], attempts: i + 1 };
    }

    const problems = verdict.unsupportedClaims.map((c) => `Unsupported claim, remove it: ${c}`);
    attempts.push({
      ticker,
      factsUsed: gen.factsUsed,
      warnings: ["unsupported_claim"],
      notes: verdict.unsupportedClaims.map((c) => `Possibly unsupported: ${c}`),
      problems,
      score: 3 * Math.max(1, verdict.unsupportedClaims.length),
    });
    previous = { ticker, problems };
  }

  if (!attempts.length) throw new Error("The model returned an empty ticker every time.");

  // Least-bad attempt; on a tie prefer the latest (it saw the most feedback).
  const best = attempts.reduce((a, b) => (b.score <= a.score ? b : a));
  return {
    ticker: best.ticker,
    factsUsed: best.factsUsed,
    warnings: best.warnings,
    notes: best.notes,
    attempts: maxAttempts,
  };
}

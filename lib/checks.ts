import { countWords } from "./text";
import { MAX_WORDS, Warning } from "./types";

/** Deterministic, LLM-free guards against invented numbers and over-long tickers. */

const ML_DIGIT_BASE = 0x0d66;

function toAsciiDigits(s: string): string {
  return s.replace(/[൦-൯]/g, (d) => String(d.codePointAt(0)! - ML_DIGIT_BASE));
}

const EN_NUMBER_WORDS: Record<string, string> = {
  one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7",
  eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12", thirteen: "13",
  fourteen: "14", fifteen: "15", sixteen: "16", seventeen: "17", eighteen: "18",
  nineteen: "19", twenty: "20", thirty: "30", forty: "40", fifty: "50",
  sixty: "60", seventy: "70", eighty: "80", ninety: "90", hundred: "100",
};

// Exact surface forms only. Prefix matching would turn "പത്തനംതിട്ട"
// (Pathanamthitta) into the number ten.
const ML_NUMBER_WORDS: Record<string, string> = {
  "ഒന്ന്": "1", "ഒന്നു": "1",
  "രണ്ട്": "2", "രണ്ടു": "2",
  "മൂന്ന്": "3", "മൂന്നു": "3",
  "നാല്": "4", "നാലു": "4",
  "അഞ്ച്": "5", "അഞ്ചു": "5",
  "ആറ്": "6", "ആറു": "6",
  "ഏഴ്": "7", "ഏഴു": "7",
  "എട്ട്": "8", "എട്ടു": "8",
  "ഒമ്പത്": "9", "ഒൻപത്": "9", "ഒമ്പതു": "9", "ഒൻപതു": "9",
  "പത്ത്": "10", "പത്തു": "10",
  "നൂറ്": "100", "നൂറു": "100",
};

const SCALE_WORDS: Record<string, string> = {
  crore: "crore", crores: "crore", "കോടി": "crore",
  lakh: "lakh", lakhs: "lakh", "ലക്ഷം": "lakh",
  thousand: "thousand", "ആയിരം": "thousand",
  million: "million", "മില്യൺ": "million",
  billion: "billion", "ബില്യൺ": "billion",
};

function normNumber(raw: string): string {
  const n = Number(raw);
  return Number.isFinite(n) ? String(n) : raw;
}

type Extracted = { numbers: Set<string>; scales: Set<string> };

/**
 * Pulls every numeric claim out of a text: digits (Western or Malayalam,
 * with Indian/Western grouping), spelled-out numbers, and scale words.
 * `includeBareOne` is false for tickers: "one"/"ഒന്ന്" is often just an article.
 */
export function extractNumeric(text: string, includeBareOne: boolean): Extracted {
  const t = toAsciiDigits(text.normalize("NFC")).toLowerCase();
  const numbers = new Set<string>();
  const scales = new Set<string>();

  const digitText = t.replace(/(?<=\d),(?=\d)/g, "");
  for (const m of digitText.matchAll(/\d+(?:\.\d+)?/g)) numbers.add(normNumber(m[0]));

  for (const w of t.match(/[\p{L}\p{M}]+/gu) ?? []) {
    const n = EN_NUMBER_WORDS[w] ?? ML_NUMBER_WORDS[w];
    if (n && (includeBareOne || n !== "1")) numbers.add(n);
    const s = SCALE_WORDS[w];
    if (s) scales.add(s);
  }
  return { numbers, scales };
}

const ACRONYM_OR_CAPITAL = /^[A-Z][A-Za-z]+$/;

/**
 * Latin-script capitalised words in the ticker (not sentence-initial) that
 * never occur in the source. A soft signal only: abbreviations like "Govt"
 * would false-positive, so it is handed to the verifier instead of failing hard.
 */
export function findSuspectNames(source: string, ticker: string): string[] {
  const src = source.toLowerCase();
  const words = ticker.split(/\s+/).slice(1);
  const out: string[] = [];
  for (const raw of words) {
    const w = raw.replace(/[^\p{L}]/gu, "");
    if (w.length < 3 || !ACRONYM_OR_CAPITAL.test(w)) continue;
    if (!src.includes(w.toLowerCase())) out.push(w);
  }
  return out;
}

// English hedges are whole words; Malayalam is agglutinative, so these are
// substrings: സാധ്യത (possibility/chance), ആരോപ (allege/allegation), സംശയ
// (suspect/suspicion), പ്രതീക്ഷ (expect), -യേക്കും/-യേക്കാം/-ഏക്കും/-ഏക്കാം (may).
const HEDGE_EN = /\b(alleg\w*|reportedly|may|might|could|likely|unlikely|expected|expects?|possible|possibly|possibility|chance|probable|probably|suspected|proposed|rumou?red|feared)\b/i;
const HEDGE_ML = /സാധ്യത|ആരോപ|സംശയ|പ്രതീക്ഷ|യേക്കും|യേക്കാം|ഏക്കും|ഏക്കാം/;

const hasHedge = (s: string) => HEDGE_EN.test(s) || HEDGE_ML.test(s);

/**
 * True when the source hedges ("chance of", "alleged", "may") but the ticker
 * carries no hedge at all, a sign certainty was upgraded. Soft signal only:
 * a ticker may drop the hedged fact entirely, so it is sent to the verifier
 * as a hint rather than failing the ticker.
 */
export function hedgeDropped(source: string, ticker: string): boolean {
  return hasHedge(source) && !hasHedge(ticker);
}

export type CheckResult = {
  wordCount: number;
  overLimit: boolean;
  numbersMissing: string[];
  scalesMissing: string[];
  suspectNames: string[];
  hedgeDropped: boolean;
};

export function checkTicker(source: string, ticker: string): CheckResult {
  const wordCount = countWords(ticker);
  const src = extractNumeric(source, true);
  const tk = extractNumeric(ticker, false);
  return {
    wordCount,
    overLimit: wordCount > MAX_WORDS,
    numbersMissing: [...tk.numbers].filter((n) => !src.numbers.has(n)),
    scalesMissing: [...tk.scales].filter((s) => !src.scales.has(s)),
    suspectNames: findSuspectNames(source, ticker),
    hedgeDropped: hedgeDropped(source, ticker),
  };
}

/** Problems that make a ticker unacceptable without needing an LLM opinion. */
export function hardProblems(r: CheckResult): string[] {
  const p: string[] = [];
  if (r.overLimit) p.push(`The ticker has ${r.wordCount} words; the maximum is ${MAX_WORDS}. Shorten it.`);
  if (r.numbersMissing.length)
    p.push(`These numbers are not in the source and must be removed: ${r.numbersMissing.join(", ")}.`);
  if (r.scalesMissing.length)
    p.push(`These quantity words are not in the source and must be removed: ${r.scalesMissing.join(", ")}.`);
  return p;
}

/** Warnings + readable notes for a piece of text, using only deterministic checks. */
export function deterministicWarnings(source: string, ticker: string): { warnings: Warning[]; notes: string[] } {
  const r = checkTicker(source, ticker);
  const warnings: Warning[] = [];
  const notes: string[] = [];
  if (r.overLimit) {
    warnings.push("over_limit");
    notes.push(`${r.wordCount} words — limit is ${MAX_WORDS}.`);
  }
  if (r.numbersMissing.length || r.scalesMissing.length) {
    warnings.push("number_not_in_source");
    notes.push(`Not in source: ${[...r.numbersMissing, ...r.scalesMissing].join(", ")}.`);
  }
  return { warnings, notes };
}

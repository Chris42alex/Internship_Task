import { Lang, MAX_ANNOUNCEMENT_CHARS } from "./types";

/**
 * NFC-normalise (Malayalam has several equivalent encodings of the same
 * glyph), unify newlines, and trim. Zero-width joiners (U+200C/U+200D) are
 * deliberately kept: Malayalam chillu letters and conjuncts depend on them.
 */
export function normalizeText(s: string): string {
  return s.normalize("NFC").replace(/\r\n?/g, "\n").trim();
}

/** Whitespace-delimited word count. Deliberately strict: "₹5 കോടി" is 2 words. */
export function countWords(s: string): number {
  const t = s.trim();
  return t === "" ? 0 : t.split(/\s+/).length;
}

/** "ml" when Malayalam script makes up >30% of the letters, otherwise "en". */
export function detectLanguage(s: string): Lang {
  let letters = 0;
  let malayalam = 0;
  for (const ch of s) {
    if (/\p{L}/u.test(ch)) {
      letters++;
      const cp = ch.codePointAt(0)!;
      if (cp >= 0x0d00 && cp <= 0x0d7f) malayalam++;
    }
  }
  return letters > 0 && malayalam / letters > 0.3 ? "ml" : "en";
}

export type SplitResult = {
  items: string[];
  duplicates: number;
  tooLong: number;
};

const DIVIDER = /^\s*-{3,}\s*$/;

/**
 * Splits bulk input into announcements.
 * - If the text contains `---` divider lines, ONLY those split it, so a
 *   multi-paragraph press release can stay in one piece.
 * - Otherwise a blank line separates announcements.
 */
export function splitAnnouncements(raw: string): SplitResult {
  const text = normalizeText(raw);
  const lines = text.split("\n");
  const hasDivider = lines.some((l) => DIVIDER.test(l));

  const blocks: string[] = [];
  let current: string[] = [];
  const flush = () => {
    const block = current.join("\n").trim();
    if (block) blocks.push(block);
    current = [];
  };

  for (const line of lines) {
    if (hasDivider ? DIVIDER.test(line) : line.trim() === "") flush();
    else current.push(line);
  }
  flush();

  const seen = new Set<string>();
  const items: string[] = [];
  let duplicates = 0;
  let tooLong = 0;
  for (const b of blocks) {
    if (b.length > MAX_ANNOUNCEMENT_CHARS) {
      tooLong++;
      continue;
    }
    if (seen.has(b)) {
      duplicates++;
      continue;
    }
    seen.add(b);
    items.push(b);
  }
  return { items, duplicates, tooLong };
}

/** Tidy model output: strip wrapping quotes, collapse whitespace, drop final full stop. */
export function cleanTicker(s: string): string {
  return s
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .replace(/[.\s]+$/, "")
    .trim();
}

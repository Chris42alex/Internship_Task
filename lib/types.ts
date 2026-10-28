export const MAX_WORDS = 10;
export const MAX_ANNOUNCEMENTS = 50;
export const MAX_ANNOUNCEMENT_CHARS = 3000;

export type Lang = "ml" | "en";
export type OutputLang = "auto" | Lang;

export type Warning =
  | "over_limit"
  | "number_not_in_source"
  | "unsupported_claim"
  | "unverified"
  | "generation_failed";

export type TickerStatus = "queued" | "generating" | "ready" | "approved" | "error";

export type Announcement = {
  id: string;
  text: string;
  language: Lang;
  addedAt: string;
};

export type TickerItem = {
  id: string;
  announcementId: string;
  targetLang: Lang;
  /** Original model output, kept for the diff / revert. */
  generatedText: string;
  /** Current, possibly edited, text. */
  text: string;
  status: TickerStatus;
  warnings: Warning[];
  factsUsed: string[];
  /** Plain-language reasons shown next to the warning badges. */
  notes: string[];
  /** Warnings/notes of the model output, restored by "Revert to generated". */
  genWarnings: Warning[];
  genNotes: string[];
  errorMessage?: string;
};

export type Session = {
  announcements: Announcement[];
  /** Array order is the running order. */
  tickers: TickerItem[];
  outputLang: OutputLang;
};

/** Response of POST /api/generate */
export type GenerateResponse = {
  ticker: string;
  factsUsed: string[];
  warnings: Warning[];
  notes: string[];
  attempts: number;
};

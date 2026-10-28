import { z } from "zod";
import { countWords } from "./text";
import { MAX_WORDS, Session } from "./types";

export const SCHEMA_VERSION = "1.0";

/** The contract for downstream systems. The export is validated against it before download. */
export const ExportSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  exported_at: z.string(),
  total_approved: z.number().int().nonnegative(),
  tickers: z.array(
    z.object({
      position: z.number().int().positive(),
      id: z.string(),
      text: z.string().min(1),
      language: z.enum(["ml", "en"]),
      word_count: z.number().int().min(1).max(MAX_WORDS),
      edited_by_editor: z.boolean(),
      source: z.object({
        announcement_id: z.string(),
        text: z.string(),
        language: z.enum(["ml", "en"]),
      }),
    }),
  ),
});
export type ExportPayload = z.infer<typeof ExportSchema>;

/** Approved tickers only, in the editor's running order, positions 1..n. */
export function buildExport(session: Session, now = new Date()): ExportPayload {
  const byId = new Map(session.announcements.map((a) => [a.id, a]));
  const tickers = session.tickers
    .filter((t) => t.status === "approved")
    .flatMap((t) => {
      const src = byId.get(t.announcementId);
      return src ? [{ t, src }] : [];
    })
    .map(({ t, src }, i) => ({
      position: i + 1,
      id: t.id,
      text: t.text.trim(),
      language: t.targetLang,
      word_count: countWords(t.text),
      edited_by_editor: t.text !== t.generatedText,
      source: { announcement_id: src.id, text: src.text, language: src.language },
    }));

  return ExportSchema.parse({
    schema_version: SCHEMA_VERSION,
    exported_at: now.toISOString(),
    total_approved: tickers.length,
    tickers,
  });
}

export function exportJson(session: Session, now = new Date()): string {
  return JSON.stringify(buildExport(session, now), null, 2);
}

export function exportFilename(now = new Date()): string {
  return `tickers-${now.toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`;
}

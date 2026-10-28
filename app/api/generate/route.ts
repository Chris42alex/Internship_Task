import { z } from "zod";
import { RateLimitError, llmFromEnv } from "@/lib/llm";
import { runPipeline } from "@/lib/pipeline";
import { detectLanguage, normalizeText } from "@/lib/text";
import { MAX_ANNOUNCEMENT_CHARS } from "@/lib/types";

// One announcement per request keeps each call well inside serverless time
// limits; the browser queues the batch (see lib/queue.ts).
export const maxDuration = 60;

const Body = z.object({
  source: z.string().min(1).max(MAX_ANNOUNCEMENT_CHARS * 2),
  targetLang: z.enum(["ml", "en"]).optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request body." }, { status: 400 });

  const source = normalizeText(parsed.data.source);
  if (!source) return Response.json({ error: "Announcement is empty." }, { status: 400 });
  if (source.length > MAX_ANNOUNCEMENT_CHARS)
    return Response.json({ error: `Announcement is longer than ${MAX_ANNOUNCEMENT_CHARS} characters.` }, { status: 400 });

  const sourceLang = detectLanguage(source);
  const targetLang = parsed.data.targetLang ?? sourceLang;

  try {
    const result = await runPipeline(llmFromEnv(), { source, sourceLang, targetLang });
    return Response.json(result);
  } catch (e) {
    if (e instanceof RateLimitError) {
      return Response.json(
        { error: "The free AI quota is busy. Retrying shortly.", retryAfterMs: e.retryAfterMs },
        { status: 429, headers: { "Retry-After": String(Math.ceil(e.retryAfterMs / 1000)) } },
      );
    }
    const message = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}

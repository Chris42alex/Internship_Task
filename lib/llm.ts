import { z } from "zod";
import { GENERATE_SYSTEM, VERIFY_SYSTEM, generateUser, verifyUser } from "./prompts";
import { Lang } from "./types";

/**
 * The only seam between the app and a model provider. The pipeline talks to
 * this interface, so Gemini can be swapped (e.g. for Groq) or faked in tests.
 */
export interface Llm {
  generate(a: {
    source: string;
    sourceLang: Lang;
    targetLang: Lang;
    previous?: { ticker: string; problems: string[] };
  }): Promise<{ ticker: string; factsUsed: string[] }>;
  verify(a: {
    source: string;
    ticker: string;
    suspectNames: string[];
    hedgeDropped: boolean;
  }): Promise<{ supported: boolean; unsupportedClaims: string[] }>;
}

export class RateLimitError extends Error {
  constructor(public retryAfterMs: number) {
    super("Rate limit reached");
  }
}

const GenerateOut = z.object({
  facts_used: z.array(z.string()).default([]),
  ticker: z.string(),
  omitted_for_length: z.array(z.string()).optional(),
});
const VerifyOut = z.object({
  ticker_in_english: z.string().optional(),
  unsupported_claims: z.array(z.string()).default([]),
  supported: z.boolean(),
});

const GENERATE_SCHEMA = {
  type: "OBJECT",
  properties: {
    facts_used: { type: "ARRAY", items: { type: "STRING" } },
    ticker: { type: "STRING" },
    omitted_for_length: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["facts_used", "ticker"],
  propertyOrdering: ["facts_used", "ticker", "omitted_for_length"],
};
const VERIFY_SCHEMA = {
  type: "OBJECT",
  properties: {
    // Translate first, judge second: a changed certainty is hard to see across languages.
    ticker_in_english: { type: "STRING" },
    unsupported_claims: { type: "ARRAY", items: { type: "STRING" } },
    supported: { type: "BOOLEAN" },
  },
  required: ["ticker_in_english", "unsupported_claims", "supported"],
  propertyOrdering: ["ticker_in_english", "unsupported_claims", "supported"],
};

const SAFETY = [
  "HARM_CATEGORY_HARASSMENT",
  "HARM_CATEGORY_HATE_SPEECH",
  "HARM_CATEGORY_SEXUALLY_EXPLICIT",
  "HARM_CATEGORY_DANGEROUS_CONTENT",
].map((category) => ({ category, threshold: "BLOCK_ONLY_HIGH" }));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Models that recently ran out of quota are skipped until this time (ms since epoch). */
const cooldownUntil = new Map<string, number>();

/**
 * `models` is tried in order. Free-tier quotas are per model, so when the
 * first is out of quota or overloaded, the next one keeps the desk working.
 */
export function geminiLlm(apiKey: string, models: string[], temperature = 0): Llm {
  type Outcome =
    | { kind: "ok"; data: unknown }
    | { kind: "limited"; retryAfterMs: number; daily: boolean }
    | { kind: "unavailable"; message: string }
    | { kind: "fatal"; message: string };

  async function callModel(model: string, body: string): Promise<Outcome> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    let res: Response | undefined;
    // 500/503 ("high demand") are usually brief: retry with backoff.
    for (let i = 0; i < 3; i++) {
      res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body,
      });
      if (res.status !== 500 && res.status !== 503) break;
      await sleep(1000 * 2 ** i);
    }
    if (!res) return { kind: "unavailable", message: "No response from model" };

    if (res.status === 429) {
      const text = await res.text();
      const hdr = Number(res.headers.get("retry-after"));
      const m = /"retryDelay":\s*"(\d+)/.exec(text);
      const secs = hdr > 0 ? hdr : m ? Number(m[1]) : 15;
      return { kind: "limited", retryAfterMs: Math.min(secs, 60) * 1000, daily: /PerDay/i.test(text) };
    }
    if (res.status === 404) return { kind: "unavailable", message: `Model "${model}" was not found. Check GEMINI_MODEL in Google AI Studio.` };
    if (res.status === 401 || res.status === 403) {
      // Show Google's own reason ("reported as leaked", "API key not valid", "location not supported"...).
      const reason = /"message":\s*"([^"]+)"/.exec(await res.text())?.[1];
      return { kind: "fatal", message: `Gemini rejected the request${reason ? `: ${reason}` : "."} Check GEMINI_API_KEY.` };
    }
    if (res.status === 500 || res.status === 503) return { kind: "unavailable", message: `${model} is overloaded right now.` };
    if (!res.ok) {
      const text = await res.text();
      return { kind: "fatal", message: `Gemini error ${res.status}: ${text.slice(0, 300)}` };
    }

    const data = await res.json();
    const out = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof out !== "string") {
      const reason = data?.promptFeedback?.blockReason ?? data?.candidates?.[0]?.finishReason ?? "empty response";
      return { kind: "fatal", message: `Model returned no text (${reason})` };
    }
    return { kind: "ok", data: JSON.parse(out) };
  }

  async function call(system: string, user: string, schema: object): Promise<unknown> {
    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: {
        temperature,
        responseMimeType: "application/json",
        responseSchema: schema,
      },
      safetySettings: SAFETY,
    });

    let shortestWait = Infinity; // per-minute limits: worth waiting for
    let sawDaily = false;
    let lastMessage = "";
    for (const model of models) {
      if ((cooldownUntil.get(model) ?? 0) > Date.now()) {
        shortestWait = Math.min(shortestWait, cooldownUntil.get(model)! - Date.now());
        continue;
      }
      const r = await callModel(model, body);
      if (r.kind === "ok") return r.data;
      if (r.kind === "fatal") throw new Error(r.message);
      if (r.kind === "unavailable") {
        lastMessage = r.message;
        cooldownUntil.set(model, Date.now() + 15_000);
        continue;
      }
      // Rate limited: remember it so the next request skips straight to another model.
      sawDaily ||= r.daily;
      if (!r.daily) shortestWait = Math.min(shortestWait, r.retryAfterMs);
      cooldownUntil.set(model, Date.now() + (r.daily ? 10 * 60_000 : r.retryAfterMs));
    }

    if (Number.isFinite(shortestWait)) throw new RateLimitError(Math.max(shortestWait, 1000));
    if (sawDaily) throw new Error("The free daily quota is used up for the configured models. Try again later, or add another model to GEMINI_FALLBACK_MODEL.");
    throw new Error(lastMessage || "No model available.");
  }

  return {
    async generate(a) {
      const o = GenerateOut.parse(await call(GENERATE_SYSTEM, generateUser(a), GENERATE_SCHEMA));
      return { ticker: o.ticker, factsUsed: o.facts_used };
    },
    async verify(a) {
      const o = VerifyOut.parse(await call(VERIFY_SYSTEM, verifyUser(a), VERIFY_SCHEMA));
      return { supported: o.supported && o.unsupported_claims.length === 0, unsupportedClaims: o.unsupported_claims };
    },
  };
}

/**
 * Offline stand-in used when MOCK_LLM=1, so the UI can be exercised without
 * an API key. It just takes the first eight words: NOT a real summariser.
 */
export function mockLlm(): Llm {
  return {
    async generate({ source }) {
      await new Promise((r) => setTimeout(r, 400));
      const ticker = source.replace(/\s+/g, " ").split(" ").slice(0, 8).join(" ");
      return { ticker, factsUsed: ["(mock mode: no real fact extraction)"] };
    },
    async verify() {
      return { supported: true, unsupportedClaims: [] };
    },
  };
}

/** Picks the model backend from environment variables. */
export function llmFromEnv(): Llm {
  if (process.env.MOCK_LLM === "1") return mockLlm();
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set. Add it to .env.local (see .env.example).");
  const temperature = Number(process.env.GEMINI_TEMPERATURE ?? 0);
  const models = [process.env.GEMINI_MODEL || "gemini-3.5-flash", process.env.GEMINI_FALLBACK_MODEL ?? "gemini-3.1-flash-lite"]
    .map((m) => m.trim())
    .filter((m, i, all) => m && all.indexOf(m) === i);
  return geminiLlm(key, models, Number.isFinite(temperature) ? temperature : 0);
}

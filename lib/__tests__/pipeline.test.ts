import { describe, expect, it } from "vitest";
import { Llm, RateLimitError } from "../llm";
import { runPipeline } from "../pipeline";

const SOURCE = "The government announced that a new bridge will be built at Aluva to ease traffic.";
const base = { source: SOURCE, sourceLang: "en" as const, targetLang: "en" as const };

/** A scripted fake model: returns the given tickers in order, records calls. */
function fake(tickers: string[], verdicts: { supported: boolean; unsupportedClaims: string[] }[] = []) {
  const calls = { generate: [] as unknown[], verify: 0 };
  let g = 0;
  let v = 0;
  const llm: Llm = {
    async generate(a) {
      calls.generate.push(a);
      return { ticker: tickers[Math.min(g++, tickers.length - 1)], factsUsed: ["f"] };
    },
    async verify() {
      calls.verify++;
      return verdicts[Math.min(v++, verdicts.length - 1)] ?? { supported: true, unsupportedClaims: [] };
    },
  };
  return { llm, calls };
}

describe("runPipeline", () => {
  it("accepts a clean ticker on the first attempt", async () => {
    const { llm, calls } = fake(["New bridge to be built at Aluva."]);
    const r = await runPipeline(llm, base);
    expect(r.ticker).toBe("New bridge to be built at Aluva");
    expect(r.warnings).toEqual([]);
    expect(r.attempts).toBe(1);
    expect(calls.verify).toBe(1);
  });

  it("retries with feedback when the model invents a number, skipping the verifier", async () => {
    const { llm, calls } = fake(["₹120 crore bridge for Aluva", "New bridge to be built at Aluva"]);
    const r = await runPipeline(llm, base);
    expect(r.ticker).toBe("New bridge to be built at Aluva");
    expect(r.warnings).toEqual([]);
    expect(r.attempts).toBe(2);
    expect(calls.verify).toBe(1); // only the clean attempt reached the verifier
    const second = calls.generate[1] as { previous?: { problems: string[] } };
    expect(second.previous?.problems.join(" ")).toMatch(/120/);
  });

  it("tells the verifier when the ticker dropped the source's hedge", async () => {
    const hedged = { ...base, source: "Heavy rain is likely in Kozhikode on Tuesday." };
    const { llm } = fake(["Heavy rain in Kozhikode Tuesday"]);
    const seen: boolean[] = [];
    llm.verify = async (a) => {
      seen.push(a.hedgeDropped);
      return { supported: true, unsupportedClaims: [] };
    };
    await runPipeline(llm, hedged);
    expect(seen).toEqual([true]);
  });

  it("retries when the verifier finds an unsupported claim", async () => {
    const { llm } = fake(["Aluva bridge to ease traffic jams", "New bridge to be built at Aluva"], [
      { supported: false, unsupportedClaims: ["traffic jams"] },
      { supported: true, unsupportedClaims: [] },
    ]);
    const r = await runPipeline(llm, base);
    expect(r.ticker).toBe("New bridge to be built at Aluva");
    expect(r.attempts).toBe(2);
  });

  it("never silently passes: persistent invention comes back flagged", async () => {
    const { llm } = fake(["₹120 crore bridge for Aluva"]);
    const r = await runPipeline(llm, base);
    expect(r.warnings).toContain("number_not_in_source");
    expect(r.attempts).toBe(3);
  });

  it("flags an over-long ticker that never gets fixed", async () => {
    const { llm } = fake(["New bridge to be built at Aluva soon to help ease the traffic"]);
    const r = await runPipeline(llm, base);
    expect(r.warnings).toContain("over_limit");
  });

  it("prefers the least-bad attempt", async () => {
    const { llm } = fake([
      "₹120 crore bridge for Aluva in 2027", // 2 bad numbers + crore
      "New bridge to be built at Aluva soon to help ease the traffic", // only too long
      "₹120 crore bridge for Aluva in 2027",
    ]);
    const r = await runPipeline(llm, base);
    expect(r.warnings).toEqual(["over_limit"]);
  });

  it("marks the ticker unverified if the verifier crashes", async () => {
    const { llm } = fake(["New bridge at Aluva"]);
    llm.verify = async () => {
      throw new Error("boom");
    };
    const r = await runPipeline(llm, base);
    expect(r.warnings).toEqual(["unverified"]);
  });

  it("passes rate-limit errors through for the client to back off", async () => {
    const { llm } = fake(["x"]);
    llm.generate = async () => {
      throw new RateLimitError(5000);
    };
    await expect(runPipeline(llm, base)).rejects.toBeInstanceOf(RateLimitError);
  });
});

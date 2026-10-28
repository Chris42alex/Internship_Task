import { describe, expect, it } from "vitest";
import { checkTicker, deterministicWarnings, hardProblems, hedgeDropped } from "../checks";
import { cleanTicker, countWords, detectLanguage, splitAnnouncements } from "../text";

describe("countWords", () => {
  it("counts whitespace tokens strictly", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("  one   two\nthree ")).toBe(3);
    expect(countWords("₹5 കോടി")).toBe(2);
  });
});

describe("detectLanguage", () => {
  it("detects Malayalam and English", () => {
    expect(detectLanguage("കേരളത്തിൽ കനത്ത മഴ")).toBe("ml");
    expect(detectLanguage("Heavy rain in Kerala")).toBe("en");
    expect(detectLanguage("")).toBe("en");
    expect(detectLanguage("Rain മഴ in Kerala today again")).toBe("en");
  });
});

describe("splitAnnouncements", () => {
  it("splits on blank lines when there is no divider", () => {
    const r = splitAnnouncements("First one.\n\nSecond one.\n\n\nThird one.");
    expect(r.items).toEqual(["First one.", "Second one.", "Third one."]);
  });
  it("splits ONLY on --- when present, keeping paragraphs together", () => {
    const r = splitAnnouncements("Para A.\n\nPara B.\n---\nOther release.");
    expect(r.items).toEqual(["Para A.\n\nPara B.", "Other release."]);
  });
  it("dedupes, drops empties and over-long items", () => {
    const long = "x".repeat(3001);
    const r = splitAnnouncements(`Same\n\nSame\n\n${long}\n\n   \n\nOther`);
    expect(r.items).toEqual(["Same", "Other"]);
    expect(r.duplicates).toBe(1);
    expect(r.tooLong).toBe(1);
  });
  it("handles CRLF", () => {
    expect(splitAnnouncements("A\r\n\r\nB").items).toEqual(["A", "B"]);
  });
});

describe("cleanTicker", () => {
  it("strips quotes, trailing full stop, extra spaces", () => {
    expect(cleanTicker('  "Bridge  to be built." ')).toBe("Bridge to be built");
  });
});

describe("number checks", () => {
  const src = "The government will build a bridge at Aluva to ease traffic.";

  it("flags a number that is not in the source", () => {
    const r = checkTicker(src, "₹120 crore bridge at Aluva");
    expect(r.numbersMissing).toContain("120");
    expect(r.scalesMissing).toContain("crore");
    expect(hardProblems(r).length).toBeGreaterThan(0);
  });

  it("passes when figures match, ignoring grouping and symbols", () => {
    const r = checkTicker("Fraud of ₹1,20,000 and 5% interest", "₹120000 fraud, 5% interest");
    expect(r.numbersMissing).toEqual([]);
  });

  it("treats Malayalam digits as equal to Western digits", () => {
    const r = checkTicker("തുക ₹൧൨ കോടി", "₹12 കോടി അനുവദിച്ചു");
    expect(r.numbersMissing).toEqual([]);
    expect(r.scalesMissing).toEqual([]);
  });

  it("matches spelled-out numbers to digits", () => {
    expect(checkTicker("Three people were injured", "3 injured").numbersMissing).toEqual([]);
    expect(checkTicker("മൂന്ന് പേർ മരിച്ചു", "3 മരണം").numbersMissing).toEqual([]);
  });

  it("does not read Pathanamthitta as the number ten", () => {
    expect(checkTicker("പത്തനംതിട്ടയിൽ മഴ", "പത്തനംതിട്ടയിൽ മഴ").numbersMissing).toEqual([]);
    const r = checkTicker("പത്തനംതിട്ടയിൽ മഴ", "പത്ത് പേർ");
    expect(r.numbersMissing).toContain("10");
  });

  it("ignores a bare 'one' article in the ticker", () => {
    expect(checkTicker("A man was arrested", "One man arrested").numbersMissing).toEqual([]);
  });

  it("flags an invented year", () => {
    expect(checkTicker(src, "Aluva bridge by 2027").numbersMissing).toEqual(["2027"]);
  });
});

describe("hedge check", () => {
  const rain = "കേരളത്തിൽ അടുത്ത മൂന്ന് ദിവസം കനത്ത മഴയ്ക്ക് സാധ്യതയുണ്ടെന്ന് കാലാവസ്ഥാ വകുപ്പ് അറിയിച്ചു.";

  it("flags a Malayalam ticker that turns a possibility into a certainty", () => {
    // The real slip seen in the app: "chance of rain" became "rain will continue".
    expect(hedgeDropped(rain, "കേരളത്തിൽ മഴ തുടരും; പത്തനംതിട്ടയിൽ ഓറഞ്ച് അലർട്ട്")).toBe(true);
  });

  it("accepts Malayalam tickers that keep the hedge", () => {
    expect(hedgeDropped(rain, "കേരളത്തിൽ കനത്ത മഴയ്ക്ക് സാധ്യത")).toBe(false);
    expect(hedgeDropped("വൈദ്യുതി മുടങ്ങിയേക്കുമെന്ന് അറിയിച്ചു", "വൈദ്യുതി മുടങ്ങിയേക്കും")).toBe(false);
  });

  it("handles English hedges", () => {
    expect(hedgeDropped("The suspect is alleged to have cheated investors.", "Suspect cheated investors")).toBe(true);
    expect(hedgeDropped("The suspect is alleged to have cheated investors.", "Suspect accused of alleged fraud")).toBe(false);
    expect(hedgeDropped("The minister may visit Kochi on Monday.", "Minister may visit Kochi Monday")).toBe(false);
  });

  it("does not fire when the source has no hedge", () => {
    expect(hedgeDropped("Schools in Wayanad reopen Monday.", "Wayanad schools reopen Monday")).toBe(false);
  });

  it("counts a hedge in either language when translating", () => {
    expect(hedgeDropped("Heavy rain is likely in Kerala.", "കേരളത്തിൽ കനത്ത മഴയ്ക്ക് സാധ്യത")).toBe(false);
  });

  it("is reported by checkTicker", () => {
    expect(checkTicker(rain, "കേരളത്തിൽ മഴ തുടരും").hedgeDropped).toBe(true);
  });
});

describe("limits and warnings", () => {
  it("flags more than 10 words", () => {
    const t = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda";
    const r = deterministicWarnings("anything", t);
    expect(r.warnings).toContain("over_limit");
    expect(deterministicWarnings("x", "alpha beta gamma delta epsilon zeta eta theta iota kappa").warnings).toEqual([]);
  });

  it("collects suspicious capitalised names that are not in the source", () => {
    const r = checkTicker("The minister announced a new scheme", "Minister Pinarayi announced scheme");
    expect(r.suspectNames).toContain("Pinarayi");
  });
});

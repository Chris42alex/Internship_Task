import { describe, expect, it } from "vitest";
import { buildExport, ExportSchema } from "../export";
import { Action, State, initialState, makeEntries, reducer } from "../state";

function run(state: State, ...actions: Action[]): State {
  return actions.reduce(reducer, state);
}

/** Session with n generated tickers: "Ticker 1", "Ticker 2", ... */
function seeded(n = 3): State {
  const entries = makeEntries(
    Array.from({ length: n }, (_, i) => `Announcement number ${i + 1} about the new bridge.`),
    "auto",
  );
  let s = run(initialState, { type: "add", entries });
  s.tickers.forEach((t, i) => {
    s = run(s, { type: "start", id: t.id }, {
      type: "result",
      id: t.id,
      res: { ticker: `Ticker ${i + 1}`, factsUsed: [], warnings: [], notes: [], attempts: 1 },
    });
  });
  return s;
}

describe("review workflow", () => {
  it("keeps each ticker tied to its own announcement", () => {
    const s = seeded(3);
    s.tickers.forEach((t, i) => {
      const a = s.announcements.find((x) => x.id === t.announcementId)!;
      expect(a.text).toContain(`number ${i + 1}`);
    });
  });

  it("editing an approved ticker returns it to ready", () => {
    let s = seeded(1);
    const id = s.tickers[0].id;
    s = run(s, { type: "approve", id });
    expect(s.tickers[0].status).toBe("approved");
    s = run(s, { type: "edit", id, text: "Ticker one, edited" });
    expect(s.tickers[0].status).toBe("ready");
  });

  it("blocks approval while over the word limit and flags it live", () => {
    let s = seeded(1);
    const id = s.tickers[0].id;
    s = run(s, { type: "edit", id, text: "a b c d e f g h i j k" }, { type: "approve", id });
    expect(s.tickers[0].warnings).toContain("over_limit");
    expect(s.tickers[0].status).toBe("ready");
    s = run(s, { type: "edit", id, text: "a b c d e f g h i j" }, { type: "approve", id });
    expect(s.tickers[0].status).toBe("approved");
  });

  it("flags a number the editor types that is not in the source", () => {
    let s = seeded(1);
    s = run(s, { type: "edit", id: s.tickers[0].id, text: "Bridge costs 500 crore" });
    expect(s.tickers[0].warnings).toContain("number_not_in_source");
  });

  it("reverts to the generated text and its original warnings", () => {
    let s = seeded(1);
    const id = s.tickers[0].id;
    s = run(s, { type: "edit", id, text: "Totally different 999" }, { type: "revert", id });
    expect(s.tickers[0].text).toBe("Ticker 1");
    expect(s.tickers[0].warnings).toEqual([]);
  });

  it("approve-all only approves clean items", () => {
    let s = seeded(2);
    s = run(s, { type: "edit", id: s.tickers[1].id, text: "Bridge costs 500 crore" }, { type: "approveAllValid" });
    expect(s.tickers.map((t) => t.status)).toEqual(["approved", "ready"]);
  });

  it("reorders with move and with drag-and-drop", () => {
    let s = seeded(3);
    const [a, b, c] = s.tickers.map((t) => t.id);
    s = run(s, { type: "move", id: c, dir: -1 });
    expect(s.tickers.map((t) => t.id)).toEqual([a, c, b]);
    s = run(s, { type: "reorder", activeId: a, overId: b });
    expect(s.tickers.map((t) => t.id)).toEqual([c, b, a]);
    s = run(s, { type: "move", id: c, dir: -1 }); // already first: no-op
    expect(s.tickers[0].id).toBe(c);
  });

  it("deletes and undoes in the same position", () => {
    let s = seeded(3);
    const ids = s.tickers.map((t) => t.id);
    s = run(s, { type: "delete", id: ids[1] });
    expect(s.tickers).toHaveLength(2);
    expect(s.announcements).toHaveLength(2);
    s = run(s, { type: "undoDelete" });
    expect(s.tickers.map((t) => t.id)).toEqual(ids);
    expect(s.announcements).toHaveLength(3);
  });

  it("re-queues jobs that were mid-flight when the page was refreshed", () => {
    let s = seeded(1);
    s = run(s, { type: "regenerate", id: s.tickers[0].id }, { type: "start", id: s.tickers[0].id });
    s = run(initialState, { type: "hydrate", session: s });
    expect(s.tickers[0].status).toBe("queued");
  });
});

describe("export", () => {
  it("contains only approved tickers, in running order, numbered 1..n", () => {
    let s = seeded(3);
    const [a, b, c] = s.tickers.map((t) => t.id);
    s = run(s, { type: "move", id: c, dir: -1 }, { type: "move", id: c, dir: -1 }); // c, a, b
    s = run(s, { type: "approve", id: a }, { type: "approve", id: c }); // b stays unapproved
    const out = buildExport(s, new Date("2026-10-28T10:30:00Z"));
    expect(out.total_approved).toBe(2);
    expect(out.tickers.map((t) => [t.position, t.id])).toEqual([[1, c], [2, a]]);
    expect(out.tickers[0].source.text).toContain("number 3");
    expect(out.tickers[1].source.text).toContain("number 1");
    expect(() => ExportSchema.parse(out)).not.toThrow();
    expect(b).toBeDefined();
  });

  it("marks edited tickers and recomputes word_count", () => {
    let s = seeded(1);
    const id = s.tickers[0].id;
    s = run(s, { type: "edit", id, text: "Bridge approved for Aluva" }, { type: "approve", id });
    const t = buildExport(s).tickers[0];
    expect(t.edited_by_editor).toBe(true);
    expect(t.word_count).toBe(4);
  });

  it("exports Malayalam unescaped and valid when empty", () => {
    expect(buildExport(initialState).tickers).toEqual([]);
    const entries = makeEntries(["കേരളത്തിൽ പുതിയ പാലം നിർമ്മിക്കും"], "auto");
    let s = run(initialState, { type: "add", entries });
    const id = s.tickers[0].id;
    s = run(s, { type: "start", id }, {
      type: "result", id,
      res: { ticker: "പുതിയ പാലം നിർമ്മിക്കും", factsUsed: [], warnings: [], notes: [], attempts: 1 },
    }, { type: "approve", id });
    const json = JSON.stringify(buildExport(s));
    expect(json).toContain("പുതിയ പാലം");
    expect(buildExport(s).tickers[0].language).toBe("ml");
  });
});

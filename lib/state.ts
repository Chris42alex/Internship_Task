import { deterministicWarnings } from "./checks";
import { countWords, detectLanguage } from "./text";
import { Announcement, GenerateResponse, OutputLang, Session, TickerItem } from "./types";

export type State = Session & {
  /** True once the saved session (if any) has been loaded from localStorage. */
  hydrated?: boolean;
  /** Most recent deletion, kept so it can be undone. */
  lastDeleted?: { ticker: TickerItem; announcement: Announcement; index: number };
};

export const initialState: State = { announcements: [], tickers: [], outputLang: "auto" };

export type Entry = { announcement: Announcement; ticker: TickerItem };

/** Builds announcement + queued ticker pairs. Done outside the reducer so ids stay pure. */
export function makeEntries(texts: string[], outputLang: OutputLang): Entry[] {
  return texts.map((text) => {
    const language = detectLanguage(text);
    const announcement: Announcement = {
      id: crypto.randomUUID(),
      text,
      language,
      addedAt: new Date().toISOString(),
    };
    const ticker: TickerItem = {
      id: crypto.randomUUID(),
      announcementId: announcement.id,
      targetLang: outputLang === "auto" ? language : outputLang,
      generatedText: "",
      text: "",
      status: "queued",
      warnings: [],
      factsUsed: [],
      notes: [],
      genWarnings: [],
      genNotes: [],
    };
    return { announcement, ticker };
  });
}

export type Action =
  | { type: "hydrate"; session: Session | null }
  | { type: "add"; entries: Entry[] }
  | { type: "start"; id: string }
  | { type: "requeue"; id: string }
  | { type: "result"; id: string; res: GenerateResponse }
  | { type: "fail"; id: string; message: string }
  | { type: "retryFailed" }
  | { type: "regenerate"; id: string }
  | { type: "edit"; id: string; text: string }
  | { type: "revert"; id: string }
  | { type: "approve"; id: string }
  | { type: "unapprove"; id: string }
  | { type: "approveAllValid" }
  | { type: "move"; id: string; dir: -1 | 1 }
  | { type: "reorder"; activeId: string; overId: string }
  | { type: "delete"; id: string }
  | { type: "undoDelete" }
  | { type: "dismissUndo" }
  | { type: "setOutputLang"; lang: OutputLang }
  | { type: "clear" };

/** An item can be approved once it has text within the word limit. */
export function canApprove(t: TickerItem): boolean {
  return (
    (t.status === "ready" || t.status === "approved") &&
    t.text.trim() !== "" &&
    !t.warnings.includes("over_limit") &&
    countWords(t.text) <= 10
  );
}

const patch = (state: State, id: string, f: (t: TickerItem) => TickerItem): State => ({
  ...state,
  tickers: state.tickers.map((t) => (t.id === id ? f(t) : t)),
});

function moveItem<T>(arr: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return arr;
  const next = arr.slice();
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}

export function reducer(state: State, a: Action): State {
  switch (a.type) {
    case "hydrate":
      if (!a.session) return { ...state, hydrated: true };
      return {
        ...initialState,
        ...a.session,
        hydrated: true,
        // A job interrupted by a refresh goes back in the queue.
        tickers: a.session.tickers.map((t) => (t.status === "generating" ? { ...t, status: "queued" } : t)),
      };

    case "add":
      return {
        ...state,
        announcements: [...state.announcements, ...a.entries.map((e) => e.announcement)],
        tickers: [...state.tickers, ...a.entries.map((e) => e.ticker)],
      };

    case "start":
      return patch(state, a.id, (t) => ({ ...t, status: "generating", errorMessage: undefined }));

    case "requeue":
      return patch(state, a.id, (t) => (t.status === "generating" ? { ...t, status: "queued" } : t));

    case "result":
      return patch(state, a.id, (t) => ({
        ...t,
        status: "ready",
        generatedText: a.res.ticker,
        text: a.res.ticker,
        warnings: a.res.warnings,
        notes: a.res.notes,
        genWarnings: a.res.warnings,
        genNotes: a.res.notes,
        factsUsed: a.res.factsUsed,
        errorMessage: undefined,
      }));

    case "fail":
      return patch(state, a.id, (t) => ({
        ...t,
        status: "error",
        warnings: ["generation_failed"],
        errorMessage: a.message,
      }));

    case "retryFailed":
      return {
        ...state,
        tickers: state.tickers.map((t) => (t.status === "error" ? { ...t, status: "queued", warnings: [], errorMessage: undefined } : t)),
      };

    case "regenerate":
      return patch(state, a.id, (t) =>
        t.status === "generating" ? t : { ...t, status: "queued", errorMessage: undefined },
      );

    case "edit": {
      const src = state.announcements.find((x) => x.id === state.tickers.find((t) => t.id === a.id)?.announcementId);
      return patch(state, a.id, (t) => {
        if (t.status === "generating" || t.status === "queued") return t;
        const text = a.text.replace(/\s*\n\s*/g, " ");
        const back = text === t.generatedText;
        // Edited text has not been fact-checked by the AI, so only the
        // deterministic checks apply. Editing un-approves.
        const det = src ? deterministicWarnings(src.text, text) : { warnings: [], notes: [] };
        return {
          ...t,
          text,
          status: "ready",
          warnings: back ? t.genWarnings : det.warnings,
          notes: back ? t.genNotes : det.notes,
        };
      });
    }

    case "revert":
      return patch(state, a.id, (t) =>
        t.status === "generating" || t.status === "queued"
          ? t
          : { ...t, text: t.generatedText, status: "ready", warnings: t.genWarnings, notes: t.genNotes },
      );

    case "approve":
      return patch(state, a.id, (t) => (canApprove(t) ? { ...t, status: "approved" } : t));

    case "unapprove":
      return patch(state, a.id, (t) => (t.status === "approved" ? { ...t, status: "ready" } : t));

    case "approveAllValid":
      return {
        ...state,
        // Only items with no warnings at all: anything flagged needs a human eye.
        tickers: state.tickers.map((t) =>
          t.status === "ready" && canApprove(t) && t.warnings.length === 0 ? { ...t, status: "approved" } : t,
        ),
      };

    case "move": {
      const i = state.tickers.findIndex((t) => t.id === a.id);
      return { ...state, tickers: moveItem(state.tickers, i, i + a.dir) };
    }

    case "reorder": {
      const from = state.tickers.findIndex((t) => t.id === a.activeId);
      const to = state.tickers.findIndex((t) => t.id === a.overId);
      return { ...state, tickers: moveItem(state.tickers, from, to) };
    }

    case "delete": {
      const index = state.tickers.findIndex((t) => t.id === a.id);
      if (index < 0) return state;
      const ticker = state.tickers[index];
      const announcement = state.announcements.find((x) => x.id === ticker.announcementId);
      return {
        ...state,
        announcements: state.announcements.filter((x) => x.id !== ticker.announcementId),
        tickers: state.tickers.filter((t) => t.id !== a.id),
        lastDeleted: announcement ? { ticker, announcement, index } : undefined,
      };
    }

    case "undoDelete": {
      const d = state.lastDeleted;
      if (!d) return state;
      const tickers = state.tickers.slice();
      tickers.splice(Math.min(d.index, tickers.length), 0, d.ticker);
      return {
        ...state,
        announcements: [...state.announcements, d.announcement],
        tickers,
        lastDeleted: undefined,
      };
    }

    case "dismissUndo":
      return { ...state, lastDeleted: undefined };

    case "setOutputLang":
      return { ...state, outputLang: a.lang };

    case "clear":
      return { ...initialState, outputLang: state.outputLang };
  }
}

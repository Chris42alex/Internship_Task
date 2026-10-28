"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { initialState, makeEntries, reducer } from "./state";
import { GenerateResponse, MAX_ANNOUNCEMENTS, Session } from "./types";

const STORAGE_KEY = "ticker-desk:v1";
/** The free Gemini tier allows only a handful of requests per minute. Keep this low. */
const CONCURRENCY = 2;

export type AddResult = { added: number; duplicates: number; overCapacity: number };

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (Array.isArray(s?.announcements) && Array.isArray(s?.tickers)) {
      return { announcements: s.announcements, tickers: s.tickers, outputLang: s.outputLang ?? "auto" };
    }
  } catch {
    // Corrupt or unavailable storage: start fresh.
  }
  return null;
}

/**
 * Session state + persistence + the generation queue.
 * Anything with status "queued" is picked up automatically, CONCURRENCY at a
 * time. On HTTP 429 the whole queue pauses and backs off exponentially.
 */
export function useSession() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const hydrated = state.hydrated === true;
  const [quotaNotice, setQuotaNotice] = useState<string | null>(null);
  const [kick, setKick] = useState(0);

  // Always-current copy for async callbacks. Declared before the queue effect so it runs first.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });
  const inflight = useRef(new Set<string>());
  const pausedUntil = useRef(0);
  const strikes = useRef(0);

  // Restore on first load.
  useEffect(() => {
    dispatch({ type: "hydrate", session: loadSession() });
  }, []);

  // Persist on every change (after the restore, so we never overwrite saved work).
  useEffect(() => {
    if (!hydrated) return;
    try {
      const { announcements, tickers, outputLang } = state;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ announcements, tickers, outputLang }));
    } catch {
      // Storage full or blocked: the session still works, it just won't survive a refresh.
    }
  }, [state, hydrated]);

  // The queue.
  useEffect(() => {
    if (!hydrated) return;

    const wait = pausedUntil.current - Date.now();
    if (wait > 0) {
      const timer = setTimeout(() => {
        setQuotaNotice(null);
        setKick((k) => k + 1);
      }, wait);
      return () => clearTimeout(timer);
    }

    const slots = CONCURRENCY - inflight.current.size;
    const next = state.tickers.filter((t) => t.status === "queued" && !inflight.current.has(t.id)).slice(0, slots);

    for (const t of next) {
      const announcement = stateRef.current.announcements.find((a) => a.id === t.announcementId);
      if (!announcement) continue;
      inflight.current.add(t.id);
      dispatch({ type: "start", id: t.id });

      (async () => {
        let outcome:
          | { kind: "ok"; res: GenerateResponse }
          | { kind: "limited"; retryAfterMs: number }
          | { kind: "error"; message: string };
        try {
          const r = await fetch("/api/generate", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ source: announcement.text, targetLang: t.targetLang }),
          });
          const body = await r.json().catch(() => ({}));
          if (r.ok) outcome = { kind: "ok", res: body as GenerateResponse };
          else if (r.status === 429) outcome = { kind: "limited", retryAfterMs: Number(body.retryAfterMs) || 15000 };
          else outcome = { kind: "error", message: body.error || `Request failed (${r.status})` };
        } catch {
          outcome = { kind: "error", message: "Network error. Check your connection and retry." };
        }

        inflight.current.delete(t.id);
        if (outcome.kind === "ok") {
          strikes.current = 0;
          dispatch({ type: "result", id: t.id, res: outcome.res });
        } else if (outcome.kind === "limited") {
          strikes.current++;
          const delay = Math.min(60000, Math.max(outcome.retryAfterMs, 3000 * 2 ** (strikes.current - 1)));
          pausedUntil.current = Date.now() + delay;
          setQuotaNotice(`The free AI quota is busy. Resuming automatically in about ${Math.ceil(delay / 1000)}s.`);
          dispatch({ type: "requeue", id: t.id });
        } else {
          dispatch({ type: "fail", id: t.id, message: outcome.message });
        }
        setKick((k) => k + 1);
      })();
    }
  }, [state.tickers, hydrated, kick]);

  /** Adds announcements, skipping ones already in the session and respecting the cap. */
  const addTexts = useCallback((texts: string[]): AddResult => {
    const current = stateRef.current;
    const existing = new Set(current.announcements.map((a) => a.text));
    const fresh: string[] = [];
    let duplicates = 0;
    for (const t of texts) {
      if (existing.has(t) || fresh.includes(t)) duplicates++;
      else fresh.push(t);
    }
    const room = Math.max(0, MAX_ANNOUNCEMENTS - current.announcements.length);
    const accepted = fresh.slice(0, room);
    if (accepted.length) dispatch({ type: "add", entries: makeEntries(accepted, current.outputLang) });
    return { added: accepted.length, duplicates, overCapacity: fresh.length - accepted.length };
  }, []);

  return { state, dispatch, hydrated, quotaNotice, addTexts };
}

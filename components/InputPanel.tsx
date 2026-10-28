"use client";

import { useMemo, useState } from "react";
import { normalizeText, splitAnnouncements } from "@/lib/text";
import { AddResult } from "@/lib/useSession";
import { MAX_ANNOUNCEMENT_CHARS, MAX_ANNOUNCEMENTS, OutputLang } from "@/lib/types";

type Props = {
  count: number;
  outputLang: OutputLang;
  onOutputLang: (l: OutputLang) => void;
  onAdd: (texts: string[]) => AddResult;
};

const tabBase = "rounded-md px-3 py-1.5 text-sm font-medium";
const field =
  "w-full rounded-md border border-slate-300 bg-white p-3 text-sm leading-relaxed placeholder:text-slate-400";
const primary =
  "rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:bg-slate-300";

function describe(r: AddResult): string {
  const parts = [`Added ${r.added}.`];
  if (r.duplicates) parts.push(`${r.duplicates} duplicate${r.duplicates > 1 ? "s" : ""} skipped.`);
  if (r.overCapacity) parts.push(`${r.overCapacity} not added: the session is limited to ${MAX_ANNOUNCEMENTS}.`);
  return parts.join(" ");
}

export default function InputPanel({ count, outputLang, onOutputLang, onAdd }: Props) {
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [single, setSingle] = useState("");
  const [bulk, setBulk] = useState("");
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  const singleText = normalizeText(single);
  const singleTooLong = singleText.length > MAX_ANNOUNCEMENT_CHARS;
  const parsed = useMemo(() => splitAnnouncements(bulk), [bulk]);

  function addSingle() {
    if (!singleText || singleTooLong) return;
    const r = onAdd([singleText]);
    if (r.added) {
      setSingle("");
      setMessage({ text: "Added 1. Generating…" });
    } else {
      setMessage({
        text: r.duplicates ? "That announcement is already in this session." : describe(r),
        error: true,
      });
    }
  }

  function addBulk() {
    if (!parsed.items.length) return;
    const r = onAdd(parsed.items);
    setMessage({ text: describe(r), error: r.added === 0 });
    if (r.added) setBulk("");
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 2_000_000) {
      setMessage({ text: "That file is too large (limit 2 MB).", error: true });
      return;
    }
    setBulk(await file.text()); // File.text() decodes as UTF-8, so Malayalam survives.
    setMessage(null);
  }

  return (
    <section aria-label="Add announcements" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" className="flex gap-1 rounded-lg bg-slate-100 p-1">
          {(["single", "bulk"] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={`${tabBase} ${mode === m ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
            >
              {m === "single" ? "One announcement" : "Many at once"}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          Ticker language
          <select
            value={outputLang}
            onChange={(e) => onOutputLang(e.target.value as OutputLang)}
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900"
          >
            <option value="auto">Same as announcement</option>
            <option value="ml">Always Malayalam</option>
            <option value="en">Always English</option>
          </select>
        </label>
      </div>

      {mode === "single" ? (
        <div className="space-y-3">
          <textarea
            aria-label="Announcement text"
            value={single}
            onChange={(e) => setSingle(e.target.value)}
            rows={5}
            placeholder="Paste or type one press release / announcement (English or Malayalam)…"
            className={field}
          />
          <div className="flex items-center justify-between gap-3">
            <span className={`text-xs ${singleTooLong ? "font-medium text-red-700" : "text-slate-500"}`}>
              {singleText.length.toLocaleString()} / {MAX_ANNOUNCEMENT_CHARS.toLocaleString()} characters
            </span>
            <button onClick={addSingle} disabled={!singleText || singleTooLong} className={primary}>
              Generate ticker
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <textarea
            aria-label="Several announcements"
            value={bulk}
            onChange={(e) => setBulk(e.target.value)}
            rows={8}
            placeholder={"Paste several announcements.\nSeparate them with a blank line, or with a line containing only ---\n(if you use --- lines, paragraphs inside one announcement stay together)."}
            className={field}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-sm">
              <label className="cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50">
                Upload .txt
                <input
                  type="file"
                  accept=".txt,text/plain"
                  className="sr-only"
                  onChange={(e) => {
                    onFile(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
              <span aria-live="polite" className="text-slate-600">
                {bulk.trim()
                  ? `${parsed.items.length} announcement${parsed.items.length === 1 ? "" : "s"} detected` +
                    (parsed.duplicates ? ` · ${parsed.duplicates} duplicate${parsed.duplicates > 1 ? "s" : ""} ignored` : "") +
                    (parsed.tooLong ? ` · ${parsed.tooLong} over ${MAX_ANNOUNCEMENT_CHARS} characters (skipped)` : "")
                  : "Nothing pasted yet"}
              </span>
            </div>
            <button onClick={addBulk} disabled={!parsed.items.length} className={primary}>
              Generate {parsed.items.length || ""} ticker{parsed.items.length === 1 ? "" : "s"}
            </button>
          </div>
        </div>
      )}

      <p aria-live="polite" className={`mt-3 text-sm ${message?.error ? "text-red-700" : "text-slate-600"}`}>
        {message?.text ?? (count ? `${count} / ${MAX_ANNOUNCEMENTS} announcements in this session.` : "")}
      </p>
    </section>
  );
}

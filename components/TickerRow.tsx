"use client";

import { Dispatch, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Action, canApprove } from "@/lib/state";
import { countWords } from "@/lib/text";
import { Announcement, MAX_WORDS, TickerItem, TickerStatus, Warning } from "@/lib/types";

const WARNING_LABEL: Record<Warning, { label: string; tone: "red" | "amber" }> = {
  over_limit: { label: "Over the word limit", tone: "red" },
  number_not_in_source: { label: "Number not in source", tone: "amber" },
  unsupported_claim: { label: "Possible unsupported claim", tone: "amber" },
  unverified: { label: "Not fact-checked", tone: "amber" },
  generation_failed: { label: "Generation failed", tone: "red" },
};

const STATUS_LABEL: Record<TickerStatus, { label: string; cls: string }> = {
  queued: { label: "Queued", cls: "bg-slate-100 text-slate-600" },
  generating: { label: "Generating…", cls: "bg-blue-50 text-blue-700" },
  ready: { label: "Needs review", cls: "bg-slate-100 text-slate-700" },
  approved: { label: "Approved", cls: "bg-emerald-50 text-emerald-800" },
  error: { label: "Error", cls: "bg-red-50 text-red-700" },
};

const iconBtn =
  "rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40";

type Props = {
  item: TickerItem;
  announcement: Announcement | undefined;
  index: number;
  total: number;
  dispatch: Dispatch<Action>;
};

export default function TickerRow({ item, announcement, index, total, dispatch }: Props) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const [expanded, setExpanded] = useState(false);

  const busy = item.status === "queued" || item.status === "generating";
  const words = countWords(item.text);
  const over = words > MAX_WORDS;
  const edited = item.generatedText !== "" && item.text !== item.generatedText;
  const source = announcement?.text ?? "";
  const longSource = source.length > 220;
  const status = STATUS_LABEL[item.status];
  const approved = item.status === "approved";

  function regenerate() {
    if (edited && !window.confirm("Regenerating replaces your edits to this ticker. Continue?")) return;
    dispatch({ type: "regenerate", id: item.id });
  }

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`rounded-xl border bg-white shadow-sm ${approved ? "border-emerald-300" : "border-slate-200"} ${
        isDragging ? "relative z-10 opacity-80 shadow-lg" : ""
      }`}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2">
        <button
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Drag to reorder ticker ${index + 1}`}
          className="cursor-grab touch-none rounded px-1.5 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 active:cursor-grabbing"
        >
          ⠿
        </button>
        <span className="text-sm font-semibold text-slate-500">#{index + 1}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.cls}`}>{status.label}</span>
        {edited && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700">Edited</span>}
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
          {announcement?.language === "ml" ? "മലയാളം" : "English"} → {item.targetLang === "ml" ? "മലയാളം" : "English"}
        </span>

        <div className="ml-auto flex items-center gap-1">
          <button className={iconBtn} aria-label={`Move ticker ${index + 1} up`} disabled={index === 0} onClick={() => dispatch({ type: "move", id: item.id, dir: -1 })}>
            ↑
          </button>
          <button className={iconBtn} aria-label={`Move ticker ${index + 1} down`} disabled={index === total - 1} onClick={() => dispatch({ type: "move", id: item.id, dir: 1 })}>
            ↓
          </button>
          <button className={iconBtn} onClick={regenerate} disabled={item.status === "generating"}>
            ↻ Regenerate
          </button>
          <button className={`${iconBtn} hover:text-red-700`} onClick={() => dispatch({ type: "delete", id: item.id })}>
            Delete
          </button>
        </div>
      </div>

      <div className="grid gap-4 p-3 md:grid-cols-2">
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Source announcement</h3>
          <p lang={announcement?.language} className={`whitespace-pre-line text-sm leading-relaxed text-slate-700 ${expanded ? "" : "line-clamp-4"}`}>
            {source}
          </p>
          {longSource && (
            <button onClick={() => setExpanded((e) => !e)} className="mt-1 text-xs font-medium text-red-700 hover:underline">
              {expanded ? "Show less" : "Show full text"}
            </button>
          )}
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ticker</h3>
            {!busy && item.status !== "error" && (
              <span aria-live="polite" className={`text-xs font-semibold tabular-nums ${over ? "text-red-700" : "text-slate-500"}`}>
                {words}/{MAX_WORDS} words
              </span>
            )}
          </div>

          {busy ? (
            <div className="flex h-16 items-center rounded-md border border-dashed border-slate-300 px-3 text-sm text-slate-500">
              {item.status === "queued" ? "Waiting in queue…" : "Writing and fact-checking…"}
            </div>
          ) : item.status === "error" ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <p>Couldn’t generate this ticker. {item.errorMessage}</p>
              <button className="mt-2 rounded-md bg-red-700 px-3 py-1 text-xs font-semibold text-white hover:bg-red-800" onClick={regenerate}>
                Retry
              </button>
            </div>
          ) : (
            <textarea
              lang={item.targetLang}
              aria-label={`Ticker ${index + 1} text`}
              value={item.text}
              rows={2}
              onChange={(e) => dispatch({ type: "edit", id: item.id, text: e.target.value })}
              className={`w-full resize-none rounded-md border bg-white p-2.5 text-base font-medium leading-snug ${
                over ? "border-red-400 bg-red-50" : "border-slate-300"
              }`}
            />
          )}

          {!busy && item.warnings.length > 0 && item.status !== "error" && (
            <div className="mt-2 space-y-1.5">
              <div className="flex flex-wrap gap-1.5">
                {item.warnings.map((w) => (
                  <span
                    key={w}
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      WARNING_LABEL[w].tone === "red" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"
                    }`}
                  >
                    ⚠ {WARNING_LABEL[w].label}
                  </span>
                ))}
              </div>
              {item.notes.map((n, i) => (
                <p key={i} className="text-xs text-slate-600">
                  {n}
                </p>
              ))}
            </div>
          )}

          {!busy && item.status !== "error" && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {approved ? (
                <button className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-800 hover:bg-emerald-100" onClick={() => dispatch({ type: "unapprove", id: item.id })}>
                  ✓ Approved · Undo
                </button>
              ) : (
                <button
                  className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                  disabled={!canApprove(item)}
                  title={over ? `Shorten to ${MAX_WORDS} words or fewer to approve` : undefined}
                  onClick={() => dispatch({ type: "approve", id: item.id })}
                >
                  Approve
                </button>
              )}
              {edited && (
                <button className="text-xs font-medium text-slate-600 hover:underline" onClick={() => dispatch({ type: "revert", id: item.id })}>
                  Revert to generated
                </button>
              )}
            </div>
          )}

          {edited && !busy && (
            <p className="mt-2 text-xs text-slate-500">
              Generated: <span lang={item.targetLang}>{item.generatedText}</span>
            </p>
          )}

          {item.factsUsed.length > 0 && !busy && (
            <details className="mt-2 text-xs text-slate-600">
              <summary className="cursor-pointer font-medium text-slate-600">Facts the AI relied on</summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {item.factsUsed.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>
    </li>
  );
}

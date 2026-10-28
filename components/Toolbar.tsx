"use client";

import { Dispatch, useState } from "react";
import { exportFilename, exportJson } from "@/lib/export";
import { Action, State } from "@/lib/state";

const btn =
  "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40";

export default function Toolbar({ state, dispatch }: { state: State; dispatch: Dispatch<Action> }) {
  const [copied, setCopied] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const { tickers } = state;
  const approved = tickers.filter((t) => t.status === "approved").length;
  const pending = tickers.filter((t) => t.status === "queued" || t.status === "generating").length;
  const attention = tickers.filter((t) => t.status === "error" || (t.status !== "approved" && t.warnings.length > 0)).length;
  const failed = tickers.filter((t) => t.status === "error").length;
  const generated = tickers.length - pending - failed;
  const approvable = tickers.some((t) => t.status === "ready" && t.warnings.length === 0 && t.text.trim());

  function tryExport(): string | null {
    try {
      setExportError(null);
      return exportJson(state);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Export failed validation.");
      return null;
    }
  }

  function download() {
    const json = tryExport();
    if (!json) return;
    const url = URL.createObjectURL(new Blob([json], { type: "application/json;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = exportFilename();
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copy() {
    const json = tryExport();
    if (!json) return;
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setExportError("Couldn’t access the clipboard. Use Download instead.");
    }
  }

  return (
    <div className="sticky top-0 z-20 -mx-4 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2">
        <p aria-live="polite" className="text-sm text-slate-700">
          <strong className="font-semibold">{generated}</strong> generated ·{" "}
          <strong className="font-semibold text-emerald-700">{approved}</strong> approved
          {pending > 0 && <> · <strong className="font-semibold text-blue-700">{pending}</strong> in progress</>}
          {attention > 0 && <> · <strong className="font-semibold text-amber-700">{attention}</strong> need attention</>}
        </p>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button className={btn} disabled={!approvable} onClick={() => dispatch({ type: "approveAllValid" })} title="Approves every ticker that has no warnings">
            Approve all clean
          </button>
          {failed > 0 && (
            <button className={btn} onClick={() => dispatch({ type: "retryFailed" })}>
              Retry {failed} failed
            </button>
          )}
          <button className={btn} disabled={!approved} onClick={copy}>
            {copied ? "Copied ✓" : "Copy JSON"}
          </button>
          <button
            className="rounded-md bg-red-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            disabled={!approved}
            onClick={download}
          >
            Export {approved} approved (JSON)
          </button>
          <button
            className="px-2 py-1.5 text-sm text-slate-500 hover:text-red-700 disabled:opacity-40"
            disabled={!tickers.length}
            onClick={() => {
              if (window.confirm("Clear every announcement and ticker in this session? This can’t be undone.")) dispatch({ type: "clear" });
            }}
          >
            Clear session
          </button>
        </div>
      </div>
      {exportError && <p className="mx-auto mt-2 max-w-5xl text-sm text-red-700">{exportError}</p>}
    </div>
  );
}

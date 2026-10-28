"use client";

import { useState } from "react";

type Speed = "slow" | "normal" | "fast";

/** Reading speed in characters per second. Slower than you'd think: viewers must read while it moves. */
const CHARS_PER_SECOND: Record<Speed, number> = { slow: 9, normal: 14, fast: 20 };

/**
 * Shows the approved tickers the way they run on air: one strip scrolling
 * right to left, in running order. Preview only; the export is what feeds
 * the channel's graphics system.
 */
export default function TickerPreview({ texts }: { texts: string[] }) {
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<Speed>("normal");

  const totalChars = texts.reduce((n, t) => n + t.length + 6, 0); // +6 for the gap and marker
  // Duration is proportional to length so the reading speed stays constant however many items there are.
  const seconds = Math.max(12, Math.round(totalChars / CHARS_PER_SECOND[speed]));

  // Each half repeats the items, so the strip never shows a gap even with a single short ticker.
  const half = (hidden: boolean) => (
    <div className="ticker-half" aria-hidden={hidden || undefined}>
      {texts.map((t, i) => (
        <span key={i} className="ticker-item">
          {t}
        </span>
      ))}
    </div>
  );

  return (
    <section aria-label="Ticker preview" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Preview as ticker</h2>
          <p className="text-xs text-slate-500">
            Approved tickers only, in running order. This is how they will scroll on screen.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            Speed
            <select
              value={speed}
              onChange={(e) => setSpeed(e.target.value as Speed)}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"
            >
              <option value="slow">Slow</option>
              <option value="normal">Normal</option>
              <option value="fast">Fast</option>
            </select>
          </label>
          <button
            onClick={() => setPlaying((p) => !p)}
            aria-pressed={!playing}
            className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            {playing ? "Pause" : "Play"}
          </button>
        </div>
      </div>

      {/* Dark "screen" with the strip along the bottom, like the on-air look. */}
      <div className="ticker-screen">
        <span className="ticker-live">LIVE</span>
        <div className="ticker-bar">
          <div className="ticker-tag">Headlines</div>
          <div className="ticker-window">
            <div
              className="ticker-track"
              style={{ animationDuration: `${seconds}s`, animationPlayState: playing ? "running" : "paused" }}
            >
              {half(false)}
              {half(true)}
            </div>
          </div>
        </div>
      </div>

      <ol className="sr-only">
        {texts.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ol>
    </section>
  );
}

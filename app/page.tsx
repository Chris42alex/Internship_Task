"use client";

import { useEffect } from "react";
import {
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import InputPanel from "@/components/InputPanel";
import TickerPreview from "@/components/TickerPreview";
import TickerRow from "@/components/TickerRow";
import Toolbar from "@/components/Toolbar";
import { useSession } from "@/lib/useSession";

export default function Home() {
  const { state, dispatch, hydrated, quotaNotice, addTexts } = useSession();
  const { tickers, announcements } = state;
  // Same selection and order as the export: approved only, in running order.
  const approvedTexts = tickers.filter((t) => t.status === "approved").map((t) => t.text.trim());

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(e: DragEndEvent) {
    if (e.over && e.active.id !== e.over.id) {
      dispatch({ type: "reorder", activeId: String(e.active.id), overId: String(e.over.id) });
    }
  }

  // The undo toast disappears by itself.
  const undoId = state.lastDeleted?.ticker.id;
  useEffect(() => {
    if (!undoId) return;
    const t = setTimeout(() => dispatch({ type: "dismissUndo" }), 6000);
    return () => clearTimeout(t);
  }, [undoId, dispatch]);

  return (
    <div className="px-4 pb-24">
      <header className="mx-auto max-w-5xl py-6">
        <h1 className="text-2xl font-bold tracking-tight">
          <span className="mr-2 rounded bg-red-700 px-2 py-0.5 text-lg text-white">LIVE</span>
          Ticker Desk
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Turn press releases into broadcast tickers of ten words or fewer. Every ticker is checked against its source: review, edit, reorder, approve, export.
        </p>
      </header>

      <Toolbar state={state} dispatch={dispatch} />

      <main className="mx-auto mt-6 max-w-5xl space-y-6">
        <InputPanel
          count={announcements.length}
          outputLang={state.outputLang}
          onOutputLang={(lang) => dispatch({ type: "setOutputLang", lang })}
          onAdd={addTexts}
        />

        {approvedTexts.length > 0 && <TickerPreview texts={approvedTexts} />}

        {quotaNotice && (
          <p role="status" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {quotaNotice} Your announcements are safe in the queue.
          </p>
        )}

        {!hydrated ? null : tickers.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white/60 p-10 text-center text-slate-600">
            <p className="font-medium text-slate-800">No tickers yet</p>
            <p className="mt-1 text-sm">Add one announcement, or paste or upload many, to get started.</p>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={tickers.map((t) => t.id)} strategy={verticalListSortingStrategy}>
              <ol className="space-y-4" aria-label="Tickers in running order">
                {tickers.map((t, i) => (
                  <TickerRow
                    key={t.id}
                    item={t}
                    announcement={announcements.find((a) => a.id === t.announcementId)}
                    index={i}
                    total={tickers.length}
                    dispatch={dispatch}
                  />
                ))}
              </ol>
            </SortableContext>
          </DndContext>
        )}
      </main>

      {state.lastDeleted && (
        <div role="status" className="fixed bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-slate-900 px-4 py-2.5 text-sm text-white shadow-lg">
          Ticker deleted.
          <button className="font-semibold text-red-300 hover:underline" onClick={() => dispatch({ type: "undoDelete" })}>
            Undo
          </button>
        </div>
      )}
    </div>
  );
}

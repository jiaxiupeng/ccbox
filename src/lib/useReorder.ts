import { useCallback, useRef, useState } from "react";

/** Indices in a reorderable list. */
export interface ReorderState {
  /** index of the item currently being dragged, or null */
  dragging: number | null;
  /** index the pointer is currently hovering over (drop target), or null */
  over: number | null;
}

/**
 * Pointer-based list reordering. More reliable than HTML5 drag-and-drop on
 * Windows/webview: HTML5 DnD is brittle with nested interactive elements and
 * can swallow pointer events or trigger accidental navigation; this hook just
 * listens to pointerdown/move/up on a drag handle.
 *
 * Usage:
 *   const r = useReorder(onReorder);
 *   <button onPointerDown={(e) => r.start(e, i)} ... />
 *   <div data-over={r.state.over === i} ... />
 */
export function useReorder<T>(onReorder: (nextIndex: number, fromIndex: number) => void) {
  const [state, setState] = useState<ReorderState>({ dragging: null, over: null });
  // bookkeeping kept in refs so the global listeners stay stable
  const fromRef = useRef<number | null>(null);
  const overRef = useRef<number | null>(null);
  const movedRef = useRef(false);
  // the latest onReorder, so listeners created once always call the freshest
  const reorderRef = useRef(onReorder);
  reorderRef.current = onReorder;

  const finish = useCallback(() => {
    const from = fromRef.current;
    const to = overRef.current;
    if (from !== null && to !== null && from !== to && movedRef.current) {
      reorderRef.current(to, from);
    }
    fromRef.current = null;
    overRef.current = null;
    movedRef.current = false;
    setState({ dragging: null, over: null });
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  }, []);

  const start = useCallback(
    (e: React.PointerEvent, index: number) => {
      // only primary button (left / touch / pen)
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      fromRef.current = index;
      overRef.current = index;
      movedRef.current = false;
      setState({ dragging: index, over: index });
      document.body.style.userSelect = "none";
      document.body.style.cursor = "grabbing";

      const startX = e.clientX;
      const startY = e.clientY;
      const target = e.currentTarget as HTMLElement;

      const onMove = (ev: PointerEvent) => {
        // mark as a real drag only after a tiny threshold, so a casual click
        // on the handle doesn't lock the list into drag mode.
        if (!movedRef.current) {
          if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 4) return;
          movedRef.current = true;
        }
        // find which list item is under the pointer via data-index attribute
        const el = document
          .elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
        const item = el?.closest("[data-ridx]") as HTMLElement | null;
        if (item) {
          const idx = Number(item.getAttribute("data-ridx"));
          if (!Number.isNaN(idx) && overRef.current !== idx) {
            overRef.current = idx;
            setState({ dragging: fromRef.current, over: idx });
          }
        }
      };
      const onUp = () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        finish();
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    },
    [finish],
  );

  return { state, start };
}

/** Reorder helper: move the item at `from` to position `to` in a new array. */
export function move<T>(arr: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return arr;
  const next = arr.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

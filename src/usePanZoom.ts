import { useCallback, useEffect, useRef, useState, type PointerEvent, type MouseEvent, type RefObject } from 'react';

export type Viewport = { zoom: number; x: number; y: number };
type Point = { x: number; y: number };
const initial: Viewport = { zoom: 1, x: 0, y: 0 };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function usePanZoom(surfaceRef: RefObject<HTMLDivElement | null>, contentRef = surfaceRef, maxZoom = 8, imageAspect = 0) {
  const [viewport, setViewport] = useState(initial);
  const [isDragging, setIsDragging] = useState(false);
  const current = useRef(initial);
  const target = useRef(initial);
  const frame = useRef(0);
  const pointers = useRef(new Map<number, Point>());
  const moved = useRef(false);
  const start = useRef<Point | null>(null);

  const constrain = useCallback((value: Viewport) => {
    const element = contentRef.current;
    const zoom = clamp(value.zoom, 1, maxZoom);
    const width = element?.clientWidth ?? 0;
    const height = element?.clientHeight ?? 0;
    // Account for object-fit letterboxing so a wide/portrait image cannot be dragged offscreen.
    const fittedWidth = imageAspect ? Math.min(width, height * imageAspect) : width;
    const fittedHeight = imageAspect ? Math.min(height, width / imageAspect) : height;
    const maxX = Math.max(0, (fittedWidth * zoom - width) / 2);
    const maxY = Math.max(0, (fittedHeight * zoom - height) / 2);
    return { zoom, x: clamp(value.x, -maxX, maxX), y: clamp(value.y, -maxY, maxY) };
  }, [contentRef, maxZoom, imageAspect]);

  const commit = useCallback((value: Viewport) => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    current.current = target.current = constrain(value);
    setViewport(current.current);
  }, [constrain]);

  const animate = useCallback((value: Viewport) => {
    target.current = constrain(value);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      commit(target.current);
      return;
    }
    if (frame.current) return;
    let previousTime = performance.now();
    const tick = (time: number) => {
      const weight = 1 - Math.exp(-Math.min(time - previousTime, 64) / 45);
      previousTime = time;
      const from = current.current;
      const to = target.current;
      const done = Math.abs(to.zoom - from.zoom) < .001 && Math.hypot(to.x - from.x, to.y - from.y) < .1;
      current.current = done ? to : {
        zoom: from.zoom + (to.zoom - from.zoom) * weight,
        x: from.x + (to.x - from.x) * weight,
        y: from.y + (to.y - from.y) * weight,
      };
      setViewport(current.current);
      frame.current = done ? 0 : requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, [commit, constrain]);

  const setZoom = useCallback((next: number, clientX?: number, clientY?: number) => {
    if (!Number.isFinite(next)) return;
    const rect = contentRef.current?.getBoundingClientRect();
    const focusX = rect && clientX !== undefined ? clientX - rect.left - rect.width / 2 : 0;
    const focusY = rect && clientY !== undefined ? clientY - rect.top - rect.height / 2 : 0;
    const from = target.current;
    const zoom = clamp(next, 1, maxZoom);
    const ratio = zoom / from.zoom;
    animate({ zoom, x: focusX - (focusX - from.x) * ratio, y: focusY - (focusY - from.y) * ratio });
  }, [animate, contentRef, maxZoom]);

  const reset = useCallback(() => {
    pointers.current.clear();
    start.current = null;
    moved.current = false;
    setIsDragging(false);
    commit(initial);
  }, [commit]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    // React delegates wheel listeners as passive; cancellation must happen here.
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if ((event.target as HTMLElement).closest('[data-zoom-controls]')) return;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? surface.clientHeight : 1);
      setZoom(target.current.zoom * Math.exp(-clamp(delta, -160, 160) * .002), event.clientX, event.clientY);
    };
    surface.addEventListener('wheel', wheel, { passive: false });
    const observer = new ResizeObserver(() => commit(current.current));
    observer.observe(surface);
    if (contentRef.current && contentRef.current !== surface) observer.observe(contentRef.current);
    return () => {
      surface.removeEventListener('wheel', wheel);
      observer.disconnect();
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [surfaceRef, contentRef, setZoom, commit]);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target as HTMLElement).closest('[data-zoom-controls], input, select, textarea')) return;
    const button = (event.target as HTMLElement).closest('button');
    if (button && !(event.pointerType === 'touch' && button.classList.contains('lineup-pin'))) return;
    if (!button) event.preventDefault();
    window.getSelection()?.removeAllRanges();
    if (!pointers.current.size) {
      moved.current = false;
      start.current = { x: event.clientX, y: event.clientY };
      commit(current.current);
    }
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size > 1) moved.current = true;
    // Preserve a pin's click target while still receiving its touch gestures.
    (button ?? event.currentTarget).setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    event.preventDefault();
    const before = [...pointers.current.values()].slice(0, 2);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const after = [...pointers.current.values()].slice(0, 2);
    const from = current.current;
    if (start.current && Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > 4) moved.current = true;
    if (after.length === 2) {
      const distance = (points: Point[]) => Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      const center = (points: Point[]) => ({ x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 });
      const oldCenter = center(before);
      const newCenter = center(after);
      const rect = contentRef.current?.getBoundingClientRect();
      if (!rect) return;
      const zoom = clamp(from.zoom * distance(after) / Math.max(distance(before), 1), 1, maxZoom);
      const ratio = zoom / from.zoom;
      const x = oldCenter.x - rect.left - rect.width / 2;
      const y = oldCenter.y - rect.top - rect.height / 2;
      commit({ zoom, x: x - (x - from.x) * ratio + newCenter.x - oldCenter.x, y: y - (y - from.y) * ratio + newCenter.y - oldCenter.y });
      moved.current = true;
    } else if (from.zoom > 1) {
      commit({ ...from, x: from.x + after[0].x - before[0].x, y: from.y + after[0].y - before[0].y });
    }
    setIsDragging(moved.current);
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    if (!pointers.current.size) setIsDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function onClickCapture(event: MouseEvent<HTMLDivElement>) {
    if (!moved.current || (event.target as HTMLElement).closest('[data-zoom-controls]')) return;
    event.preventDefault();
    event.stopPropagation();
    moved.current = false;
  }

  return { viewport, isDragging, setZoom, reset, handlers: {
    onDragStart: (event: React.DragEvent<HTMLDivElement>) => event.preventDefault(),
    onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onLostPointerCapture: onPointerUp, onClickCapture,
  } };
}

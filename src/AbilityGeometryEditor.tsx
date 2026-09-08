import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { effectError, effectPosition, geometryFor, mapUnitsPerMeter, pathDistance, tracePath, withEffect, type AbilityEffect, type Point } from './ability-geometry.mjs';
import type { Lineup } from './package-model.mjs';

export type GeometryEditing = { id: string; type: 'direction' | 'path'; effect?: AbilityEffect };
type Props = {
  lineup: Lineup; editing: GeometryEditing | null; busy: boolean; rotation: number; pathTolerance: number;
  pointStyle: (point: Point) => CSSProperties; pointFromPointer: (x: number, y: number, directionOnly?: boolean) => Point | null;
  onStart: (type: 'direction' | 'path') => void; onPreview: (effect?: AbilityEffect) => void;
  onFinish: () => void; onCancel: () => void;
};
type Drag = { id: number; kind: 'path' | 'direction'; before?: AbilityEffect; points: Point[]; pointer: Point };
const editIcon = <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4 13-1 4 4-1L17 6l-3-3Zm8-8 3 3" /></svg>;
export default function AbilityGeometryEditor({ lineup, editing, busy, rotation, pathTolerance, pointStyle, pointFromPointer, onStart, onPreview, onFinish, onCancel }: Props) {
  const drag = useRef<Drag | null>(null);
  const anchor = useRef<HTMLSpanElement | null>(null);
  const [toolbarPosition, setToolbarPosition] = useState({ x: 100, y: 100 });
  const spec = geometryFor(lineup);
  const interaction = spec && 'interaction' in spec ? spec.interaction : undefined;
  const effect = editing ? editing.effect : lineup.effect;
  const endpoint = effectPosition(withEffect(lineup, effect));
  const targetStyle = pointStyle(endpoint);
  useEffect(() => {
    if (!editing) { drag.current = null; return; }
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel(); }
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, [editing, onCancel]);
  const directionEditing = Boolean(editing?.type === 'direction');
  useLayoutEffect(() => {
    const element = anchor.current, parent = element?.parentElement;
    if (!element || !parent) return;
    const position = () => {
      const gap = directionEditing ? 102 : 38, height = editing ? 76 : 44;
      const top = element.offsetTop;
      const below = top + gap;
      const y = below + height <= parent.clientHeight ? below : top - gap - height;
      const next = { x: Math.max(100, Math.min(parent.clientWidth - 100, element.offsetLeft)), y: Math.max(8, Math.min(parent.clientHeight - height - 8, y)) };
      setToolbarPosition((current) => current.x === next.x && current.y === next.y ? current : next);
    };
    position();
    const observer = new ResizeObserver(position); observer.observe(parent);
    return () => observer.disconnect();
  }, [targetStyle.left, targetStyle.top, directionEditing, editing, interaction]);
  if (!spec || !('interaction' in spec)) return null;
  const angle = effect?.type === 'direction' ? effect.angle : 0;
  const error = effect ? effectError(withEffect(lineup, effect)) : null;
  const isPath = spec.interaction === 'path';
  const distance = isPath && effect?.type === 'path' ? pathDistance(lineup.target, effect.points, lineup.mapId) : 0;

  function begin(event: PointerEvent<HTMLElement>, kind: Drag['kind']) {
    if (busy || !editing || event.button !== 0) return;
    const point = pointFromPointer(event.clientX, event.clientY, kind === 'direction');
    if (!point) return;
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, kind, before: effect, pointer: { x: event.clientX, y: event.clientY }, points: effect?.type === 'path' ? effect.points : [] };
  }
  function move(event: PointerEvent<HTMLElement>) {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    if (current.pointer.x === event.clientX && current.pointer.y === event.clientY) return;
    current.pointer = { x: event.clientX, y: event.clientY };
    const point = pointFromPointer(event.clientX, event.clientY, current.kind === 'direction');
    if (!point) return;
    if (current.kind === 'direction') {
      const dx = point.x - lineup.target.x, dy = point.y - lineup.target.y;
      if (Math.hypot(dx, dy) > .001) onPreview({ type: 'direction', angle: Math.round(Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360 });
    } else {
      if (!spec || !('interaction' in spec) || spec.interaction !== 'path') return;
      current.points = tracePath(lineup.target, current.points, point, spec.maxDistance * mapUnitsPerMeter[lineup.mapId], pathTolerance);
      onPreview(current.points.length ? { type: 'path', points: current.points } : undefined);
    }
  }

  function end(event: PointerEvent<HTMLElement>, cancelled = false) {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    event.stopPropagation();
    if (cancelled) onPreview(current.before); else move(event);
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  const handlers = { onPointerMove: move, onPointerUp: (event: PointerEvent<HTMLElement>) => end(event), onPointerCancel: (event: PointerEvent<HTMLElement>) => end(event, true) };
  const toolbarStyle = { left: toolbarPosition.x, top: toolbarPosition.y };
  return <div className={`geometry-controls ${editing ? 'is-editing' : ''}`} data-geometry-controls onClick={(event) => event.stopPropagation()}>
    <span ref={anchor} className="geometry-anchor" style={targetStyle} />
    {editing && isPath ? <button type="button" className="geometry-endpoint-drag" style={targetStyle}
      aria-label="拖动终点绘制路径" title="拖动延伸路径 · 沿原路径回拖缩短" disabled={busy}
      onPointerDown={(event) => begin(event, 'path')} {...handlers} /> : null}
    {editing && !isPath ? <div className="geometry-direction-arm" style={{ ...targetStyle, transform: `rotate(${angle + rotation}deg)` }}>
      <span className="geometry-direction-line" />
      <button className="geometry-direction-handle" type="button" aria-label="拖动调整释放方向" title="拖动调整方向 · 方向键微调" disabled={busy}
        onPointerDown={(event) => begin(event, 'direction')} {...handlers}
        onKeyDown={(event) => { if (['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp'].includes(event.key)) { event.preventDefault(); onPreview({ type: 'direction', angle: (angle + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) * (event.shiftKey ? 10 : 1) + 360) % 360 }); } }}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 4 6 6-6 6" /></svg></button>
    </div> : null}
    <div className={`geometry-toolbar ${editing && !isPath ? 'is-direction' : ''}`} style={toolbarStyle} role="group" aria-label={isPath ? '地图路径编辑' : '地图方向编辑'} onPointerDown={(event) => event.stopPropagation()}>
      {!editing ? <button type="button" className="geometry-edit-button" disabled={busy} onClick={() => onStart(spec.interaction)}>{editIcon}{isPath ? '编辑路径' : '编辑方向'}</button> : <>
        <div className="geometry-toolbar-actions">
          <button type="button" className="geometry-save" aria-label="保存技能设置" disabled={busy} onClick={onFinish}><span aria-hidden="true">✓</span> 保存</button>
          <button type="button" aria-label="重置" disabled={busy} onClick={() => onPreview(undefined)}><span aria-hidden="true">↺</span> 重置</button>
          <button type="button" className="geometry-cancel" aria-label="取消技能设置" title="取消 · Esc" disabled={busy} onClick={onCancel}>×</button>
        </div>
        <output className={error ? 'is-invalid' : ''} aria-label={isPath ? '引导路径距离' : '释放方向角度'}>{isPath ? `${distance.toFixed(1)} / ${spec.maxDistance} 米${distance >= spec.maxDistance - .01 ? ' · 已达上限' : ''}` : `${angle}°`}</output>
      </>}
    </div>

  </div>;
}

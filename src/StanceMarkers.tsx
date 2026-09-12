import { useRef, type CSSProperties, type PointerEvent } from 'react';
import { effectPosition, stancePosition, type Point } from './ability-geometry.mjs';
import type { Lineup } from './package-model.mjs';

export function StanceConnections({ lineups, activeId }: { lineups: Lineup[]; activeId?: string }) {
  return <svg className="stance-connections" viewBox="0 0 1000 1000" aria-hidden="true">
    {lineups.map((lineup) => {
      const stance = stancePosition(lineup), target = effectPosition(lineup);
      return stance ? <line key={lineup.id} data-lineup-id={lineup.id} className={lineup.id === activeId ? 'is-active' : ''}
        x1={stance.x * 1000} y1={stance.y * 1000} x2={target.x * 1000} y2={target.y * 1000} /> : null;
    })}
  </svg>;
}

type Props = {
  lineups: Lineup[]; activeId?: string; icon: string; editable: boolean; disabled: boolean;
  pointStyle: (point: Point) => CSSProperties;
  pointFromPointer: (x: number, y: number) => Point | null;
  onSelect: (id: string) => void;
  onMove: (id: string, point: Point) => void;
};

export default function StanceMarkers({ lineups, activeId, icon, editable, disabled, pointStyle, pointFromPointer, onSelect, onMove }: Props) {
  const drag = useRef<{ pointerId: number; lineupId: string; origin: Point; moved: boolean } | null>(null);

  function move(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    if (Math.hypot(event.clientX - current.origin.x, event.clientY - current.origin.y) < 3 && !current.moved) return;
    current.moved = true;
    const point = pointFromPointer(event.clientX, event.clientY);
    if (point) onMove(current.lineupId, point);
  }

  function end(event: PointerEvent<HTMLButtonElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    event.stopPropagation();
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return <>{lineups.map((lineup, index) => {
    const stance = stancePosition(lineup);
    return stance ? <button key={lineup.id} type="button" data-lineup-id={lineup.id} data-stance-marker
      className={`stance-pin ${lineup.id === activeId ? 'is-active' : ''} ${editable ? 'is-editable' : ''}`}
      style={pointStyle(stance)} disabled={disabled}
      aria-label={`方法 ${index + 1} 的站位：${lineup.title || '新增点位'}${editable ? '，可拖动' : ''}`}
      aria-pressed={lineup.id === activeId}
      onClick={(event) => { event.stopPropagation(); onSelect(lineup.id); }}
      onPointerDown={(event) => {
        event.stopPropagation();
        if (!editable || disabled || event.button !== 0) return;
        event.preventDefault();
        onSelect(lineup.id);
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerId: event.pointerId, lineupId: lineup.id, origin: { x: event.clientX, y: event.clientY }, moved: false };
      }}
      onPointerMove={move} onPointerUp={(event) => { move(event); end(event); }} onPointerCancel={end} onLostPointerCapture={end}>
      <img src={icon} alt="" draggable="false" />
      {lineups.length > 1 ? <b>{index + 1}</b> : null}
      <span className="stance-label">站位{lineups.length > 1 ? ` · 方法 ${index + 1}` : ''}</span>
    </button> : null;
  })}</>;
}

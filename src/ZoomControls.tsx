import { useState } from 'react';

export default function ZoomControls({ label, zoom, onZoom, onReset, max = 8 }: {
  label: string; zoom: number; onZoom: (zoom: number) => void; onReset: () => void; max?: number;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <div className="zoom-toolbar" data-zoom-controls aria-label={`${label}缩放`}>
      <button type="button" aria-label={`缩小${label}`} disabled={zoom <= 1} onClick={() => onZoom(zoom / 1.25)}>−</button>
      <input className="zoom-slider" aria-label={`${label}缩放滑条`} type="range" min={100} max={max * 100} step={1} value={Math.round(zoom * 100)} onChange={(event) => onZoom(Number(event.target.value) / 100)} />
      <button type="button" aria-label={`放大${label}`} disabled={zoom >= max} onClick={() => onZoom(zoom * 1.25)}>＋</button>
      <label className="zoom-percent">
        <input aria-label={`${label}放大倍率`} inputMode="numeric" type="number" min={100} max={max * 100} step={1}
          value={editing ?? Math.round(zoom * 100)}
          onFocus={() => setEditing(String(Math.round(zoom * 100)))}
          onChange={(event) => setEditing(event.target.value)}
          onBlur={() => { if (editing?.trim()) onZoom(Number(editing) / 100); setEditing(null); }}
          onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
        <span>%</span>
      </label>
      <button className="zoom-reset" type="button" aria-label={`重置${label}缩放`} onClick={onReset}>重置</button>
    </div>
  );
}

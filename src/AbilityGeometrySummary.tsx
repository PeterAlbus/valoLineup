import { geometryFor, pathDistance } from './ability-geometry.mjs';
import type { Lineup } from './package-model.mjs';
export default function AbilityGeometrySummary({ lineup }: { lineup: Lineup }) {
  const spec = geometryFor(lineup);
  if (!spec) return null;
  let text = '';
  if ('interaction' in spec && spec.interaction === 'path') {
    if (lineup.effect?.type === 'path') text = `路径 ${pathDistance(lineup.target, lineup.effect.points, lineup.mapId).toFixed(1)} 米${spec.maxDistance ? ` · 最多约 ${spec.maxDistance} 米` : ''}`;
    else if (spec.area) text = `${spec.area.label} · 半径 ${spec.area.radius} 米`;
  } else if ('shape' in spec && spec.shape === 'circle') text = `${spec.label} · 半径 ${spec.radius} 米`;
  else if (lineup.effect?.type === 'direction') text = 'label' in spec ? spec.label : '';
  if (!text) return null;
  return <p className="ability-summary">{text}<span>几何示意</span></p>;
}

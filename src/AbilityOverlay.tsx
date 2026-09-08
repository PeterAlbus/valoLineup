import { effectPosition, geometryFor, mapUnitsPerMeter, pathData, pathDistance, type DirectionSpec } from './ability-geometry.mjs';
import type { Lineup } from './package-model.mjs';

type Props = { lineup: Lineup };
const polar = (distance: number, angle: number) => `${distance * Math.cos(angle)},${distance * Math.sin(angle)}`;
function DirectionArea({ spec, unit }: { spec: DirectionSpec; unit: number }) {
  const length = spec.length * unit, width = spec.width * unit;
  if (spec.shape === 'cone' || spec.shape === 'vision-cone') {
    const range = spec.shape === 'vision-cone' ? 1500 : length;
    const half = spec.width * Math.PI / 360;
    return <path d={`M 0 0 L ${polar(range, -half)} A ${range} ${range} 0 ${spec.width > 180 ? 1 : 0} 1 ${polar(range, half)} Z`} />;
  }
  if (spec.shape === 'full-line') return <line x1={-1500} x2={1500} />;
  if (spec.shape === 'cross') return <><rect x={-length / 2} y={-width / 2} width={length} height={width} /><rect x={-width / 2} y={-length / 2} width={width} height={length} /></>;
  if (spec.shape === 'wall') return <rect x={-width / 2} y={-length / 2} width={width} height={length} />;
  if (spec.shape === 'double-wall') return <><line x2={length} y1={-width / 2} y2={-width / 2} /><line x2={length} y1={width / 2} y2={width / 2} /></>;
  if (spec.shape === 'line') return <line x2={length} />;
  return <rect y={-width / 2} width={length} height={width} />;
}
export default function AbilityOverlay({ lineup }: Props) {
  const spec = geometryFor(lineup);
  if (!spec) return null;
  const effect = lineup.effect;
  const unit = mapUnitsPerMeter[lineup.mapId] * 1000;
  const endpoint = effectPosition(lineup);
  const x = endpoint.x * 1000, y = endpoint.y * 1000;
  const area = 'shape' in spec && spec.shape === 'circle' ? spec : 'area' in spec ? spec.area : undefined;
  const direction = 'interaction' in spec && spec.interaction === 'direction' && effect?.type === 'direction';
  const pathSpec = 'interaction' in spec && spec.interaction === 'path' ? spec : undefined;
  const start = lineup.target;
  const hasPath = Boolean(pathSpec && effect?.type === 'path');
  if (!area && !direction && !hasPath) return null;
  const distance = effect?.type === 'path' ? pathDistance(start, effect.points, lineup.mapId) : 0;
  return <svg className="ability-overlay" viewBox="0 0 1000 1000" role="img" aria-label={`${lineup.title || '当前点位'}的技能范围${hasPath ? '与引导路径' : ''}`}>
    {area ? <circle className="ability-area" data-effect-shape="circle" cx={x} cy={y} r={area.radius * unit} /> : null}
    {direction ? <g className="ability-area" data-effect-shape={spec.shape} transform={`translate(${x},${y}) rotate(${effect.angle})`}>
      <DirectionArea spec={spec} unit={unit} />
      <path className="ability-direction" d="M 0 0 L 20 0 M 14 -4 L 20 0 L 14 4" />
    </g> : null}
    {effect?.type === 'path' && pathSpec ? <g data-effect-shape="path">
      <path className={`ability-path ${pathSpec.wall ? 'is-wall' : ''}`} d={pathData(start, effect.points)} />
      <title>{`引导距离 ${distance.toFixed(1)} 米，最大 ${pathSpec.maxDistance} 米`}</title>
    </g> : null}
  </svg>;
}

// Distances are metres on the unrotated map. Sources and geometric approximations:
// docs/valoplant-ability-interactions-research.md
export const mapUnitsPerMeter = Object.freeze({
  ascent: .007, bind: .0059, haven: .0075, split: .0078, icebox: .0072,
  breeze: .007, fracture: .0078, pearl: .0078, lotus: .0072, sunset: .0078,
  abyss: .0081, corrode: .007, summit: .0075,
});
const circle = (radius, label = '生效范围') => ({ shape: 'circle', radius, label });
const direction = (shape, length, width, label = '生效区域') => ({ interaction: 'direction', shape, length, width, label });
const guided = (maxDistance, area, wall = false) => ({ interaction: 'path', maxDistance, area, wall });
export const abilityGeometry = Object.freeze({
  astra: {
    'gravity-well': circle(4.75), 'nova-pulse': circle(4.75), 'nebula-dissipate': circle(4.75),
    'astral-form-cosmic-divide': direction('full-line', 0, .3, '宇宙分裂'),
  },
  breach: {
    aftershock: direction('rectangle', 10, 6), 'fault-line': direction('rectangle', 56, 8),
    'rolling-thunder': direction('rectangle', 32, 18),
  },
  brimstone: {
    'stim-beacon': circle(6), incendiary: circle(4.5), 'sky-smoke': circle(4.15), 'orbital-strike': circle(9),
  },
  chamber: { trademark: circle(10, '探测范围') },
  clove: { meddle: circle(4), ruse: circle(4.15) },
  cypher: { 'cyber-cage': circle(3.72) },
  deadlock: {
    'gravnet': circle(6.5), 'sonic-sensor': direction('rectangle', 9, 8, '探测范围'),
    'barrier-mesh': direction('cross', 20, .4, '阻域屏障'),
    annihilation: direction('rectangle', 40, 6),
  },
  fade: {
    seize: circle(6.58), haunt: circle(30, '侦查范围'), 'nightfall': direction('rectangle', 40, 20),
    prowler: guided(25),
  },
  gekko: {
    'mosh-pit': circle(6.2), wingman: direction('cone', 6, 65, '震荡范围'),
    dizzy: circle(45, '探测范围'), thrash: guided(67.32, circle(5)),
  },
  harbor: {
    'storm-surge': circle(6), cove: circle(4.6), 'high-tide': guided(60, undefined, true),
    reckoning: direction('rectangle', 34, 21),
  },
  iso: {
    contingency: direction('wall', 5.1, .4, '绝对屏障'), undercut: direction('rectangle', 34.875, 6),
    'kill-contract': direction('rectangle', 36, 15),
  },
  jett: { cloudburst: circle(3.35) },
  'kay-o': { 'frag-ment': circle(4), 'zero-point': circle(15, '侦查范围') },
  killjoy: {
    nanoswarm: circle(4.5), alarmbot: circle(5.5, '探测范围'),
    turret: direction('vision-cone', 0, 100, '探测方向'), lockdown: circle(32.5),
  },
  miks: { 'm-pulse': circle(5.5), waveform: circle(4.72), bassquake: direction('cone', 40, 60) },
  neon: { 'relay-bolt': circle(5), 'fast-lane': direction('double-wall', 46.5, 3.5, '高速通道') },
  omen: { 'dark-cover': circle(4.1), paranoia: direction('rectangle', 25, 8.6) },
  phoenix: { 'hot-hands': circle(4.5), blaze: guided(24, undefined, true) },
  raze: { 'paint-shells': circle(5.5), 'boom-bot': circle(6, '爆炸范围'), showstopper: circle(7) },
  sage: { 'slow-orb': circle(6.44), 'barrier-orb': direction('wall', 10.4, 1.5, '玉城') },
  skye: { regrowth: circle(18), trailblazer: guided(45, circle(3.5)), 'guiding-light': guided(36) },
  sova: { 'shock-bolt': circle(4), 'recon-bolt': circle(30, '侦查范围'), 'owl-drone': guided(31), 'hunters-fury': direction('rectangle', 66, 3.52) },
  tejo: { 'special-delivery': circle(5.25), 'guided-salvo': circle(4.5), 'stealth-drone': guided(30, circle(16, '侦查范围')), armageddon: direction('rectangle', 32, 12) },
  veto: { chokehold: circle(6.58), interceptor: circle(18, '拦截范围') },
  viper: { 'snake-bite': circle(4.5), 'poison-cloud': circle(4.5), 'toxic-screen': direction('line', 60, .3, '毒幕'), 'vipers-pit': circle(9) },
  vyse: { razorvine: circle(6.25), shear: direction('wall', 12, 1, '裁断'), 'steel-garden': circle(28) },
  waylay: { saturate: circle(6), 'convergent-paths': direction('rectangle', 36, 13.5) },
});
export function geometryFor(lineup) { return abilityGeometry[lineup.agentId]?.[lineup.abilityId]; }
export function effectPosition(lineup) { return lineup.effect?.type === 'path' ? lineup.effect.points.at(-1) : lineup.target; }
const distanceBetween = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
export function pathLength(start, points) {
  let length = 0, previous = start;
  for (const point of points) { length += distanceBetween(previous, point); previous = point; }
  return length;
}
export function pathDistance(start, points, mapId) {
  return pathLength(start, points) / mapUnitsPerMeter[mapId];
}
export function pathData(start, points) {
  return [start, ...points].map((point, index) => `${index ? 'L' : 'M'} ${point.x * 1000} ${point.y * 1000}`).join(' ');
}
export function tracePath(start, points, pointer, maxLength, tolerance) {
  const vertices = [start, ...points];
  const length = pathLength(start, points);
  let nearest = null, travelled = 0;
  for (let index = 0; index < vertices.length - 1; index++) {
    const a = vertices[index], b = vertices[index + 1];
    const segment = distanceBetween(a, b);
    if (!segment) continue;
    const t = Math.max(0, Math.min(1, ((pointer.x - a.x) * (b.x - a.x) + (pointer.y - a.y) * (b.y - a.y)) / (segment * segment)));
    const point = t === 0 ? a : t === 1 ? b : { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    const distance = distanceBetween(point, pointer);
    // At crossings, prefer the most recent part of the trace.
    if (!nearest || distance <= nearest.distance + 1e-10) nearest = { index, point, distance, progress: travelled + t * segment, t };
    travelled += segment;
  }
  const endpoint = vertices.at(-1), step = distanceBetween(endpoint, pointer);
  // Retrace locally along the tail; crossing an older loop must not erase it.
  if (nearest && nearest.distance <= tolerance && nearest.progress < length - 1e-6 && length - nearest.progress <= (step + tolerance) * 2) {
    const shortened = points.slice(0, nearest.index);
    if (nearest.t > 1e-6) shortened.push(nearest.point);
    return shortened;
  }
  const remaining = Math.max(0, maxLength - length);
  if (step < .0001 || remaining < 1e-9) return points;
  const fraction = Math.min(1, remaining / step);
  return [...points, fraction === 1 ? { ...pointer } : { x: endpoint.x + (pointer.x - endpoint.x) * fraction, y: endpoint.y + (pointer.y - endpoint.y) * fraction }];
}
export function effectError(lineup) {
  const effect = lineup.effect;
  if (!effect) return null;
  const spec = geometryFor(lineup);
  if (effect.type !== spec?.interaction) return '当前技能不支持这类范围设置';
  if (effect.type === 'path') {
    const distance = pathDistance(lineup.target, effect.points, lineup.mapId);
    if (!Number.isFinite(distance)) return '路径所属地图无法换算距离';
    if (distance < .1) return '路径长度至少为 0.1 米';
    if (spec.maxDistance && distance > spec.maxDistance + .02) return `路径超过最大引导距离 ${spec.maxDistance} 米`;
  }
  return null;
}
export function withEffect(lineup, effect) {
  const next = { ...lineup };
  if (effect) next.effect = effect; else delete next.effect;
  return next;
}

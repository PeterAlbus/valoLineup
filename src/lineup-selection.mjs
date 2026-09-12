import { effectPosition } from './ability-geometry.mjs';

export const DESTINATION_CLUSTER_DISTANCE = 0.0125;

// The reader's original normalized-map threshold is shared by both sidebar modes.
export function clusterDestinations(items) {
  const exact = new Map();
  for (const lineup of items) {
    const point = effectPosition(lineup);
    const key = `${lineup.target.groupId}@${point.x},${point.y}`;
    exact.set(key, [...(exact.get(key) ?? []), lineup]);
  }
  const destinations = [...exact.values()].map(lineups => {
    const point = effectPosition(lineups[0]);
    return { id: lineups[0].id, lineups, x: point.x, y: point.y };
  });
  const parents = destinations.map((_, index) => index);
  const find = index => parents[index] === index ? index : (parents[index] = find(parents[index]));
  for (let left = 0; left < destinations.length; left++) for (let right = left + 1; right < destinations.length; right++) {
    if (Math.hypot(destinations[left].x - destinations[right].x, destinations[left].y - destinations[right].y) <= DESTINATION_CLUSTER_DISTANCE) {
      const a = find(left), b = find(right);
      if (a !== b) parents[b] = a;
    }
  }
  const clusters = new Map();
  destinations.forEach((destination, index) => clusters.set(find(index), [...(clusters.get(find(index)) ?? []), destination]));
  return [...clusters.values()].map(cluster => ({
    id: cluster[0].id, memberIds: cluster.map(destination => destination.id), items: cluster.flatMap(destination => destination.lineups),
    x: cluster.reduce((sum, destination) => sum + destination.x, 0) / cluster.length,
    y: cluster.reduce((sum, destination) => sum + destination.y, 0) / cluster.length,
  }));
}

// Legacy group IDs remain readable, but never couple editing or movement.
export function editorDestinations(lineups) {
  return lineups.map(lineup => {
    const point = effectPosition(lineup);
    return { id: lineup.id, memberIds: [lineup.id], items: [lineup], x: point.x, y: point.y };
  });
}

export function moveIndependentTarget(lineups, id, point, makeGroupId = () => crypto.randomUUID()) {
  const selected = lineups.find(item => item.id === id);
  if (!selected || selected.effect?.type === 'path' || (selected.target.x === point.x && selected.target.y === point.y)) return lineups;
  const shared = lineups.some(item => item.id !== id && item.mapId === selected.mapId && item.target.groupId === selected.target.groupId);
  const target = { ...selected.target, ...point, groupId: shared ? makeGroupId() : selected.target.groupId };
  return lineups.map(item => item.id === id ? { ...item, target } : item);
}

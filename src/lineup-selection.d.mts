import type { Lineup } from './package-model.mjs';
import type { Point } from './ability-geometry.mjs';
export type Destination = { id: string; memberIds: string[]; items: Lineup[]; x: number; y: number };
export const DESTINATION_CLUSTER_DISTANCE: number;
export function clusterDestinations(lineups: Lineup[]): Destination[];
export function editorDestinations(lineups: Lineup[]): Destination[];
export function moveIndependentTarget(lineups: Lineup[], id: string, point: Point, makeGroupId?: () => string): Lineup[];

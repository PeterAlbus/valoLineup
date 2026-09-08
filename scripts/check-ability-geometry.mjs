import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { abilityGeometry, mapUnitsPerMeter, geometryFor, pathDistance, pathLength, tracePath, effectPosition, effectError, withEffect } from '../src/ability-geometry.mjs';
import { lineupSchema, manifestSchema, readPackage, applyLayers, collectChanges, same } from '../src/package-model.mjs';
const content = JSON.parse(await readFile(new URL('../src/data/content.json', import.meta.url), 'utf8'));
const near = (a, b) => assert(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
for (const map of content.maps) assert(mapUnitsPerMeter[map.id] > 0, `${map.id} scale`);
for (const [agentId, abilities] of Object.entries(abilityGeometry)) for (const abilityId of Object.keys(abilities)) {
  assert(content.agents.find((agent) => agent.id === agentId)?.abilities.some((ability) => ability.id === abilityId), `${agentId}/${abilityId} exists`);
}
for (const record of content.lineups) {
  assert(same(lineupSchema.parse(record), record), 'Existing records round-trip unchanged');
  geometryFor(record);
  assert(!Object.hasOwn(record, 'effect'), 'Rendering does not write geometry into content');
}
near(30 * mapUnitsPerMeter.ascent, .21);
near(30 * mapUnitsPerMeter.bind, .177);
const base = { ...content.lineups[0], id: 'geometry-check', agentId: 'harbor', abilityId: 'high-tide', target: { groupId: 'geometry-check-target', x: .5, y: .5 }, media: { stance: [], aim: [], effect: [] } };
const path = withEffect(base, { type: 'path', points: [{ x: .43, y: .5 }, { x: .43, y: .57 }] });
near(pathDistance(path.target, path.effect.points, 'ascent'), 20);
assert.equal(effectError(path), null);
assert(same(lineupSchema.parse(path), path));
assert.equal(Object.hasOwn(withEffect(path), 'effect'), false);
for (const effect of [
  { type: 'path', points: [{ x: -1, y: .5 }] },
  { type: 'path', points: [{ x: 0, y: 0 }] }, { type: 'path', points: [] }, { type: 'path', points: [{ x: .5, y: .5 }] },
  { type: 'direction', angle: 90 },
]) assert(!lineupSchema.safeParse(withEffect(base, effect)).success);
const direction = withEffect({ ...base, agentId: 'breach', abilityId: 'rolling-thunder' }, { type: 'direction', angle: 270 });
assert(same(lineupSchema.parse(direction), direction));
for (const angle of [-1, 360, Infinity, NaN]) assert(!lineupSchema.safeParse(withEffect(direction, { type: 'direction', angle })).success);
for (const record of [
  { ...base, agentId: 'omen', abilityId: 'shrouded-step' },
  { ...base, agentId: 'sova', abilityId: 'recon-bolt' },
  { ...base, agentId: 'cypher', abilityId: 'trapwire' },
]) { assert(lineupSchema.safeParse(record).success); assert(!lineupSchema.safeParse(withEffect(record, { type: 'direction', angle: 0 })).success); }
for (const version of [4, 5]) {
  const manifest = manifestSchema.parse({ format: 'valo-lineup-edit-package', version, packageId: crypto.randomUUID(), revision: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), author: base.uploader, changes: { added: [path], updated: [], ...(version === 5 ? { deleted: [] } : {}) }, uploadedAssets: [] });
  const zip = new JSZip(); zip.file('manifest.json', JSON.stringify(manifest));
  const restored = await readPackage(await zip.generateAsync({ type: 'uint8array' }));
  assert(same(restored.manifest.changes.added[0], path));
  const library = applyLayers([], [restored.manifest]);
  assert(same(library.lineups[0].effect, path.effect));
  const updated = { ...path, title: '保留引导路径的新标题' };
  const changes = collectChanges(null, library.lineups, [updated]);
  assert(same(changes.updated[0].after.effect, path.effect));
  const cleared = withEffect(path);
  assert(!Object.hasOwn(collectChanges(null, [path], [cleared]).updated[0].after, 'effect'));
}
console.log('Ability geometry checks passed: map scales, legacy records, bounded paths, optional fields and v4/v5 ZIP round-trips.');

assert.equal(geometryFor({agentId:'jett', abilityId:'cloudburst'}).shape, 'circle');
assert.equal(geometryFor({agentId:'tejo', abilityId:'stealth-drone'}).maxDistance, 30);
const drone = { ...base, agentId: 'tejo', abilityId: 'stealth-drone' };
assert.equal(effectError(withEffect(drone, {type:'path', points:[{x:.395,y:.5},{x:.395,y:.605}]})), null);
assert(effectError(withEffect(drone, {type:'path', points:[{x:.395,y:.5},{x:.395,y:.615}]})));

const origin = { x: .2, y: .2 }, limit = .2, tolerance = .002;
let trace = [];
for (const pointer of [{x:.25,y:.2},{x:.3,y:.23},{x:.32,y:.28}]) trace = tracePath(origin, trace, pointer, limit, tolerance);
assert.equal(trace.length, 3);
assert(pathLength(origin, trace) > Math.hypot(.12,.08), 'The budget follows the curve, including bends');
const curved = trace;
trace = tracePath(origin, trace, {x:.6,y:.3}, limit, tolerance);
near(pathLength(origin, trace), limit);
assert(trace.at(-1).x < .6, 'An overshooting pointer stops exactly at the distance limit');
const capped = trace;
assert.deepEqual(tracePath(origin, trace, {x:.7,y:.4}, limit, tolerance), capped);
trace = tracePath(origin, trace, {x:.3,y:.23}, limit, tolerance);
assert.deepEqual(trace, curved.slice(0, 2), 'Returning along the trace removes its tail');
trace = tracePath(origin, trace, {x:.3,y:.18}, limit, tolerance);
assert.deepEqual(trace.at(-1), {x:.3,y:.18}, 'Retracting restores budget for a new direction');
assert.deepEqual(tracePath(origin, trace, origin, limit, tolerance), [], 'Retracing all the way removes the path');
const partial = tracePath(origin, [{x:.3,y:.2}], {x:.26,y:.201}, limit, tolerance);
near(partial.at(-1).x, .26); near(partial.at(-1).y, .2);
const nearCrossing = [{x:.3,y:.2},{x:.3,y:.3},{x:.2,y:.3},{x:.2,y:.2},{x:.25,y:.2}];
assert.equal(tracePath(origin, nearCrossing, {x:.22,y:.2}, 1, tolerance).length, 5, 'Retracing a crossing uses the most recent matching segment');
assert.deepEqual(effectPosition(path), path.effect.points.at(-1));
assert(lineupSchema.safeParse(withEffect(base, {type:'path', points:[{x:.55,y:.5},{x:.55,y:.55},{x:.5,y:.5}]})).success, 'A curved route may return to its origin while using movement distance');
console.log('PASS curved distance budget, exact cap, backward trimming, renewed drawing and crossing selection');

const loop = [{x:.3,y:.2},{x:.3,y:.3},{x:.2,y:.3},{x:.2,y:.21}];
const closedLoop = tracePath(origin, loop, origin, 1, tolerance);
assert.equal(closedLoop.length, 5, 'Crossing an older part while drawing keeps the existing curve');
near(pathLength(origin, closedLoop), .4);

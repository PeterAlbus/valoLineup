import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import JSZip from 'jszip';
import { clusterDestinations, DESTINATION_CLUSTER_DISTANCE, editorDestinations, moveIndependentTarget } from '../src/lineup-selection.mjs';
import { collectChanges, manifestSchema } from '../src/package-model.mjs';
import { makeLineups } from './fixtures/lineups.mjs';
import { makeContentFixture, writeContentFixture } from './fixtures/content.mjs';

const base = makeLineups();
const selected = base[0];
const grouped = base.filter(item => item.mapId === selected.mapId && item.target.groupId === selected.target.groupId);
assert(grouped.length > 1);
assert.deepEqual(editorDestinations(grouped).map(item => item.items.length), grouped.map(() => 1), 'Even legacy shared coordinates are independent in edit mode');
assert.strictEqual(moveIndependentTarget(base, selected.id, selected.target), base, 'A click cannot dirty the library or allocate a group');
const moved = moveIndependentTarget(base, selected.id, { x: .63, y: .54 }, () => 'detached-fixture-target');
assert.equal(moved[0].target.groupId, 'detached-fixture-target');
assert.deepEqual(moved.slice(1), base.slice(1), 'Moving one member preserves every other lineup exactly');
assert.equal(collectChanges(null, base, moved).updated.length, 1);
const twice = moveIndependentTarget(moved, selected.id, { x: .7, y: .6 }, () => assert.fail('Do not keep reallocating group IDs'));
assert.equal(twice[0].target.groupId, moved[0].target.groupId);
const independent = base.find(item => item.id === 'test-independent');
assert.equal(moveIndependentTarget(base, independent.id, { x: .4, y: .6 }, () => assert.fail())[base.indexOf(independent)].target.groupId, independent.target.groupId);
const paths = [{ ...selected, abilityId: 'owl-drone', effect: { type: 'path', points: [{ x: .4, y: .3 }] } }, ...base.slice(1)];
assert.strictEqual(moveIndependentTarget(paths, selected.id, { x: .6, y: .6 }), paths, 'Only the path-owning lineup is locked');
assert.equal(editorDestinations(paths)[0].x, .4);
assert.equal(moveIndependentTarget(paths, paths[1].id, { x: .6, y: .6 }, () => 'sibling-detached')[1].target.x, .6, 'A sibling path cannot lock another lineup');
const near = grouped.map((item, i) => ({ ...item, target: { groupId: `independent-${i}`, x: i * DESTINATION_CLUSTER_DISTANCE * .9, y: .5 } }));
assert.equal(clusterDestinations(near).length, 1, 'Sidebar uses the original transitive proximity clustering, regardless of group IDs');
assert.equal(editorDestinations(near).length, near.length, 'Proximity only groups the sidebar, never editor map markers');
const boundary = [near[0], { ...near[1], target: { ...near[1].target, x: DESTINATION_CLUSTER_DISTANCE } }];
assert.equal(clusterDestinations(boundary).length, 1, 'The reader threshold includes its boundary');
boundary[1].target.x += .000001;
assert.equal(clusterDestinations(boundary).length, 2, 'Just outside the same threshold stays separate');
const originalTarget = structuredClone(selected.target);
assert.equal(clusterDestinations(grouped).length, 1);
assert.deepEqual(selected.target, originalTarget, 'Clustering never modifies actual coordinates');

const root = await mkdtemp(path.join(os.tmpdir(), 'valo-independent-target-'));
try {
  await writeContentFixture(root, makeContentFixture(base));
  const manifest = manifestSchema.parse({ format: 'valo-lineup-edit-package', version: 4, packageId: crypto.randomUUID(), revision: 1,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', author: selected.uploader,
    changes: collectChanges(null, base, moved), uploadedAssets: [] });
  assert.deepEqual(manifest.changes.updated[0].before, selected, 'Original legacy before snapshot is preserved');
  const zip = new JSZip(); zip.file('manifest.json', JSON.stringify(manifest));
  const file = path.join(root, 'independent-edit.zip'); await writeFile(file, await zip.generateAsync({ type: 'nodebuffer' }));
  const run = promisify(execFile);
  const result = await run(process.execPath, [path.resolve('scripts/import-edit-package.mjs'), file], { cwd: root });
  assert.match(result.stdout, /Imported 0 new and 1 updated/);
  assert(!result.stderr.includes('共享落点'));
  const content = JSON.parse(await readFile(path.join(root, 'src/data/content.json'), 'utf8'));
  assert.deepEqual(content.lineups, moved);
  assert.deepEqual(content.history.at(-1).lineupIds, [selected.id]);
  assert.match((await run(process.execPath, [path.resolve('scripts/import-edit-package.mjs'), file], { cwd: root })).stdout, /Already applied/);
  console.log('Sidebar grouping passed: shared viewer threshold, independent map markers, single-record movement, stable identities, no-op clicks, path isolation and compatible CLI import/idempotency.');
} finally { await rm(root, { recursive: true, force: true }); }

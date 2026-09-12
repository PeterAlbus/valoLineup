import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import JSZip from 'jszip';
import sharp from 'sharp';
import { buildContent } from './content-model.mjs';
import { makeLineup } from './fixtures/lineups.mjs';
import { makeContentFixture, writeContentFixture } from './fixtures/content.mjs';
import { allMedia, allAssets, compactPackage, compressPackage, manifestSchema, readPackage, resolvePackageReferences, retainFailedChanges, sha256 } from '../src/package-model.mjs';

const run = promisify(execFile);
const root = await mkdtemp(path.join(os.tmpdir(), 'valo-image-references-'));
const importer = path.resolve('scripts/import-edit-package.mjs');
async function zipBytes(data) {
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(data.manifest));
  for (const asset of data.manifest.uploadedAssets) zip.file(asset.key, await data.blobs.get(asset.sha256).arrayBuffer());
  return zip.generateAsync({ type: 'nodebuffer' });
}
try {
  const before = makeLineup({ media: { stance: [{ key: 'lineups/test-primary/stance.webp', alt: '站位' }], aim: [{ key: 'lineups/test-primary/aim.webp', alt: '瞄点' }], effect: [] } });
  await writeContentFixture(root, makeContentFixture([before]));
  const content = await buildContent(root, { quiet: true });
  const after = { ...before, title: '改名但未改图片', side: 'defense', instructions: '仅修改文字' };
  const uploadedAssets = allMedia([after]).map(item => ({ ...item, ...content.mediaAssets[item.key] }));
  const blobs = new Map();
  for (const asset of uploadedAssets) blobs.set(asset.sha256, new Blob([await readFile(path.join(root, 'public', asset.key))], { type: asset.mimeType }));
  const legacy = { manifest: manifestSchema.parse({
    format: 'valo-lineup-edit-package', version: 4, packageId: randomUUID(), revision: 1,
    author: { name: 'Reference Test', source: 'local' }, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    changes: { added: [], updated: [{ id: before.id, before, after }] }, uploadedAssets,
  }), blobs };
  assert.equal((await readPackage(await zipBytes(legacy))).manifest.version, 4, 'Full v4 images remain supported');
  const compact = compactPackage(legacy, content.mediaAssets);
  assert.equal(compact.manifest.version, 6);
  assert.equal(compact.manifest.uploadedAssets.length, 0);
  assert.deepEqual(compact.manifest.referencedAssets, uploadedAssets);
  assert.deepEqual(compact.manifest.changes, legacy.manifest.changes, 'Snapshots/IDs/alt/order are unchanged');
  const bytes = await zipBytes(compact);
  assert.deepEqual(Object.keys((await JSZip.loadAsync(bytes)).files), ['manifest.json'], 'Text-only ZIP contains no image bytes');
  const unresolved = await readPackage(bytes);
  assert.equal(unresolved.blobs.size, 0);
  const resolved = await resolvePackageReferences(unresolved, async asset => blobs.get(asset.sha256));
  assert.equal(resolved.blobs.size, blobs.size);
  assert.equal((await compressPackage(resolved, () => assert.fail('Must not re-encode built-in WebP'))).blobs.size, blobs.size);
  assert.deepEqual(compactPackage(resolved, {}).manifest.uploadedAssets, uploadedAssets, 'Cached references become carried images when no longer built in');

  const local = structuredClone(legacy.manifest);
  const localAsset = { ...uploadedAssets[0], key: 'lineups/test-primary/local.webp' };
  local.changes.updated[0].after.media.stance[0].key = localAsset.key;
  local.uploadedAssets[0] = localAsset;
  assert.deepEqual(compactPackage({ manifest: local, blobs }, content.mediaAssets).manifest.uploadedAssets, [localAsset], 'Images unavailable in lower layers must be carried');
  assert.equal(compactPackage({ manifest: local, blobs }, content.mediaAssets, [localAsset]).manifest.uploadedAssets.length, 0, 'Unchanged images from other local packages must be referenced, not carried');
  assert.equal(compactPackage({ manifest: local, blobs }, content.mediaAssets, [{ ...localAsset, sha256: 'f'.repeat(64) }, localAsset]).manifest.uploadedAssets.length, 0, 'A matching version in any local layer is reusable');
  const changedAsset = { ...uploadedAssets[0], sha256: '0'.repeat(64) };
  const replaced = structuredClone(legacy.manifest);
  replaced.uploadedAssets[0] = changedAsset;
  assert.deepEqual(compactPackage({ manifest: replaced, blobs }, content.mediaAssets).manifest.uploadedAssets, [changedAsset], 'Same key with different bytes must not be omitted');
  for (const edit of [
    m => { m.version = 4; },
    m => { m.referencedAssets.pop(); },
    m => { m.uploadedAssets.push(m.referencedAssets[0]); },
    m => { m.referencedAssets[0].key = 'lineups/test-primary/../secret.webp'; },
    m => { m.referencedAssets[0].alt = 'wrong'; },
    m => { m.referencedAssets[0].mimeType = 'image/png'; },
  ]) { const malformed = structuredClone(compact.manifest); edit(malformed); assert.throws(() => manifestSchema.parse(malformed)); }
  await assert.rejects(resolvePackageReferences(unresolved, async () => { throw new Error('missing'); }), /missing/);
  const original = new Uint8Array(await blobs.get(uploadedAssets[0].sha256).arrayBuffer());
  const damaged = original.slice(); damaged[damaged.length - 1] ^= 1;
  await assert.rejects(resolvePackageReferences(unresolved, async () => new Blob([damaged], { type: 'image/webp' })), /引用图片内容不匹配/);

  const archive = path.join(root, 'text-only.zip');
  await writeFile(archive, bytes);
  const imported = await run(process.execPath, [importer, archive], { cwd: root });
  assert.match(imported.stdout, /Imported 0 new and 1 updated lineups with 0 images/);
  const applied = JSON.parse(await readFile(path.join(root, 'src/data/content.json'), 'utf8'));
  assert.deepEqual(applied.lineups, [after]);
  assert.deepEqual(applied.mediaAssets, content.mediaAssets);
  assert.equal(applied.history.length, 1);
  assert.match((await run(process.execPath, [importer, archive], { cwd: root })).stdout, /Already applied/);
  const protectedPaths = ['content/lineups.yaml', 'content/history.json', 'src/data/content.json'];
  const snapshot = await Promise.all(protectedPaths.map(file => readFile(path.join(root, file), 'utf8')));
  const assertUnchanged = async () => assert.deepEqual(await Promise.all(protectedPaths.map(file => readFile(path.join(root, file), 'utf8'))), snapshot);
  const imagePath = path.join(root, 'public', uploadedAssets[0].key);
  await writeFile(imagePath, damaged);
  await assert.rejects(run(process.execPath, [importer, archive], { cwd: root }), /引用图片内容不匹配/);
  await assertUnchanged();
  await rm(imagePath);
  await assert.rejects(run(process.execPath, [importer, archive], { cwd: root }), /引用图片缺失/);
  await assertUnchanged();
  await writeFile(imagePath, original);

  // A mixed v6 package carries only the new image while reusing both existing images.
  const fresh = await sharp({ create: { width: 7, height: 5, channels: 3, background: '#774488' } }).webp().toBuffer();
  const mixed = structuredClone(compact.manifest);
  mixed.packageId = randomUUID();
  mixed.changes.updated[0].before = after;
  mixed.changes.updated[0].after.instructions = '新增一张图';
  const newAsset = { key: 'lineups/test-primary/new.webp', alt: '新图', lineupId: before.id, kind: 'effect', mimeType: 'image/webp', size: fresh.length, sha256: await sha256(fresh) };
  mixed.changes.updated[0].after.media.effect.push({ key: newAsset.key, alt: newAsset.alt });
  mixed.uploadedAssets.push(newAsset);
  const mixedData = { manifest: manifestSchema.parse(mixed), blobs: new Map([[newAsset.sha256, new Blob([fresh], { type: 'image/webp' })]]) };
  const mixedPath = path.join(root, 'mixed.zip');
  await writeFile(mixedPath, await zipBytes(mixedData));
  assert.match((await run(process.execPath, [importer, mixedPath], { cwd: root })).stdout, /with 1 images/);
  assert.deepEqual(await readFile(path.join(root, 'public', newAsset.key)), fresh);
  assert.equal(allAssets(mixed).length, uploadedAssets.length + 1);
  const healthy = makeLineup({ id: 'test-healthy', title: '不依赖缺失图片的点位' });
  const unavailable = { ...uploadedAssets[0], key: 'lineups/test-primary/missing.webp' };
  const partial = { ...structuredClone(compact.manifest), packageId: randomUUID(),
    changes: { added: [healthy], updated: [{ id: before.id, before: mixed.changes.updated[0].after, after: { ...after, title: '待补图后更新', media: { stance: [{ key: unavailable.key, alt: unavailable.alt }], aim: [], effect: [] } } }] },
    referencedAssets: [unavailable] };
  const partialBytes = await zipBytes({ manifest: manifestSchema.parse(partial), blobs: new Map() });
  const partialData = await resolvePackageReferences(await readPackage(partialBytes), async () => { throw new Error('引用图片缺失'); });
  assert.deepEqual(partialData.manifest.changes.added, [healthy]);
  assert.deepEqual(partialData.manifest.changes.updated, []);
  assert.equal(partialData.failures[0].lineupId, before.id);
  assert.equal(allAssets(partialData.manifest).length, 0, 'Rejected lineup images must not enter storage');
  const previous = { ...legacy.manifest, packageId: partial.packageId };
  const retained = retainFailedChanges(partialData, previous);
  assert.deepEqual(retained.manifest.changes.updated, previous.changes.updated, 'A failed revision keeps the previous package operation and its images');
  assert.deepEqual(retained.manifest.uploadedAssets, previous.uploadedAssets);
  assert.deepEqual(retained.manifest.changes.added, [healthy]);
  // Missing/corrupt embedded files also fail per lineup, including old v4 packages.
  for (const corrupt of [false, true]) {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({ ...partial, version: 4, uploadedAssets: [unavailable], referencedAssets: undefined }));
    if (corrupt) zip.file(unavailable.key, damaged);
    const read = await readPackage(await zip.generateAsync({ type: 'nodebuffer' }));
    assert.deepEqual(read.manifest.changes.added, [healthy]);
    assert.equal(read.manifest.changes.updated.length, 0);
    assert.equal(read.failures.length, 1);
    assert.equal((await compressPackage(read, () => assert.fail())).failures.length, 1, 'Failure reports survive compression');
  }
  const partialPath = path.join(root, 'partial.zip');
  await writeFile(partialPath, partialBytes);
  const partialResult = await run(process.execPath, [importer, partialPath], { cwd: root });
  assert.match(partialResult.stdout, /Imported 1 new and 0 updated/);
  assert.match(partialResult.stderr, /引用图片缺失/);
  let state = JSON.parse(await readFile(path.join(root, 'src/data/content.json'), 'utf8'));
  assert.deepEqual(state.lineups.find(item => item.id === before.id), mixed.changes.updated[0].after, 'Missing-image lineup retains its existing repository state');
  assert.deepEqual(state.history.at(-1).lineupIds, [healthy.id], 'History records only successfully imported lineups');
  await writeFile(path.join(root, 'public', unavailable.key), original);
  assert.match((await run(process.execPath, [importer, partialPath], { cwd: root })).stdout, /Imported 0 new and 1 updated/);
  state = JSON.parse(await readFile(path.join(root, 'src/data/content.json'), 'utf8'));
  assert.deepEqual(state.lineups.find(item => item.id === before.id), partial.changes.updated[0].after);
  console.log('Image references passed: text-only/mixed ZIP, reuse across local layers, v4 compatibility, per-lineup missing/corrupt skips, retained prior revisions, CLI history and retry after dependencies arrive.');
} finally { await rm(root, { recursive: true, force: true }); }

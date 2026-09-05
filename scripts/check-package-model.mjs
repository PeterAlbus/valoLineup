import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { manifestSchema, applyLayers, readPackage, validateReferences, same } from '../src/package-model.mjs';

// Do not rewrite the frozen fixture when evolving the format: retain a v4 reader/migration instead.
const fixture = JSON.parse(await readFile(new URL('./fixtures/edit-package-v4.json', import.meta.url), 'utf8'));
const content = JSON.parse(await readFile('src/data/content.json', 'utf8'));
assert.doesNotThrow(() => manifestSchema.parse(fixture));
validateReferences(fixture, content.maps, content.agents);
const zip = new JSZip(); zip.file('manifest.json', JSON.stringify(fixture));
assert.deepEqual((await readPackage(await zip.generateAsync({ type: 'nodebuffer' }))).manifest, fixture);
const record = fixture.changes.added[0];
const second = { ...fixture, packageId: '51c97927-e38a-4598-907d-876d7c1b12eb', changes: { added: [], updated: [{ id: record.id, before: record, after: { ...record, instructions: 'second' } }] } };
assert.equal(applyLayers([], [second]).lineups[0].instructions, 'second', 'Browser updates must upsert absent IDs');
assert.equal(applyLayers([], [fixture, second]).lineups[0].instructions, 'second');
assert.equal(applyLayers([], [second, fixture]).lineups[0].instructions, record.instructions);
assert.equal(applyLayers([], [fixture, second], fixture).lineups[0].instructions, record.instructions);
assert.equal(manifestSchema.parse({ ...fixture, extraMetadata: { example: true } }).extraMetadata.example, true, 'Optional metadata must round-trip');
assert(same({ a: 1, nested: { b: 2, c: 3 } }, { nested: { c: 3, b: 2 }, a: 1 }));
assert.throws(() => manifestSchema.parse({ ...fixture, version: 3 }));
assert.throws(() => manifestSchema.parse({ ...fixture, changes: { ...fixture.changes, added: [record, record] } }));
assert.throws(() => manifestSchema.parse({ ...second, changes: { added: [], updated: [{ ...second.changes.updated[0], id: 'different-id' }] } }));
assert.throws(() => manifestSchema.parse({ ...fixture, changes: { added: [{ ...record, media: { ...record.media, aim: [{ key: `lineups/${record.id}/../bad.png`, alt: 'bad' }] } }], updated: [] } }));
assert.throws(() => manifestSchema.parse({ ...fixture, changes: { added: [{ ...record, media: { ...record.media, aim: [{ key: `lineups/${record.id}/missing.png`, alt: 'missing' }] } }], updated: [] } }));
console.log('Package model checks passed: frozen v4 fixture, layer semantics, IDs, paths and complete image declarations.');

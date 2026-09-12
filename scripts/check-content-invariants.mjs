import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assertGeneratedContent } from './content-assertions.mjs';
import { buildContent, validateContent } from './content-model.mjs';
import { makeLineup, makeLineups } from './fixtures/lineups.mjs';
import { makeContentFixture, writeContentFixture } from './fixtures/content.mjs';

const root = await mkdtemp(path.join(os.tmpdir(), 'valo-content-invariants-'));
try {
  const ordinary = makeLineup();
  const variants = [
    [], [ordinary], makeLineups().reverse(),
    Array.from({ length: 12 }, (_, i) => makeLineup({ id: `variant-${i}`, title: `改名 ${i}`, uploader: { name: `作者 ${i}`, source: 'local' }, stance: { x: .2, y: .3 }, extension: { future: true } })),
    [makeLineup({ media: { stance: [], aim: [{ key: 'lineups/test-primary/aim.webp', alt: '独立图片' }], effect: [] } })],
  ];
  for (const lineups of variants) {
    const source = makeContentFixture(lineups);
    source.history = [{ id: 'fixture-history', packageId: 'f2c6cc57-dfe9-4b0d-877b-fd6dd2e98fe4', revision: 1,
      appliedAt: '2026-01-01T00:00:00.000Z', author: { name: 'History Author', source: 'local' },
      mapIds: ['ascent'], lineupIds: ['previously-deleted-id'], added: 0, updated: 0, deleted: 1 }];
    await writeContentFixture(root, source);
    await buildContent(root, { quiet: true });
    const generated = await assertGeneratedContent(root);
    assert.deepEqual(generated.lineups, lineups, 'Empty, resized, reordered and extended libraries retain exact records');
  }
  const generatedPath = path.join(root, 'src/data/content.json');
  const good = JSON.parse(await readFile(generatedPath, 'utf8'));
  for (const broken of [
    { ...good, lineups: [] },
    { ...good, lineups: [...good.lineups, good.lineups[0]] },
    { ...good, lineups: [{ ...good.lineups[0], instructions: '内容丢失' }] },
    { ...good, mediaBytes: {} },
    { ...good, history: [] },
  ]) {
    await writeFile(generatedPath, JSON.stringify(broken));
    await assert.rejects(assertGeneratedContent(root), /Generated content must preserve/);
  }
  await writeFile(generatedPath, JSON.stringify(good));
  await rm(path.join(root, 'public', good.lineups[0].media.aim[0].key));
  await assert.rejects(assertGeneratedContent(root), /ENOENT/);
  for (const lineups of [
    [ordinary, ordinary],
    [makeLineup({ mapId: 'unknown-map' })],
    [makeLineup({ agentId: 'unknown-agent' })],
    [makeLineup({ abilityId: 'unknown-ability' })],
    [makeLineup({ videoBvid: 'https://www.bilibili.com/video/BV17x411w7KC' })],
    [makeLineup({ target: { groupId: 'invalid', x: -1, y: .5 } })],
    [ordinary, makeLineup({ id: 'conflicting-group', target: { ...ordinary.target, x: .6 } })],
  ]) await assert.rejects(validateContent(makeContentFixture(lineups), { verifyAssets: false }));
  await validateContent(makeContentFixture(makeLineups()), { verifyAssets: false }); // Same group ID across maps is valid.
  console.log('Content invariants passed: changing counts/authors/order/optional fields and empty libraries are valid; lost records, invalid references, conflicts and missing images fail.');
} finally { await rm(root, { recursive: true, force: true }); }

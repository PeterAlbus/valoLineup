import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const content = JSON.parse(await readFile('app/data/content.json', 'utf8'));
const report = JSON.parse(await readFile('content/import-report.json', 'utf8'));
const groupIds = new Set(content.lineups.map((lineup) => lineup.target.groupId));
const media = content.lineups.flatMap((lineup) => [
  ...lineup.media.stance,
  ...lineup.media.aim,
  ...lineup.media.effect,
]);

assert.equal(content.maps.length, 3, 'Expected the three maps represented by the source notes');
assert.equal(content.agents.length, 1, 'Expected the source agent, Sova');
assert.equal(content.lineups.length, 26, 'Every bullet lineup in the Markdown must be imported');
assert.equal(groupIds.size, 22, 'Similar destinations must resolve into 22 selectable map positions');
assert.equal(content.lineups.filter((lineup) => lineup.target.groupId === 'a-site-scan').length, 3, 'A-site scan destination must offer three methods');
assert.equal(media.length, 39, 'Every locally available image referenced by a complete lineup must be preserved');
assert.ok(media.every((item) => item.src.startsWith('/') && !item.src.startsWith('//')), 'Runtime media must be local');
assert.ok(content.lineups.every((lineup) => lineup.target.x >= 0 && lineup.target.x <= 1 && lineup.target.y >= 0 && lineup.target.y <= 1), 'Target coordinates must be normalized');
assert.equal(report.importedLineups, 26);
assert.equal(report.orphanImages.length, 3, 'Three unstructured images must remain visible in the import report');
assert.equal(report.orphanImages.filter((item) => !item.available).length, 2, 'Two Windows-only Typora images remain unavailable');
assert.equal(report.suspiciousHeadings.length, 1, 'The malformed Haven heading must be reported');

console.log('Content checks passed: 26 lineups, 22 destinations, 39 media files.');

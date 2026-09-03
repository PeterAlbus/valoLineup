import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { lineupsSchema } from './content-model.mjs';

const content = JSON.parse(await readFile('src/data/content.json', 'utf8'));
const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
const groupIds = new Set(content.lineups.map((lineup) => lineup.target.groupId));
const media = content.lineups.flatMap((lineup) => [
  ...lineup.media.stance,
  ...lineup.media.aim,
  ...lineup.media.effect,
]);

assert.equal(content.maps.length, 13, 'Every released standard Spike map must be available');
assert.equal(content.maps.flatMap((map) => map.sites).length, 28, 'The map library must include every A/B/C plant site');
assert.deepEqual(content.maps.filter((map) => map.sites.length === 3).map((map) => map.id).sort(), ['haven', 'lotus']);
assert.equal(content.maps.find((map) => map.id === 'summit')?.name, '天枢云阙');
assert.equal(content.maps.find((map) => map.id === 'corrode')?.name, '盐海矿镇');
assert.ok(content.maps.every((map) => map.spawns.attack.labelPosition && map.spawns.defense.labelPosition), 'Every map must expose both spawn label positions');
assert.ok(content.maps.flatMap((map) => map.sites).every((site) => site.region.width > 0 && site.region.height > 0), 'Every plant site must occupy a visible region');
assert.ok(content.maps.flatMap((map) => Object.values(map.spawns)).every((spawn) => spawn.labelPosition.x >= 0 && spawn.labelPosition.x <= 1 && spawn.labelPosition.y >= 0 && spawn.labelPosition.y <= 1), 'Every spawn label position must be normalized');
assert.ok(content.maps.flatMap((map) => Object.values(map.perspectives)).every((view) => [-90, 0, 90, 180].includes(view.rotation)), 'Every map perspective must use a cardinal rotation');
assert.ok(content.maps.every((map) => Math.abs(map.perspectives.attack.rotation - map.perspectives.defense.rotation) === 180), 'Attack and defense perspectives must face opposite directions');
assert.ok(content.maps.every((map) => ['attack', 'defense'].every((side) => {
  const point = map.spawns[side].labelPosition;
  const radians = map.perspectives[side].rotation * Math.PI / 180;
  const rotatedY = 0.5 + (point.x - 0.5) * Math.sin(radians) + (point.y - 0.5) * Math.cos(radians);
  return rotatedY > 0.5;
})), 'The active-side spawn label must remain in the lower half of its perspective');
assert.ok(content.maps.every((map) => map.imageHiRes.startsWith('maps/hires/')), 'Every map must expose a deployable relative high-resolution image');
const ascent = content.maps.find((map) => map.id === 'ascent');
assert.ok(ascent.sites.find((site) => site.label === 'A').region.y < 0.5, 'Ascent A site must remain in the upper half of the raw map');
assert.ok(ascent.sites.find((site) => site.label === 'B').region.y > 0.5, 'Ascent B site must remain in the lower half of the raw map');
assert.ok(content.maps.find((map) => map.id === 'sunset').sites.find((site) => site.label === 'B').region.x > 0.1, 'Sunset B site region must align with the plant-zone tint');
assert.ok(content.maps.find((map) => map.id === 'summit').spawns.attack.labelPosition.x > 0.4, 'Summit attacker spawn label must align with the bottom-center map geometry');
assert.equal(content.agents.length, 29, 'The Riot 13.04 catalog must provide every current playable agent');
assert.equal(content.agents.flatMap((agent) => agent.abilities).length, 118, 'Every current agent ability in the Riot catalog must be available');
assert.equal(content.agents.find((agent) => agent.id === 'miks')?.name, '迷核');
assert.equal(content.agents.find((agent) => agent.id === 'veto')?.name, '禁灭');
assert.ok(content.agents.every((agent) => agent.abilities.length >= 4), 'Every agent must expose all active abilities');
assert.ok(content.agents.every((agent) => agent.icon.endsWith('.webp') && agent.abilities.every((ability) => ability.icon.endsWith('.webp'))), 'Agent media must use local optimized WebP assets');
assert.equal(content.lineups.length, 26, 'The local metadata must preserve every existing lineup');
assert.ok(content.lineups.every((lineup) => lineup.videoBvid === ''), 'Every existing lineup must store an empty Bilibili BVID');
assert.doesNotThrow(() => lineupsSchema.parse([{ ...content.lineups[0], videoBvid: 'BV17x411w7KC' }]));
assert.throws(() => lineupsSchema.parse([{ ...content.lineups[0], videoBvid: 'https://www.bilibili.com/video/BV17x411w7KC' }]));
assert.ok(content.maps.every((map) => !map.image.startsWith('/') && !map.imageHiRes.startsWith('/')), 'Map assets must be relative to the static site base');
assert.ok(content.agents.every((agent) => !agent.icon.startsWith('/') && agent.abilities.every((ability) => !ability.icon.startsWith('/'))), 'Agent assets must be relative to the static site base');
assert.ok(content.lineups.every((lineup) => !('source' in lineup)), 'Runtime records must not retain Markdown provenance');
assert.equal(groupIds.size, 22, 'Similar destinations must resolve into 22 selectable map positions');
assert.equal(content.lineups.filter((lineup) => lineup.target.groupId === 'a-site-scan').length, 3, 'A-site scan destination must offer three methods');
assert.ok(content.lineups.filter((lineup) => lineup.target.groupId.startsWith('a-')).every((lineup) => lineup.target.y < 0.5), 'Imported Ascent A destinations must use raw map orientation');
assert.ok(content.lineups.filter((lineup) => lineup.target.groupId.startsWith('b-')).every((lineup) => lineup.target.y > 0.5), 'Imported Ascent B destinations must use raw map orientation');
assert.equal(media.length, 39, 'Every locally available image referenced by a complete lineup must be preserved');
assert.ok(media.every((item) => item.key.startsWith('lineups/') && !item.key.includes('..')), 'Runtime media must use safe logical asset keys');
assert.ok(content.lineups.every((lineup) => lineup.target.x >= 0 && lineup.target.x <= 1 && lineup.target.y >= 0 && lineup.target.y <= 1), 'Target coordinates must be normalized');
assert.ok([...groupIds].every((groupId) => {
  const targets = content.lineups.filter((lineup) => lineup.target.groupId === groupId).map((lineup) => lineup.target);
  return targets.every((target) => target.x === targets[0].x && target.y === targets[0].y);
}), 'Every shared destination group must use one exact coordinate');
assert.equal(packageJson.scripts['content:import'], 'node scripts/import-markdown.mjs', 'Markdown import must remain an explicit command');
assert.equal(packageJson.scripts['content:import-edits'], 'node scripts/import-edit-package.mjs', 'Edit packages must have one explicit repository import command');
assert.ok(['predev', 'prebuild', 'test'].every((name) => !packageJson.scripts[name].includes('content:import')), 'Normal development and builds must never import Markdown');

console.log('Content checks passed: 26 lineups, 22 destinations, 39 media files.');

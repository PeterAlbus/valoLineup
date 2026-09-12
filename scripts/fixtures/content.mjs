import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { stringify } from 'yaml';
import sharp from 'sharp';
import { makeLineups } from './lineups.mjs';

export function makeContentFixture(lineups = makeLineups()) {
  return {
    maps: ['ascent', 'bind'].map(id => ({
      id, name: id, image: 'test-assets/catalog.webp', imageHiRes: 'test-assets/catalog.webp', width: 1024, height: 1024,
      sites: ['A', 'B'].map((label, i) => ({ label, region: { x: .25 + i * .5, y: .3, width: .1, height: .1, rotation: 0 } })),
      spawns: { attack: { labelPosition: { x: .5, y: .8 } }, defense: { labelPosition: { x: .5, y: .2 } } },
      perspectives: { attack: { rotation: 0 }, defense: { rotation: 180 } },
    })),
    agents: Object.entries({ sova: ['recon-bolt', 'owl-drone', 'hunters-fury'], harbor: ['high-tide', 'cove'], breach: ['rolling-thunder'] }).map(([id, abilities]) => ({
      id, name: id, icon: 'test-assets/catalog.webp', abilities: abilities.map(id => ({ id, name: id, icon: 'test-assets/catalog.webp' })),
    })),
    lineups: structuredClone(lineups), history: [], imageMigrations: {},
  };
}

export function fixtureImage() {
  return sharp({ create: { width: 320, height: 180, channels: 3, background: '#426d7d' } }).webp({ quality: 85 }).toBuffer();
}

export async function writeContentFixture(root, source = makeContentFixture()) {
  await mkdir(path.join(root, 'content'), { recursive: true });
  await mkdir(path.join(root, 'src', 'data'), { recursive: true });
  for (const name of ['maps', 'agents', 'lineups']) await writeFile(path.join(root, 'content', `${name}.yaml`), stringify(source[name]));
  await writeFile(path.join(root, 'content', 'history.json'), JSON.stringify(source.history));
  await writeFile(path.join(root, 'content', 'image-migrations.json'), JSON.stringify(source.imageMigrations));
  const keys = new Set([
    ...source.maps.flatMap(map => [map.image, map.imageHiRes]),
    ...source.agents.flatMap(agent => [agent.icon, ...agent.abilities.map(ability => ability.icon)]),
    ...source.lineups.flatMap(lineup => Object.values(lineup.media).flat().map(item => item.key)),
  ]);
  const bytes = await fixtureImage();
  for (const key of keys) {
    await mkdir(path.dirname(path.join(root, 'public', key)), { recursive: true });
    await writeFile(path.join(root, 'public', key), bytes);
  }
  return source;
}

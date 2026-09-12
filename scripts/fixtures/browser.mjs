import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { makeLineups } from './lineups.mjs';
import { fixtureImage } from './content.mjs';

// Only the game catalog/art comes from the repo, never its editable lineup/history data.
export async function browserFixture() {
  const maps = parse(await readFile(new URL('../../content/maps.yaml', import.meta.url), 'utf8'));
  const agents = parse(await readFile(new URL('../../content/agents.yaml', import.meta.url), 'utf8'));
  const lineups = makeLineups();
  const first = lineups[0];
  first.videoBvid = 'BV17x411w7KC';
  for (const kind of ['stance', 'aim', 'effect']) first.media[kind] = [{ key: `lineups/${first.id}/${kind}.webp`, alt: `固定测试 ${kind}` }];
  const bytes = await fixtureImage();
  return { maps, agents, lineups, history: [], imageMigrations: {}, mediaBytes: Object.fromEntries(Object.values(first.media).flat().map(item => [item.key, bytes.length])) };
}

export async function requireFixtureServer(appUrl) {
  const response = await fetch(new URL('__test_fixture', appUrl));
  if (!response.ok || (await response.text()) !== 'valo-lineup-synthetic-v1') {
    throw new Error('Browser checks require pnpm run dev:test, not the live-content development server.');
  }
}

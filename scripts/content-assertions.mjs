import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { readSourceContent, validateContent } from './content-model.mjs';

// Validate the actual library without assuming its size, ordering, authors or particular lineups.
export async function assertGeneratedContent(root = process.cwd()) {
  const source = await readSourceContent(root);
  const expected = await validateContent(source, { root, verifyAssets: true });
  const content = JSON.parse(await readFile(path.join(root, 'src/data/content.json'), 'utf8'));
  assert.deepEqual(content, expected, 'Generated content must preserve all validated source records, history, metadata and image sizes');
  assert.equal(new Set(content.agents.map(agent => agent.id)).size, content.agents.length, 'Agent IDs must be unique');
  for (const agent of content.agents) assert.equal(new Set(agent.abilities.map(ability => ability.id)).size, agent.abilities.length, 'Ability IDs must be unique within an agent');
  const media = content.lineups.flatMap(lineup => Object.values(lineup.media).flat());
  assert(media.every(item => item.key.endsWith('.webp')), 'Only WebP lineup images are deployed');
  assert(media.every(item => content.mediaBytes[item.key] > 0), 'Every referenced image must have a positive actual byte size');
  assert(content.lineups.every(lineup => !('source' in lineup)), 'Runtime records must not retain Markdown provenance');
  return content;
}

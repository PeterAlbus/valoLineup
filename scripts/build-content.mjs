import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';

const root = process.cwd();
const publicRoot = path.join(root, 'public');

const point = z.object({ groupId: z.string().min(1), x: z.number().min(0).max(1), y: z.number().min(0).max(1) });
const mediaItem = z.object({ src: z.string().startsWith('/'), alt: z.string().min(1) });
const lineupSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  mapId: z.string(),
  agentId: z.string(),
  abilityId: z.string(),
  title: z.string().min(1),
  side: z.enum(['attack', 'defense']),
  area: z.string().min(1),
  target: point,
  technique: z.object({
    charge: z.enum(['none', 'one', 'two', 'full']).optional(),
    bounce: z.number().int().min(0).max(2).optional(),
    jump: z.boolean().optional(),
    instructions: z.array(z.string()),
  }),
  media: z.object({ stance: z.array(mediaItem), aim: z.array(mediaItem), effect: z.array(mediaItem) }),
  source: z.object({ kind: z.enum(['markdown', 'manual', 'import']), reference: z.string().min(1) }),
});

const mapsSchema = z.array(z.object({ id: z.string(), name: z.string(), image: z.string(), width: z.number(), height: z.number() }));
const agentsSchema = z.array(z.object({
  id: z.string(), name: z.string(), icon: z.string(),
  abilities: z.array(z.object({ id: z.string(), name: z.string(), icon: z.string() })),
}));

async function yaml(name) {
  return parse(await readFile(path.join(root, 'content', name), 'utf8'));
}

const maps = mapsSchema.parse(await yaml('maps.yaml'));
const agents = agentsSchema.parse(await yaml('agents.yaml'));
const lineups = z.array(lineupSchema).parse(await yaml('lineups.yaml'));
const ids = new Set();
const mapIds = new Set(maps.map((map) => map.id));
const agentById = new Map(agents.map((agent) => [agent.id, agent]));

for (const lineup of lineups) {
  if (ids.has(lineup.id)) throw new Error(`Duplicate lineup id: ${lineup.id}`);
  ids.add(lineup.id);
  if (!mapIds.has(lineup.mapId)) throw new Error(`Unknown map ${lineup.mapId} in ${lineup.id}`);
  const agent = agentById.get(lineup.agentId);
  if (!agent) throw new Error(`Unknown agent ${lineup.agentId} in ${lineup.id}`);
  if (!agent.abilities.some((ability) => ability.id === lineup.abilityId)) throw new Error(`Unknown ability ${lineup.abilityId} in ${lineup.id}`);
  const media = [...lineup.media.stance, ...lineup.media.aim, ...lineup.media.effect];
  if (!media.length) throw new Error(`No usable media in ${lineup.id}`);
  for (const item of media) await access(path.join(publicRoot, item.src.slice(1)));
}

for (const map of maps) await access(path.join(publicRoot, map.image.slice(1)));
for (const agent of agents) {
  await access(path.join(publicRoot, agent.icon.slice(1)));
  for (const ability of agent.abilities) await access(path.join(publicRoot, ability.icon.slice(1)));
}

const output = path.join(root, 'app/data/content.json');
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify({ maps, agents, lineups }, null, 2) + '\n', 'utf8');
console.log(`Validated ${lineups.length} lineups and generated app/data/content.json`);

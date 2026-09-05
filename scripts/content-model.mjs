import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { z } from 'zod';

const mapPositionSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

const cardinalRotationSchema = z.union([
  z.literal(-90),
  z.literal(0),
  z.literal(90),
  z.literal(180),
]);

const mapRegionSchema = mapPositionSchema.extend({
  width: z.number().positive().max(1),
  height: z.number().positive().max(1),
  rotation: z.number().min(-180).max(180),
});

const assetKeySchema = z.string()
  .min(1)
  .refine((value) => !value.startsWith('/') && !value.includes('..') && !value.includes('\\'), {
    message: 'Media keys must be relative paths without traversal segments',
  });

export const mediaItemSchema = z.object({
  key: assetKeySchema,
  alt: z.string().min(1),
});

export const lineupSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  mapId: z.string().min(1),
  agentId: z.string().min(1),
  abilityId: z.string().min(1),
  title: z.string().min(1),
  side: z.enum(['attack', 'defense']),
  area: z.string().min(1),
  videoBvid: z.union([
    z.literal(''),
    z.string().regex(/^BV[0-9A-Za-z]{10}$/, '教学视频必须填写完整 BV 号'),
  ]),
  target: z.object({
    groupId: z.string().min(1),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  }),
  instructions: z.string().max(1000),
  media: z.object({
    stance: z.array(mediaItemSchema),
    aim: z.array(mediaItemSchema),
    effect: z.array(mediaItemSchema),
  }),
});

export const lineupsSchema = z.array(lineupSchema);

export const mapsSchema = z.array(z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  image: assetKeySchema,
  imageHiRes: assetKeySchema,
  width: z.number().positive(),
  height: z.number().positive(),
  sites: z.array(z.object({
    label: z.enum(['A', 'B', 'C']),
    region: mapRegionSchema,
  })).min(2).max(3),
  spawns: z.object({
    attack: z.object({ labelPosition: mapPositionSchema }),
    defense: z.object({ labelPosition: mapPositionSchema }),
  }),
  perspectives: z.object({
    attack: z.object({ rotation: cardinalRotationSchema }),
    defense: z.object({ rotation: cardinalRotationSchema }),
  }),
}));

export const agentsSchema = z.array(z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  icon: assetKeySchema,
  abilities: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    icon: assetKeySchema,
  })),
}));

async function readYaml(root, name) {
  return parse(await readFile(path.join(root, 'content', name), 'utf8'));
}

export function stringifyLineups(lineups) {
  return stringify(lineupsSchema.parse(lineups), { lineWidth: 0 });
}

export async function writeTextAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  await writeFile(temporaryPath, value, 'utf8');
  await rename(temporaryPath, filePath);
}

export async function readSourceContent(root = process.cwd()) {
  const [maps, agents, lineups] = await Promise.all([
    readYaml(root, 'maps.yaml'),
    readYaml(root, 'agents.yaml'),
    readYaml(root, 'lineups.yaml'),
  ]);
  return { maps, agents, lineups };
}

export async function validateContent(content, { root = process.cwd(), verifyAssets = true } = {}) {
  const maps = mapsSchema.parse(content.maps);
  const agents = agentsSchema.parse(content.agents);
  const lineups = lineupsSchema.parse(content.lineups);
  const ids = new Set();
  const mapIds = new Set(maps.map((map) => map.id));
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const targetByGroup = new Map();

  if (mapIds.size !== maps.length) throw new Error('地图 ID 必须唯一');

  for (const map of maps) {
    const labels = new Set(map.sites.map((site) => site.label));
    if (labels.size !== map.sites.length) throw new Error(`${map.id} 存在重复包点标识`);
    if (!labels.has('A') || !labels.has('B')) throw new Error(`${map.id} 必须包含 A、B 包点`);
  }

  for (const lineup of lineups) {
    if (ids.has(lineup.id)) throw new Error(`点位 ID 重复：${lineup.id}`);
    ids.add(lineup.id);
    if (!mapIds.has(lineup.mapId)) throw new Error(`${lineup.id} 引用了未知地图 ${lineup.mapId}`);

    const agent = agentById.get(lineup.agentId);
    if (!agent) throw new Error(`${lineup.id} 引用了未知英雄 ${lineup.agentId}`);
    if (!agent.abilities.some((ability) => ability.id === lineup.abilityId)) {
      throw new Error(`${lineup.id} 引用了未知技能 ${lineup.abilityId}`);
    }

    const groupKey = `${lineup.mapId}:${lineup.target.groupId}`;
    const groupTarget = targetByGroup.get(groupKey);
    if (groupTarget && (groupTarget.x !== lineup.target.x || groupTarget.y !== lineup.target.y)) {
      throw new Error(`同组点位 ${groupKey} 必须共用相同坐标`);
    }
    targetByGroup.set(groupKey, lineup.target);

    const media = [...lineup.media.stance, ...lineup.media.aim, ...lineup.media.effect];
    for (const item of media) {
      if (!item.key.startsWith(`lineups/${lineup.id}/`)) {
        throw new Error(`${lineup.id} 的图片必须位于自己的媒体目录`);
      }
      if (verifyAssets) await access(path.join(root, 'public', item.key));
    }
  }

  if (verifyAssets) {
    for (const map of maps) {
      await access(path.join(root, 'public', map.image));
      await access(path.join(root, 'public', map.imageHiRes));
    }
    for (const agent of agents) {
      await access(path.join(root, 'public', agent.icon));
      for (const ability of agent.abilities) await access(path.join(root, 'public', ability.icon));
    }
  }

  return { maps, agents, lineups };
}

export async function buildContent(root = process.cwd(), { quiet = false } = {}) {
  const validated = await validateContent(await readSourceContent(root), { root, verifyAssets: true });
  const outputPath = path.join(root, 'src', 'data', 'content.json');
  await writeTextAtomic(outputPath, `${JSON.stringify(validated, null, 2)}\n`);
  if (!quiet) console.log(`Validated ${validated.lineups.length} lineups and generated src/data/content.json`);
  return validated;
}

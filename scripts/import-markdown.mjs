import { access, copyFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { buildContent, stringifyLineups, writeTextAtomic } from './content-model.mjs';

const root = process.cwd();
const input = process.argv[2];
if (!input) {
  throw new Error('请指定要导入的 Markdown：pnpm run content:import -- /absolute/path/to/file.md');
}

const sourcePath = path.resolve(input);
const sourceDirectory = path.dirname(sourcePath);
const outputAssets = path.join(root, 'public', 'lineups');
const outputPath = path.join(root, 'content', 'lineups.yaml');

const mapIds = {
  亚海悬城: 'ascent',
  源工重镇: 'bind',
  隐世修所: 'haven',
  霓虹町: 'split',
  森寒冬港: 'icebox',
  微风岛屿: 'breeze',
  裂变峡谷: 'fracture',
  深海明珠: 'pearl',
  莲华古城: 'lotus',
  日落之城: 'sunset',
  幽邃地窟: 'abyss',
  盐海矿镇: 'corrode',
  天枢云阙: 'summit',
};
const agentIds = { 猎枭: 'sova' };
const knownAscentTargets = [
  ['a-site-scan', .29, .21333333333333335], ['a-site-scan', .29, .21333333333333335], ['a-site-scan', .29, .21333333333333335],
  ['a-site-fast', .27, .19], ['a-site-upper', .315, .25], ['mid-eaves', .49, .54],
  ['mid-arch', .50, .49], ['mid-arch-inner', .535, .50], ['mid-ult-setup', .48, .545],
  ['mid-utility', .52, .465], ['b-window', .355, .74], ['b-eaves', .32, .825],
  ['b-tree', .285, .85], ['b-platform', .34, .80], ['a-retake', .285, .21666666666666667],
  ['a-outside', .30, .31], ['a-retake', .285, .21666666666666667], ['b-support', .32, .82],
  ['mid-water-tower', .50, .55], ['mid-second-timing', .52, .50], ['b-shock', .325, .825],
  ['b-outside-platform', .35, .72], ['b-outside-roof', .36, .77], ['b-anti-rush', .345, .74],
  ['b-boathouse', .30, .82], ['a-retake', .285, .21666666666666667],
];

function imageBasename(reference) {
  if (/^https?:\/\//.test(reference)) return path.basename(new URL(reference).pathname);
  return path.basename(reference.replaceAll('\\', '/'));
}

async function resolveImage(reference) {
  const basename = imageBasename(reference);
  const normalized = reference.replaceAll('\\', '/');
  const candidates = [
    path.resolve(sourceDirectory, normalized),
    path.join(sourceDirectory, 'assets', basename),
    path.join(sourceDirectory, basename),
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue to the next path derived from the Markdown location.
    }
  }
  throw new Error(`找不到 Markdown 引用的图片：${reference}`);
}

function abilityFrom(entry) {
  const text = `${entry.title} ${entry.notes.join(' ')}`;
  return /雷击|放血|清道具/.test(text) ? 'shock-bolt' : 'recon-bolt';
}

const markdown = await readFile(sourcePath, 'utf8');
const lines = markdown.split(/\r?\n/);
const drafts = [];
let context = { map: '', agent: '', side: '', area: '' };
let current = null;

function flush() {
  if (current) drafts.push(current);
  current = null;
}

for (const rawLine of lines) {
  const line = rawLine.trim();
  const heading = /^(#{1,4})\s+(.+)$/.exec(line);
  if (heading) {
    flush();
    const level = heading[1].length;
    const value = heading[2].trim();
    if (level === 1) context = { map: value, agent: '', side: '', area: '' };
    if (level === 2) context.agent = value;
    if (level === 3) context.side = value;
    if (level === 4) context.area = value;
    continue;
  }

  if (line.startsWith('+ ')) {
    flush();
    current = { ...context, title: line.slice(2).trim(), images: [], notes: [] };
    continue;
  }

  const images = [...line.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((match) => match[1]);
  if (images.length && current) {
    current.images.push(...images);
    const note = line.replace(/!\[[^\]]*\]\([^)]+\)/g, '').trim();
    if (note) current.notes.push(note);
    continue;
  }

  if (line && current && line !== '或者：') current.notes.push(line);
}
flush();

const existing = parse(await readFile(outputPath, 'utf8'));
const existingIds = new Set(existing.map((lineup) => lineup.id));
const imported = [];
const sequenceByPair = new Map();

for (const [index, draft] of drafts.entries()) {
  const mapId = mapIds[draft.map];
  const agentId = agentIds[draft.agent];
  if (!mapId || !agentId) continue;

  if (existing.some((lineup) => lineup.mapId === mapId
    && lineup.agentId === agentId
    && lineup.side === (draft.side === '防守' ? 'defense' : 'attack')
    && lineup.area === draft.area
    && lineup.title === draft.title)) {
    throw new Error(`点位已经存在，已停止导入：${draft.title}`);
  }

  const pair = `${mapId}:${agentId}`;
  const sequence = (sequenceByPair.get(pair) ?? existing.filter((lineup) => lineup.mapId === mapId && lineup.agentId === agentId).length) + 1;
  sequenceByPair.set(pair, sequence);
  const id = `${mapId}-${agentId}-${String(sequence).padStart(2, '0')}`;
  if (existingIds.has(id)) throw new Error(`导入会产生重复点位 ID：${id}`);

  const [groupId, x, y] = mapId === 'ascent' && agentId === 'sova'
    ? knownAscentTargets[index] ?? [`imported-${id}`, .5, .5]
    : [`imported-${id}`, .5, .5];
  const media = { stance: [], aim: [], effect: [] };
  const destination = path.join(outputAssets, id);
  await mkdir(destination, { recursive: true });

  for (const [imageIndex, reference] of draft.images.entries()) {
    const source = await resolveImage(reference);
    const extension = path.extname(source).toLowerCase() || '.png';
    const kind = draft.images.length > 1 && imageIndex === 0 ? 'stance' : 'aim';
    const ordinal = media[kind].length + 1;
    const outputName = `${kind}-${String(ordinal).padStart(2, '0')}${extension}`;
    await copyFile(source, path.join(destination, outputName));
    media[kind].push({
      key: `lineups/${id}/${outputName}`,
      alt: `${draft.title}${kind === 'stance' ? '站位' : '瞄点'}图 ${ordinal}`,
    });
  }

  imported.push({
    id,
    uploader: { name: 'Markdown 导入者（未认证）', source: 'local' },
    mapId,
    agentId,
    abilityId: abilityFrom(draft),
    title: draft.title,
    side: draft.side === '防守' ? 'defense' : 'attack',
    area: draft.area,
    videoBvid: '',
    target: { groupId, x, y },
    instructions: draft.notes.join('，').replaceAll('，，', '，'),
    media,
  });
}

if (!imported.length) throw new Error('Markdown 中没有识别到可导入的点位');
await writeTextAtomic(outputPath, stringifyLineups([...existing, ...imported]));
await buildContent(root);
console.log(`Imported ${imported.length} lineups from ${sourcePath}`);

import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { stringify } from 'yaml';

const root = process.cwd();
const sourcePath = path.join(root, 'content/sources/先锋.md');
const sourceAssets = path.join(root, 'content/sources/assets');
const outputAssets = path.join(root, 'public/lineups');
const outputPath = path.join(root, 'content/lineups.yaml');
const reportPath = path.join(root, 'content/import-report.json');

const mapIds = { 天枢云阙: 'corrode', 亚海悬城: 'ascent', 隐世修所: 'haven' };
const agentIds = { 猎枭: 'sova' };

const enrichment = [
  ['a-site-scan', .285, .79], ['a-site-scan', .285, .79], ['a-site-scan', .30, .78],
  ['a-site-fast', .27, .81], ['a-site-upper', .315, .75], ['mid-eaves', .49, .46],
  ['mid-arch', .50, .51], ['mid-arch-inner', .535, .50], ['mid-ult-setup', .48, .455],
  ['mid-utility', .52, .535], ['b-window', .355, .26], ['b-eaves', .32, .175],
  ['b-tree', .285, .15], ['b-platform', .34, .20], ['a-retake', .28, .79],
  ['a-outside', .30, .69], ['a-retake', .285, .77], ['b-support', .32, .18],
  ['mid-water-tower', .50, .45], ['mid-second-timing', .52, .50], ['b-shock', .325, .175],
  ['b-outside-platform', .35, .28], ['b-outside-roof', .36, .23], ['b-anti-rush', .345, .26],
  ['b-boathouse', .30, .18], ['a-retake', .29, .79],
];

function imageBasename(reference) {
  if (/^https?:\/\//.test(reference)) {
    return reference.includes('1342a4e464974a8783c9a4f302439241')
      ? 'image-20260624164625541.png'
      : path.basename(new URL(reference).pathname);
  }
  return path.basename(reference.replaceAll('\\', '/'));
}

function techniqueFrom(text) {
  let charge;
  if (/无蓄力/.test(text)) charge = 'none';
  else if (/满格蓄力/.test(text)) charge = 'full';
  else if (/两格蓄力/.test(text)) charge = 'two';
  else if (/一格蓄力/.test(text)) charge = 'one';

  let bounce;
  if (/无反弹/.test(text)) bounce = 0;
  else if (/两次反弹/.test(text)) bounce = 2;
  else if (/(一次|一格)反弹/.test(text)) bounce = 1;

  return {
    ...(charge ? { charge } : {}),
    ...(bounce !== undefined ? { bounce } : {}),
    ...(text.includes('跳射') ? { jump: true } : {}),
    instructions: text ? [text] : [],
  };
}

function abilityFrom(entry) {
  const text = `${entry.title} ${entry.notes.join(' ')}`;
  if (/雷击|放血|清道具/.test(text)) return 'shock-bolt';
  return 'recon-bolt';
}

const markdown = await readFile(sourcePath, 'utf8');
const lines = markdown.split(/\r?\n/);
const drafts = [];
const orphanImages = [];
const missingImages = [];
const suspiciousHeadings = [];
let context = { map: '', agent: '', side: '', area: '' };
let current = null;

function flush() {
  if (!current) return;
  drafts.push(current);
  current = null;
}

for (let index = 0; index < lines.length; index += 1) {
  const line = lines[index].trim();
  const heading = /^(#{1,4})\s+(.+)$/.exec(line);
  if (heading) {
    flush();
    const level = heading[1].length;
    const value = heading[2].trim();
    if (level === 1) context = { map: value, agent: '', side: '', area: '' };
    if (level === 2) {
      if (mapIds[value]) suspiciousHeadings.push({ line: index + 1, value, expectedLevel: 1 });
      context.agent = value;
    }
    if (level === 3) context.side = value;
    if (level === 4) context.area = value;
    continue;
  }

  if (line.startsWith('+ ')) {
    flush();
    current = {
      sourceLine: index + 1,
      mapName: context.map,
      agentName: context.agent,
      sideName: context.side,
      area: context.area,
      title: line.slice(2).trim(),
      images: [],
      notes: [],
    };
    continue;
  }

  const images = [...line.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((match) => match[1]);
  if (images.length) {
    const basenames = images.map(imageBasename);
    if (current) current.images.push(...basenames);
    else orphanImages.push(...basenames.map((file) => ({ line: index + 1, file, context: { ...context } })));
    const note = line.replace(/!\[[^\]]*\]\([^)]+\)/g, '').trim();
    if (note && current) current.notes.push(note);
    continue;
  }

  if (line && current && line !== '或者：') current.notes.push(line);
}
flush();

const lineups = [];
const groupCounts = new Map();
for (const [index, draft] of drafts.entries()) {
  if (draft.mapName !== '亚海悬城' || draft.agentName !== '猎枭') continue;
  const [groupId, x, y] = enrichment[index] ?? [`imported-${index + 1}`, .5, .5];
  const sequence = (groupCounts.get(groupId) ?? 0) + 1;
  groupCounts.set(groupId, sequence);
  const id = `ascent-sova-${String(index + 1).padStart(2, '0')}`;
  const destination = path.join(outputAssets, id);
  await mkdir(destination, { recursive: true });

  const media = { stance: [], aim: [], effect: [] };
  for (const [imageIndex, filename] of draft.images.entries()) {
    const extension = path.extname(filename) || '.png';
    const kind = draft.images.length > 1 && imageIndex === 0 ? 'stance' : 'aim';
    const ordinal = media[kind].length + 1;
    const outputName = `${kind}-${String(ordinal).padStart(2, '0')}${extension}`;
    try {
      await copyFile(path.join(sourceAssets, filename), path.join(destination, outputName));
      media[kind].push({
        src: `/lineups/${id}/${outputName}`,
        alt: `${draft.title}${kind === 'stance' ? '站位' : '瞄点'}图 ${ordinal}`,
      });
    } catch {
      missingImages.push({ lineup: id, file: filename, sourceLine: draft.sourceLine });
    }
  }

  const side = draft.sideName === '防守' ? 'defense' : 'attack';
  const notes = draft.notes.join('，').replaceAll('，，', '，');
  lineups.push({
    id,
    mapId: mapIds[draft.mapName],
    agentId: agentIds[draft.agentName],
    abilityId: abilityFrom(draft),
    title: draft.title,
    side,
    area: draft.area,
    target: { groupId, x, y },
    technique: techniqueFrom(notes),
    media,
    source: { kind: 'markdown', reference: `content/sources/先锋.md:${draft.sourceLine}` },
  });
}

await writeFile(outputPath, stringify(lineups, { lineWidth: 0 }), 'utf8');
const orphanImageStatus = await Promise.all(orphanImages.map(async (item) => {
  try {
    await access(path.join(sourceAssets, item.file));
    return { ...item, available: true };
  } catch {
    return { ...item, available: false };
  }
}));

await writeFile(reportPath, JSON.stringify({
  source: 'content/sources/先锋.md',
  importedLineups: lineups.length,
  orphanImages: orphanImageStatus,
  missingImages,
  suspiciousHeadings,
}, null, 2) + '\n', 'utf8');

console.log(`Imported ${lineups.length} lineups to content/lineups.yaml`);
console.log(`Report: ${path.relative(root, reportPath)}`);

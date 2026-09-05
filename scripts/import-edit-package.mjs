import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { z } from 'zod';
import {
  buildContent,
  lineupSchema,
  lineupsSchema,
  readSourceContent,
  stringifyLineups,
  validateContent,
  writeTextAtomic,
} from './content-model.mjs';

const MAX_IMAGE_SIZE = 12 * 1024 * 1024;
const imageMimeTypes = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

const uploadSchema = z.object({
  key: z.string().min(1),
  lineupId: z.string().min(1),
  kind: z.enum(['stance', 'aim', 'effect']),
  alt: z.string().min(1),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  size: z.number().int().positive().max(MAX_IMAGE_SIZE),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

const updateSchema = z.object({
  id: z.string().min(1),
  before: lineupSchema,
  after: lineupSchema,
}).superRefine((update, context) => {
  if (update.before.id !== update.id || update.after.id !== update.id) {
    context.addIssue({ code: 'custom', message: '修改记录的 ID 必须保持不变' });
  }
});

const manifestSchema = z.object({
  format: z.literal('valo-lineup-edit-package'),
  version: z.literal(3),
  createdAt: z.string().datetime(),
  changes: z.object({
    added: lineupsSchema,
    updated: z.array(updateSchema),
  }),
  uploadedAssets: z.array(uploadSchema),
});

function usage() {
  return '用法：npm run content:import-edits -- /absolute/path/to/valo-lineup-edits.zip';
}

function allMedia(lineups) {
  return lineups.flatMap((lineup) => Object.entries(lineup.media).flatMap(([kind, items]) => (
    items.map((item) => ({ ...item, lineupId: lineup.id, kind }))
  )));
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sorted(values) {
  return [...values].sort();
}

function assertSameValues(actual, declared, label) {
  if (JSON.stringify(sorted(actual)) !== JSON.stringify(sorted(declared))) {
    throw new Error(`编辑包的 ${label} 与实际内容不一致`);
  }
}

function verifyImage(bytes, key, mimeType) {
  const extension = path.extname(key).toLowerCase();
  if (imageMimeTypes[extension] !== mimeType) throw new Error(`${key} 的扩展名与媒体类型不一致`);
  if (bytes.length > MAX_IMAGE_SIZE) throw new Error(`${key} 超过 12 MB`);
  const isPng = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpeg = bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  const isWebp = bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  if ((mimeType === 'image/png' && !isPng)
    || (mimeType === 'image/jpeg' && !isJpeg)
    || (mimeType === 'image/webp' && !isWebp)) {
    throw new Error(`${key} 不是有效的 ${mimeType} 文件`);
  }
}

function findInconsistentGroups(lineups) {
  const groups = new Map();
  for (const lineup of lineups) {
    const key = `${lineup.mapId}:${lineup.target.groupId}`;
    const group = groups.get(key) ?? [];
    group.push(lineup);
    groups.set(key, group);
  }
  return [...groups.entries()].filter(([, members]) => (
    members.some((member) => member.target.x !== members[0].target.x || member.target.y !== members[0].target.y)
  ));
}

const packageArgument = process.argv[2];
if (!packageArgument || ['-h', '--help'].includes(packageArgument)) {
  console.log(usage());
  process.exit(packageArgument ? 0 : 1);
}

const root = process.cwd();
const packagePath = path.resolve(packageArgument);
const lineupsPath = path.join(root, 'content', 'lineups.yaml');
const zip = await JSZip.loadAsync(await readFile(packagePath));
const manifestEntry = zip.file('manifest.json');
if (!manifestEntry) throw new Error('编辑包缺少 manifest.json');
const manifest = manifestSchema.parse(JSON.parse(await manifestEntry.async('string')));
const current = await validateContent(await readSourceContent(root), { root, verifyAssets: true });
const currentById = new Map(current.lineups.map((lineup) => [lineup.id, lineup]));
const operationIds = [
  ...manifest.changes.added.map((lineup) => lineup.id),
  ...manifest.changes.updated.map((update) => update.id),
];
if (new Set(operationIds).size !== operationIds.length) throw new Error('编辑包包含重复的 Lineup 操作');
const operationIdSet = new Set(operationIds);
if (manifest.uploadedAssets.some((upload) => !operationIdSet.has(upload.lineupId))) {
  throw new Error('编辑包包含不属于任何变更 Lineup 的图片');
}

const accepted = new Map();
const alreadyApplied = [];
const conflicts = [];

for (const lineup of manifest.changes.added) {
  const existing = currentById.get(lineup.id);
  if (!existing) accepted.set(lineup.id, { kind: 'added', record: lineup });
  else if (same(existing, lineup)) alreadyApplied.push(lineup.id);
  else conflicts.push({ id: lineup.id, title: lineup.title, reason: '新增点位 ID 已被其他内容占用' });
}

for (const update of manifest.changes.updated) {
  const existing = currentById.get(update.id);
  if (!existing) {
    conflicts.push({ id: update.id, title: update.after.title, reason: '已有点位已不存在' });
  } else if (same(existing, update.after)) {
    alreadyApplied.push(update.id);
  } else if (same(existing, update.before)) {
    accepted.set(update.id, { kind: 'updated', record: update.after });
  } else {
    conflicts.push({ id: update.id, title: update.after.title, reason: '仓库中的点位已被其他编辑修改' });
  }
}

function candidateLineups() {
  const merged = current.lineups.map((lineup) => accepted.get(lineup.id)?.record ?? lineup);
  for (const operation of accepted.values()) {
    if (operation.kind === 'added') merged.push(operation.record);
  }
  return merged;
}

for (;;) {
  const inconsistentGroups = findInconsistentGroups(candidateLineups());
  if (!inconsistentGroups.length) break;
  let removed = 0;
  for (const [groupId, members] of inconsistentGroups) {
    for (const member of members) {
      const operation = accepted.get(member.id);
      if (!operation) continue;
      accepted.delete(member.id);
      conflicts.push({ id: member.id, title: operation.record.title, reason: `共享落点 ${groupId} 包含并发冲突` });
      removed += 1;
    }
  }
  if (!removed) throw new Error('当前仓库包含坐标不一致的共享落点');
}

const mergedLineups = candidateLineups();
await validateContent({ maps: current.maps, agents: current.agents, lineups: mergedLineups }, { root, verifyAssets: false });

const currentMediaKeys = new Set(allMedia(current.lineups).map((item) => item.key));
const requiredMedia = allMedia(mergedLineups).filter((item) => !currentMediaKeys.has(item.key));
const uploadsByKey = new Map(manifest.uploadedAssets.map((upload) => [upload.key, upload]));
if (uploadsByKey.size !== manifest.uploadedAssets.length) throw new Error('编辑包包含重复的图片路径');
assertSameValues(
  requiredMedia.map((item) => item.key),
  manifest.uploadedAssets.filter((upload) => accepted.has(upload.lineupId)).map((upload) => upload.key),
  '待导入图片清单',
);

for (const item of requiredMedia) {
  const upload = uploadsByKey.get(item.key);
  if (!upload || upload.lineupId !== item.lineupId || upload.kind !== item.kind || upload.alt !== item.alt) {
    throw new Error(`${item.key} 的图片描述与 Lineup 引用不一致`);
  }
  if (!item.key.startsWith(`lineups/${item.lineupId}/`)) throw new Error(`${item.key} 不属于点位 ${item.lineupId}`);
}

const stagingRoot = await mkdtemp(path.join(os.tmpdir(), 'valo-lineup-import-'));
const stagedAssets = [];
const movedAssets = [];
let yamlWritten = false;
const originalYaml = await readFile(lineupsPath, 'utf8');

try {
  for (const item of requiredMedia) {
    const upload = uploadsByKey.get(item.key);
    const entry = zip.file(upload.key);
    if (!entry) throw new Error(`编辑包缺少图片：${upload.key}`);
    const bytes = await entry.async('nodebuffer');
    if (bytes.length !== upload.size) throw new Error(`${upload.key} 的文件大小与清单不一致`);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== upload.sha256) throw new Error(`${upload.key} 的校验值不一致`);
    verifyImage(bytes, upload.key, upload.mimeType);

    const destination = path.join(root, 'public', upload.key);
    try {
      await access(destination);
      throw new Error(`仓库中已存在同名图片，已停止导入：${upload.key}`);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }

    const stagedPath = path.join(stagingRoot, upload.key);
    await mkdir(path.dirname(stagedPath), { recursive: true });
    await writeFile(stagedPath, bytes);
    stagedAssets.push({ key: upload.key, stagedPath });
  }

  for (const asset of stagedAssets) {
    const destination = path.join(root, 'public', asset.key);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(asset.stagedPath, destination, constants.COPYFILE_EXCL);
    movedAssets.push(destination);
  }

  if (accepted.size) {
    await writeTextAtomic(lineupsPath, stringifyLineups(mergedLineups));
    yamlWritten = true;
    await buildContent(root);
  }
} catch (error) {
  if (yamlWritten) await writeTextAtomic(lineupsPath, originalYaml);
  await Promise.all(movedAssets.map((filePath) => rm(filePath, { force: true })));
  if (yamlWritten) await buildContent(root, { quiet: true });
  throw error;
} finally {
  await rm(stagingRoot, { recursive: true, force: true });
}

const addedCount = [...accepted.values()].filter((operation) => operation.kind === 'added').length;
const updatedCount = [...accepted.values()].filter((operation) => operation.kind === 'updated').length;
console.log(`Imported ${addedCount} new and ${updatedCount} updated lineups with ${movedAssets.length} images.`);
if (alreadyApplied.length) console.log(`Already applied: ${alreadyApplied.join(', ')}`);
if (conflicts.length) {
  console.warn(`Skipped ${conflicts.length} conflicting lineups:`);
  for (const conflict of conflicts) console.warn(`- ${conflict.id} (${conflict.title}): ${conflict.reason}`);
}

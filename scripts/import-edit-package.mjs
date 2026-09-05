import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readPackage, same, allMedia, validateReferences } from '../src/package-model.mjs';
import { buildContent, readSourceContent, stringifyLineups, validateContent, writeTextAtomic } from './content-model.mjs';

const packageArgument = process.argv.slice(2).find((arg) => arg !== '--');
if (!packageArgument || ['-h', '--help'].includes(packageArgument)) {
  console.log('用法：pnpm run content:import-edits -- /absolute/path/to/valo-lineup-edits.zip');
  process.exit(packageArgument ? 0 : 1);
}
const root = process.cwd();
const lineupsPath = path.join(root, 'content', 'lineups.yaml');
const historyPath = path.join(root, 'content', 'history.json');
const { manifest, blobs } = await readPackage(await readFile(path.resolve(packageArgument)));
const current = await validateContent(await readSourceContent(root), { root, verifyAssets: true });
validateReferences(manifest, current.maps, current.agents);
const currentById = new Map(current.lineups.map((lineup) => [lineup.id, lineup]));
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
  if (!existing) conflicts.push({ id: update.id, title: update.after.title, reason: '已有点位已不存在' });
  else if (same(existing, update.after)) alreadyApplied.push(update.id);
  else if (same(existing, update.before)) accepted.set(update.id, { kind: 'updated', record: update.after });
  else conflicts.push({ id: update.id, title: update.after.title, reason: '仓库中的点位已被其他编辑修改' });
}

// Self-contained packages may include existing images, but may never overwrite different repository bytes.
const newAssets = new Set();
for (const asset of manifest.uploadedAssets) {
  if (!accepted.has(asset.lineupId)) continue;
  try {
    const bytes = await readFile(path.join(root, 'public', asset.key));
    if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) {
      const operation = accepted.get(asset.lineupId);
      accepted.delete(asset.lineupId);
      conflicts.push({ id: asset.lineupId, title: operation.record.title, reason: `同名图片内容不同：${asset.key}` });
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; newAssets.add(asset.key); }
}
function candidateLineups() {
  const merged = current.lineups.map((lineup) => accepted.get(lineup.id)?.record ?? lineup);
  for (const operation of accepted.values()) if (operation.kind === 'added') merged.push(operation.record);
  return merged;
}
for (;;) {
  const groups = new Map();
  for (const record of candidateLineups()) {
    const key = `${record.mapId}:${record.target.groupId}`;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  const inconsistent = [...groups.entries()].filter(([, members]) => members.some((item) => item.target.x !== members[0].target.x || item.target.y !== members[0].target.y));
  if (!inconsistent.length) break;
  let removed = 0;
  for (const [groupId, members] of inconsistent) for (const member of members) {
    if (!accepted.has(member.id)) continue;
    accepted.delete(member.id); removed++;
    conflicts.push({ id: member.id, title: member.title, reason: `共享落点 ${groupId} 包含并发冲突` });
  }
  if (!removed) throw new Error('当前仓库包含坐标不一致的共享落点');
}
const mergedLineups = candidateLineups();
await validateContent({ ...current, lineups: mergedLineups }, { root, verifyAssets: false });
const requiredKeys = new Set(allMedia([...accepted.values()].map((operation) => operation.record)).map((item) => item.key));
const requiredAssets = manifest.uploadedAssets.filter((asset) => newAssets.has(asset.key) && requiredKeys.has(asset.key));
const addedCount = [...accepted.values()].filter((operation) => operation.kind === 'added').length;
const updatedCount = accepted.size - addedCount;

if (accepted.size) {
  const stagingRoot = await mkdtemp(path.join(os.tmpdir(), 'valo-lineup-import-'));
  const movedAssets = [];
  let yamlWritten = false;
  let historyWritten = false;
  const originalYaml = await readFile(lineupsPath, 'utf8');
  let originalHistory = null;
  try { originalHistory = await readFile(historyPath, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  try {
    for (const asset of requiredAssets) {
      const staged = path.join(stagingRoot, asset.key);
      await mkdir(path.dirname(staged), { recursive: true });
      await writeFile(staged, new Uint8Array(await blobs.get(asset.sha256).arrayBuffer()));
    }
    for (const asset of requiredAssets) {
      const destination = path.join(root, 'public', asset.key);
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(path.join(stagingRoot, asset.key), destination, constants.COPYFILE_EXCL);
      movedAssets.push(destination);
    }
    await writeTextAtomic(lineupsPath, stringifyLineups(mergedLineups));
    yamlWritten = true;
    const records = [...accepted.values()].map((operation) => operation.record);
    const history = [...current.history, {
      id: randomUUID(), packageId: manifest.packageId, revision: manifest.revision,
      appliedAt: new Date().toISOString(), author: manifest.author,
      mapIds: [...new Set(records.map((record) => record.mapId))], lineupIds: records.map((record) => record.id),
      added: addedCount, updated: updatedCount,
    }];
    await writeTextAtomic(historyPath, `${JSON.stringify(history, null, 2)}\n`);
    historyWritten = true;
    await buildContent(root);
  } catch (error) {
    if (yamlWritten) await writeTextAtomic(lineupsPath, originalYaml);
    if (historyWritten) {
      if (originalHistory === null) await rm(historyPath, { force: true });
      else await writeTextAtomic(historyPath, originalHistory);
    }
    await Promise.all(movedAssets.map((filePath) => rm(filePath, { force: true })));
    if (yamlWritten) await buildContent(root, { quiet: true });
    throw error;
  } finally { await rm(stagingRoot, { recursive: true, force: true }); }
}
console.log(`Imported ${addedCount} new and ${updatedCount} updated lineups with ${requiredAssets.length} images.`);
if (alreadyApplied.length) console.log(`Already applied: ${alreadyApplied.join(', ')}`);
if (conflicts.length) {
  console.warn(`Skipped ${conflicts.length} conflicting lineups:`);
  for (const conflict of conflicts) console.warn(`- ${conflict.id} (${conflict.title}): ${conflict.reason}`);
}

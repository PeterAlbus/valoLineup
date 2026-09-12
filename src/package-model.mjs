import { z } from 'zod';
import JSZip from 'jszip';
import { effectError, usesPath } from './ability-geometry.mjs';

export const PACKAGE_VERSION = 6;
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
export const MAX_PACKAGE_BYTES = 128 * 1024 * 1024;
const id = z.string().regex(/^[a-z0-9-]+$/).max(160);
export const uploaderSchema = z.object({
  name: z.string().trim().min(1).max(100),
  source: z.enum(['toy', 'local', 'curated']),
  toyOpenId: z.string().min(1).max(512).optional(),
  bilibiliUid: z.string().regex(/^[1-9][0-9]{0,19}$/).optional(),
}).passthrough();
export const mediaItemSchema = z.object({
  key: z.string().regex(/^lineups\/[a-z0-9-]+\/[a-zA-Z0-9_-][a-zA-Z0-9._-]*\.(png|jpe?g|webp)$/).refine((key) => !key.includes('..')),
  alt: z.string().min(1).max(500),
  original: z.object({ key: z.string().regex(/^lineups\/[a-z0-9-]+\/[a-zA-Z0-9_-][a-zA-Z0-9._-]*\.(png|jpe?g|webp)$/).refine((key) => !key.includes('..')), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).optional(),
}).passthrough();
const effectPoint = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });
export const effectSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('direction'), angle: z.number().min(0).lt(360) }),
  z.object({ type: z.literal('path'), points: z.array(effectPoint).min(1) }),
]);
export const lineupSchema = z.object({
  id, mapId: id, agentId: id, abilityId: id,
  uploader: uploaderSchema,
  title: z.string().min(1).max(200), side: z.enum(['attack', 'defense']), area: z.string().min(1).max(100),
  videoBvid: z.union([z.literal(''), z.string().regex(/^BV[0-9A-Za-z]{10}$/, '教学视频必须填写完整 BV 号')]),
  target: z.object({ groupId: id, x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).passthrough(),
  effect: effectSchema.optional(),
  stance: effectPoint.optional(),
  instructions: z.string().max(1000),
  media: z.object({ stance: z.array(mediaItemSchema), aim: z.array(mediaItemSchema), effect: z.array(mediaItemSchema) }).passthrough(),
}).passthrough().superRefine((lineup, ctx) => {
  const error = effectError(lineup);
  if (error) ctx.addIssue({ code: 'custom', path: ['effect'], message: error });
  if (usesPath(lineup) && lineup.stance) ctx.addIssue({ code: 'custom', path: ['stance'], message: '路径技能的站位由路径起点确定' });
  for (const item of allMedia([lineup])) if (!item.key.startsWith(`lineups/${lineup.id}/`)) ctx.addIssue({ code: 'custom', message: '图片必须位于所属点位目录' });
});
export const lineupsSchema = z.array(lineupSchema);
const assetSchema = z.object({
  key: mediaItemSchema.shape.key, lineupId: id, kind: z.enum(['stance', 'aim', 'effect']),
  alt: mediaItemSchema.shape.alt, mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  size: z.number().int().positive().max(MAX_IMAGE_BYTES), sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).passthrough();
export const manifestSchema = z.object({
  format: z.literal('valo-lineup-edit-package'), version: z.union([z.literal(4), z.literal(5), z.literal(6)]),
  packageId: z.string().uuid(), revision: z.number().int().positive(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(), author: uploaderSchema,
  changes: z.object({
    added: lineupsSchema.max(10000),
    updated: z.array(z.object({ id, before: lineupSchema, after: lineupSchema }).passthrough()).max(10000),
    deleted: z.array(z.object({ id, before: lineupSchema }).passthrough()).max(10000).optional(),
  }).passthrough(),
  uploadedAssets: z.array(assetSchema).max(500),
  referencedAssets: z.array(assetSchema).max(500).optional(),
}).passthrough().superRefine((manifest, ctx) => {
  const fail = (message) => ctx.addIssue({ code: 'custom', message });
  const records = changedLineups(manifest);
  const deleted = manifest.changes.deleted ?? [];
  const operationIds = [...records.map((record) => record.id), ...deleted.map((item) => item.id)];
  if (new Set(operationIds).size !== operationIds.length) fail('包内点位操作 ID 重复');
  if (deleted.some((item) => item.id !== item.before.id)) fail('删除记录的 ID 不一致');
  if (manifest.version === 4 && deleted.length) fail('删除操作需要 v5 格式，不能被旧客户端静默忽略');
  if (manifest.version !== 6 && manifest.referencedAssets?.length) fail('图片引用需要 v6 格式');
  if (manifest.referencedAssets?.some(asset => asset.mimeType !== 'image/webp' || !asset.key.endsWith('.webp'))) fail('已有图片引用必须为 WebP');
  if (manifest.changes.updated.some((update) => update.id !== update.before.id || update.id !== update.after.id)) fail('编辑不能改变点位 ID');
  const media = allMedia(records);
  const declared = allAssets(manifest);
  const assets = new Map(declared.map((asset) => [asset.key, asset]));
  if (declared.length > 500) fail('包内图片声明超过 500 张');
  if (assets.size !== declared.length || new Set(media.map((item) => item.key)).size !== media.length) fail('图片路径重复');
  if (assets.size !== media.length) fail('包必须包含所有变更后点位的完整图片声明');
  for (const item of media) {
    const asset = assets.get(item.key);
    if (!asset || asset.lineupId !== item.lineupId || asset.kind !== item.kind || asset.alt !== item.alt) fail('图片声明与点位引用不一致');
  }
  if (manifest.uploadedAssets.reduce((sum, asset) => sum + asset.size, 0) > MAX_PACKAGE_BYTES) fail('包内图片总大小超过 128 MB');
});

export function allMedia(lineups) {
  return lineups.flatMap((lineup) => ['stance', 'aim', 'effect'].flatMap((kind) => lineup.media[kind].map((item) => ({ ...item, lineupId: lineup.id, kind }))));
}
export function changedLineups(manifest) { return [...manifest.changes.added, ...manifest.changes.updated.map((change) => change.after)]; }
export function allAssets(manifest) { return [...manifest.uploadedAssets, ...(manifest.referencedAssets ?? [])]; }
export function matchesRepositoryAsset(asset, repositoryAssets) {
  const original = repositoryAssets[asset.key];
  return Boolean(original && original.sha256 === asset.sha256 && original.size === asset.size && original.mimeType === asset.mimeType);
}
export function matchesAvailableAsset(asset, repositoryAssets, localAssets = []) {
  return matchesRepositoryAsset(asset, repositoryAssets) || localAssets.some(original => original.key === asset.key && original.sha256 === asset.sha256 && original.size === asset.size && original.mimeType === asset.mimeType);
}
// Reuse matching images in either the repository or other installed package layers.
export function compactPackage(data, repositoryAssets = {}, localAssets = []) {
  const manifest = structuredClone(data.manifest);
  const declared = allAssets(manifest);
  manifest.uploadedAssets = declared.filter(asset => !matchesAvailableAsset(asset, repositoryAssets, localAssets));
  const references = declared.filter(asset => matchesAvailableAsset(asset, repositoryAssets, localAssets));
  if (references.length) { manifest.version = 6; manifest.referencedAssets = references; }
  else { manifest.version = manifest.changes.deleted?.length ? 5 : 4; delete manifest.referencedAssets; }
  return { ...data, manifest: manifestSchema.parse(manifest) };
}
function imageFailure(manifest, asset, error) {
  return { lineupId: asset.lineupId, title: changedLineups(manifest).find(record => record.id === asset.lineupId)?.title ?? asset.lineupId, key: asset.key, message: error instanceof Error ? error.message : String(error) };
}
function excludeFailedLineups(data, failures) {
  if (!failures.length) return data;
  const skipped = new Set(failures.map(item => item.lineupId));
  const manifest = structuredClone(data.manifest);
  manifest.changes.added = manifest.changes.added.filter(item => !skipped.has(item.id));
  manifest.changes.updated = manifest.changes.updated.filter(item => !skipped.has(item.id));
  manifest.uploadedAssets = manifest.uploadedAssets.filter(item => !skipped.has(item.lineupId));
  if (manifest.referencedAssets) manifest.referencedAssets = manifest.referencedAssets.filter(item => !skipped.has(item.lineupId));
  if (!packageStats(manifest).lineups) throw new Error(`没有可导入的点位；${failures.map(item => `${item.title}：${item.message}（${item.key}）`).join('；')}`);
  const used = new Set(allAssets(manifest).map(asset => asset.sha256));
  return { manifest: manifestSchema.parse(manifest), blobs: new Map([...data.blobs].filter(([digest]) => used.has(digest))), failures };
}
// A failed image skips its whole lineup, without blocking independent lineup changes.
export async function resolvePackageReferences(data, resolve) {
  const blobs = new Map(data.blobs);
  const failures = [...(data.failures ?? [])];
  for (const asset of data.manifest.referencedAssets ?? []) {
    if (failures.some(item => item.lineupId === asset.lineupId)) continue;
    try {
      const blob = await resolve(asset);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      verifyImage(bytes, asset);
      if (await sha256(bytes) !== asset.sha256) throw new Error('引用图片内容不匹配，请先同步来源更新包');
      blobs.set(asset.sha256, new Blob([bytes], { type: asset.mimeType }));
    } catch (error) { failures.push(imageFailure(data.manifest, asset, error)); }
  }
  return excludeFailedLineups({ ...data, blobs }, failures);
}
// Reimporting a partial revision must not remove the old version of a failed lineup.
export function retainFailedChanges(data, previous) {
  if (!previous || previous.packageId !== data.manifest.packageId || !data.failures?.length) return data;
  const skipped = new Set(data.failures.map(item => item.lineupId));
  const manifest = structuredClone(data.manifest);
  manifest.changes.added.push(...previous.changes.added.filter(item => skipped.has(item.id)));
  manifest.changes.updated.push(...previous.changes.updated.filter(item => skipped.has(item.id)));
  const deleted = previous.changes.deleted?.filter(item => skipped.has(item.id)) ?? [];
  if (deleted.length) manifest.changes.deleted = [...(manifest.changes.deleted ?? []), ...deleted];
  manifest.uploadedAssets.push(...previous.uploadedAssets.filter(item => skipped.has(item.lineupId)));
  const references = previous.referencedAssets?.filter(item => skipped.has(item.lineupId)) ?? [];
  if (references.length) manifest.referencedAssets = [...(manifest.referencedAssets ?? []), ...references];
  if (manifest.referencedAssets?.length) manifest.version = 6;
  else if (manifest.changes.deleted?.length && manifest.version === 4) manifest.version = 5;
  return { ...data, manifest: manifestSchema.parse(manifest) };
}
export function same(left, right) {
  const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}
export function applyLayers(base, packages, manual = null) {
  const records = new Map(base.map((record) => [record.id, record]));
  const sources = new Map();
  for (const manifest of [...packages, ...(manual ? [manual] : [])]) {
    for (const item of manifest.changes.deleted ?? []) { records.delete(item.id); sources.delete(item.id); }
    for (const record of changedLineups(manifest)) { records.set(record.id, record); sources.set(record.id, manifest); }
  }
  return { lineups: [...records.values()], sources };
}
export function packageStats(manifest) {
  const records = [...changedLineups(manifest), ...(manifest.changes.deleted ?? []).map((item) => item.before)];
  return { maps: new Set(records.map((record) => record.mapId)).size, lineups: records.length, added: manifest.changes.added.length, updated: manifest.changes.updated.length, deleted: manifest.changes.deleted?.length ?? 0 };
}
export function validateReferences(manifest, maps, agents) {
  for (const record of changedLineups(manifest)) {
    if (!maps.some((map) => map.id === record.mapId)) throw new Error('更新包中有无法识别的地图，请获取适用于当前版本的编辑包');
    if (!agents.find((agent) => agent.id === record.agentId)?.abilities.some((ability) => ability.id === record.abilityId)) throw new Error('更新包中的英雄或技能无法识别，请获取适用于当前版本的编辑包');
  }
}
export async function sha256(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
export function verifyImage(bytes, asset) {
  const starts = (signature, offset = 0) => signature.every((byte, index) => bytes[offset + index] === byte);
  const valid = asset.mimeType === 'image/png' ? /\.png$/.test(asset.key) && starts([137,80,78,71,13,10,26,10])
    : asset.mimeType === 'image/jpeg' ? /\.jpe?g$/.test(asset.key) && starts([255,216,255])
      : /\.webp$/.test(asset.key) && starts([82,73,70,70]) && starts([87,69,66,80], 8);
  if (!valid || bytes.length !== asset.size || bytes.length > MAX_IMAGE_BYTES) throw new Error('编辑包中有图片格式或大小不符合要求，请重新获取完整文件');
}
export async function readPackage(bytes) {
  if (bytes.byteLength > MAX_PACKAGE_BYTES) throw new Error('编辑包超过 128 MB，请选择更小的文件');
  const zip = await JSZip.loadAsync(bytes);
  const entry = zip.file('manifest.json');
  if (!entry || entry._data.uncompressedSize > 8 * 1024 * 1024) throw new Error('编辑包资料缺失或过大，请重新获取完整文件');
  const raw = JSON.parse(await entry.async('string'));
  if (![4, 5, 6].includes(raw.version)) throw new Error('当前版本无法读取这个编辑包，请使用本页面导出的编辑包');
  const manifest = manifestSchema.parse(raw);
  const blobs = new Map();
  const failures = [];
  for (const asset of manifest.uploadedAssets) {
    if (failures.some(item => item.lineupId === asset.lineupId)) continue;
    try {
      const file = zip.file(asset.key);
      if (!file || file._data.uncompressedSize !== asset.size) throw new Error('编辑包中的图片缺失或损坏，请重新获取完整文件');
      const data = await file.async('uint8array');
      verifyImage(data, asset);
      if (await sha256(data) !== asset.sha256) throw new Error('编辑包中的图片损坏，请重新获取完整文件');
      blobs.set(asset.sha256, new Blob([data], { type: asset.mimeType }));
    } catch (error) { failures.push(imageFailure(manifest, asset, error)); }
  }
  return excludeFailedLineups({ manifest, blobs }, failures);
}

export function collectChanges(previous, startLineups, lineups) {
  const added = new Map(previous?.changes.added.map((record) => [record.id, record]) ?? []);
  const updated = new Map(previous?.changes.updated.map((change) => [change.id, change]) ?? []);
  const deleted = new Map((previous?.changes.deleted ?? []).map((change) => [change.id, change]));
  const start = new Map(startLineups.map((record) => [record.id, record]));
  const currentIds = new Set(lineups.map((record) => record.id));
  for (const before of startLineups) if (!currentIds.has(before.id)) {
    if (added.has(before.id)) added.delete(before.id);
    else deleted.set(before.id, { id: before.id, before: updated.get(before.id)?.before ?? before });
    updated.delete(before.id);
  }
  for (const record of lineups) {
    const before = start.get(record.id);
    if (same(before, record)) continue;
    if (deleted.has(record.id)) {
      const original = deleted.get(record.id).before; deleted.delete(record.id);
      if (!same(original, record)) updated.set(record.id, { id: record.id, before: original, after: record });
    } else if (added.has(record.id) || !before) added.set(record.id, record);
    else {
      const original = updated.get(record.id)?.before ?? before;
      if (same(original, record)) updated.delete(record.id);
      else updated.set(record.id, { id: record.id, before: original, after: record });
    }
  }
  return { added: [...added.values()], updated: [...updated.values()], ...(deleted.size ? { deleted: [...deleted.values()] } : {}) };
}

// Compare visual asset identity, not encoder-specific filenames, across the WebP migration.
export function sameLineup(left, right, migrations = {}) {
  const normalize = (record) => record && ({ ...record, media: Object.fromEntries(['stance', 'aim', 'effect'].map((kind) => [kind, record.media[kind].map((item) => {
    const original = item.original ?? (migrations[item.key] ? { key: item.key, sha256: migrations[item.key].sourceSha256 } : null);
    if (!original) return item;
    const rest = { ...item }; delete rest.original;
    return { ...rest, key: original.key, imageIdentity: original.sha256 };
  })])) });
  return same(normalize(left), normalize(right));
}

export async function compressPackage(data, encode) {
  const manifest = structuredClone(data.manifest);
  const blobs = new Map();
  for (const asset of manifest.referencedAssets ?? []) if (data.blobs.has(asset.sha256)) blobs.set(asset.sha256, data.blobs.get(asset.sha256));
  for (const asset of manifest.uploadedAssets) {
    const originalBlob = data.blobs.get(asset.sha256);
    if (!originalBlob) throw new Error('部分图片缺失，请重新添加图片或导入原编辑包');
    if (asset.mimeType === 'image/webp') { blobs.set(asset.sha256, originalBlob); continue; }
    const blob = await encode(originalBlob);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const digest = await sha256(bytes);
    const oldKey = asset.key;
    const newKey = oldKey.replace(/\.[^.]+$/, `-${digest.slice(0, 16)}.webp`);
    for (const record of changedLineups(manifest)) for (const kind of ['stance', 'aim', 'effect']) for (const item of record.media[kind]) {
      if (item.key !== oldKey) continue;
      item.original ??= { key: oldKey, sha256: asset.sha256 };
      item.key = newKey;
    }
    Object.assign(asset, { key: newKey, mimeType: 'image/webp', size: blob.size, sha256: digest });
    verifyImage(bytes, asset); blobs.set(digest, blob);
  }
  return { ...data, manifest: manifestSchema.parse(manifest), blobs };
}

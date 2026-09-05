import { z } from 'zod';
import JSZip from 'jszip';

export const PACKAGE_VERSION = 4;
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
}).passthrough();
export const lineupSchema = z.object({
  id, mapId: id, agentId: id, abilityId: id,
  uploader: uploaderSchema,
  title: z.string().min(1).max(200), side: z.enum(['attack', 'defense']), area: z.string().min(1).max(100),
  videoBvid: z.union([z.literal(''), z.string().regex(/^BV[0-9A-Za-z]{10}$/, '教学视频必须填写完整 BV 号')]),
  target: z.object({ groupId: id, x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).passthrough(),
  instructions: z.string().max(1000),
  media: z.object({ stance: z.array(mediaItemSchema), aim: z.array(mediaItemSchema), effect: z.array(mediaItemSchema) }).passthrough(),
}).passthrough().superRefine((lineup, ctx) => {
  for (const item of allMedia([lineup])) if (!item.key.startsWith(`lineups/${lineup.id}/`)) ctx.addIssue({ code: 'custom', message: '图片必须位于所属点位目录' });
});
export const lineupsSchema = z.array(lineupSchema);
export const manifestSchema = z.object({
  format: z.literal('valo-lineup-edit-package'), version: z.literal(PACKAGE_VERSION),
  packageId: z.string().uuid(), revision: z.number().int().positive(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(), author: uploaderSchema,
  changes: z.object({
    added: lineupsSchema.max(10000),
    updated: z.array(z.object({ id, before: lineupSchema, after: lineupSchema }).passthrough()).max(10000),
  }).passthrough(),
  uploadedAssets: z.array(z.object({
    key: mediaItemSchema.shape.key, lineupId: id, kind: z.enum(['stance', 'aim', 'effect']),
    alt: mediaItemSchema.shape.alt, mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    size: z.number().int().positive().max(MAX_IMAGE_BYTES), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }).passthrough()).max(500),
}).passthrough().superRefine((manifest, ctx) => {
  const fail = (message) => ctx.addIssue({ code: 'custom', message });
  const records = changedLineups(manifest);
  if (new Set(records.map((record) => record.id)).size !== records.length) fail('包内点位操作 ID 重复');
  if (manifest.changes.updated.some((update) => update.id !== update.before.id || update.id !== update.after.id)) fail('编辑不能改变点位 ID');
  const media = allMedia(records);
  const assets = new Map(manifest.uploadedAssets.map((asset) => [asset.key, asset]));
  if (assets.size !== manifest.uploadedAssets.length || new Set(media.map((item) => item.key)).size !== media.length) fail('图片路径重复');
  if (assets.size !== media.length) fail('包必须包含所有变更后点位的完整图片');
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
export function same(left, right) {
  const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}
export function applyLayers(base, packages, manual = null) {
  const records = new Map(base.map((record) => [record.id, record]));
  const sources = new Map();
  for (const manifest of [...packages, ...(manual ? [manual] : [])]) {
    for (const record of changedLineups(manifest)) { records.set(record.id, record); sources.set(record.id, manifest); }
  }
  return { lineups: [...records.values()], sources };
}
export function packageStats(manifest) {
  const records = changedLineups(manifest);
  return { maps: new Set(records.map((record) => record.mapId)).size, lineups: records.length, added: manifest.changes.added.length, updated: manifest.changes.updated.length };
}
export function validateReferences(manifest, maps, agents) {
  for (const record of changedLineups(manifest)) {
    if (!maps.some((map) => map.id === record.mapId)) throw new Error(`未知地图：${record.mapId}`);
    if (!agents.find((agent) => agent.id === record.agentId)?.abilities.some((ability) => ability.id === record.abilityId)) throw new Error(`未知英雄或技能：${record.id}`);
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
  if (!valid || bytes.length !== asset.size || bytes.length > MAX_IMAGE_BYTES) throw new Error(`图片类型或大小不合法：${asset.key}`);
}
export async function readPackage(bytes) {
  if (bytes.byteLength > MAX_PACKAGE_BYTES) throw new Error('ZIP 超过 128 MB');
  const zip = await JSZip.loadAsync(bytes);
  const entry = zip.file('manifest.json');
  if (!entry || entry._data.uncompressedSize > 8 * 1024 * 1024) throw new Error('缺少 manifest.json 或清单超过 8 MB');
  const raw = JSON.parse(await entry.async('string'));
  if (raw.version !== PACKAGE_VERSION) throw new Error(`仅支持 v${PACKAGE_VERSION} 更新包，本次格式升级不兼容旧包`);
  const manifest = manifestSchema.parse(raw);
  const blobs = new Map();
  for (const asset of manifest.uploadedAssets) {
    const file = zip.file(asset.key);
    if (!file || file._data.uncompressedSize !== asset.size) throw new Error(`图片缺失或解压大小不一致：${asset.key}`);
    const data = await file.async('uint8array');
    verifyImage(data, asset);
    if (await sha256(data) !== asset.sha256) throw new Error(`图片校验失败：${asset.key}`);
    blobs.set(asset.sha256, new Blob([data], { type: asset.mimeType }));
  }
  return { manifest, blobs };
}

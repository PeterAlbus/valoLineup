import JSZip from 'jszip';
import { allMedia, changedLineups, manifestSchema, same, sha256, verifyImage, type Lineup, type Manifest, type Uploader, type PackageData, type MediaKind } from './package-model.mjs';

export type PackageUpload = { key: string; lineupId: string; kind: MediaKind; alt: string; file: File };

// Preserve the first before snapshot of each ongoing edit, even when lower layers change.
export async function buildManualPackage(options: {
  previous: Manifest | null; packageId: string; author: Uploader;
  startLineups: Lineup[]; lineups: Lineup[];
  image: (lineupId: string, key: string) => Promise<Blob>;
}): Promise<PackageData> {
  const { previous, packageId, author, startLineups, lineups, image } = options;
  const added = new Map(previous?.changes.added.map((record) => [record.id, record]) ?? []);
  const updated = new Map(previous?.changes.updated.map((change) => [change.id, change]) ?? []);
  const start = new Map(startLineups.map((record) => [record.id, record]));
  for (const record of lineups) {
    const before = start.get(record.id);
    if (same(before, record)) continue;
    if (added.has(record.id) || !before) added.set(record.id, record);
    else {
      const original = updated.get(record.id)?.before ?? before;
      if (same(original, record)) updated.delete(record.id);
      else updated.set(record.id, { id: record.id, before: original, after: record });
    }
  }
  const now = new Date().toISOString();
  const manifest: Manifest = {
    format: 'valo-lineup-edit-package', version: 4, packageId,
    revision: (previous?.revision ?? 0) + 1, createdAt: previous?.createdAt ?? now, updatedAt: now, author,
    changes: { added: [...added.values()], updated: [...updated.values()] }, uploadedAssets: [],
  };
  const blobs = new Map<string, Blob>();
  for (const item of allMedia(changedLineups(manifest))) {
    const blob = await image(item.lineupId, item.key);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const asset = { ...item, mimeType: blob.type, size: blob.size, sha256: await sha256(bytes) };
    verifyImage(bytes, asset);
    manifest.uploadedAssets.push(asset); blobs.set(asset.sha256, blob);
  }
  return { manifest: manifestSchema.parse(manifest), blobs };
}

export async function downloadEditPackage({ manifest, blobs }: PackageData) {
  const zip = new JSZip();
  for (const asset of manifest.uploadedAssets) {
    const blob = blobs.get(asset.sha256);
    if (!blob) throw new Error(`导出缺少图片：${asset.key}`);
    zip.file(asset.key, await blob.arrayBuffer());
  }
  zip.file('manifest.json', `${JSON.stringify(manifestSchema.parse(manifest), null, 2)}\n`);
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = `valo-lineup-edits-${manifest.packageId}-r${manifest.revision}.zip`;
  document.body.append(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);
  return { added: manifest.changes.added.length, updated: manifest.changes.updated.length, uploads: manifest.uploadedAssets.length };
}

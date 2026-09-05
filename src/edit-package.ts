import JSZip from 'jszip';

type IdentifiedRecord = { id: string };

export type PackageUpload = {
  key: string;
  lineupId: string;
  kind: 'stance' | 'aim' | 'effect';
  alt: string;
  file: File;
};

type ExportOptions<T extends IdentifiedRecord> = {
  baseLineups: T[];
  lineups: T[];
  uploads: PackageUpload[];
};

function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function packageTimestamp(date: Date) {
  const parts = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0'),
  ];
  return `${parts.slice(0, 3).join('')}-${parts.slice(3).join('')}`;
}

export async function downloadEditPackage<T extends IdentifiedRecord>({
  baseLineups,
  lineups,
  uploads,
}: ExportOptions<T>) {
  const baseById = new Map(baseLineups.map((lineup) => [lineup.id, lineup]));
  const added = lineups.filter((lineup) => !baseById.has(lineup.id));
  const updated = lineups
    .filter((lineup) => {
      const base = baseById.get(lineup.id);
      return base && JSON.stringify(base) !== JSON.stringify(lineup);
    })
    .map((lineup) => ({ id: lineup.id, before: baseById.get(lineup.id)!, after: lineup }));

  const zip = new JSZip();
  const uploadedAssets = await Promise.all(uploads.map(async ({ file, ...upload }) => {
    const bytes = await file.arrayBuffer();
    zip.file(upload.key, bytes);
    return {
      ...upload,
      mimeType: file.type,
      size: file.size,
      sha256: hex(await crypto.subtle.digest('SHA-256', bytes)),
    };
  }));
  const createdAt = new Date();
  zip.file('manifest.json', `${JSON.stringify({
    format: 'valo-lineup-edit-package',
    version: 3,
    createdAt: createdAt.toISOString(),
    changes: { added, updated },
    uploadedAssets,
  }, null, 2)}\n`);

  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = `valo-lineup-edits-${packageTimestamp(createdAt)}.zip`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);

  return { added: added.length, updated: updated.length, uploads: uploadedAssets.length };
}

import sharp from 'sharp';
export async function encodeWebp(blob) {
  if (blob.type === 'image/webp') return blob;
  const bytes = await sharp(new Uint8Array(await blob.arrayBuffer()), { limitInputPixels: 48_000_000 }).rotate().webp({ quality: 86, effort: 4 }).toBuffer();
  return new Blob([bytes], { type: 'image/webp' });
}

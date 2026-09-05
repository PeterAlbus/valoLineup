import { MAX_IMAGE_BYTES } from './package-model.mjs';

export async function encodeWebp(file: Blob): Promise<Blob> {
  if (file.type === 'image/webp') return file;
  const image = await createImageBitmap(file);
  try {
    // Preserve aiming details at native resolution; reject pathological decoded dimensions.
    if (image.width * image.height > 48_000_000) throw new Error('图片像素超过 4800 万，请先缩小再上传');
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前浏览器无法压缩图片');
    context.drawImage(image, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result?.type === 'image/webp' ? resolve(result) : reject(new Error('当前浏览器不支持 WebP 编码，请上传 WebP 图片')), 'image/webp', 0.86));
    if (blob.size > MAX_IMAGE_BYTES) throw new Error('压缩后图片仍超过 12 MiB，请缩小图片后重试');
    return blob;
  } finally { image.close(); }
}

export function formatBytes(bytes: number) {
  if (!bytes) return '0 B';
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

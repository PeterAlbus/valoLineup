import { compressPackage, manifestSchema, type Manifest, type PackageData, type Asset } from './package-model.mjs';
import { encodeWebp } from './image-compression';

export const STORAGE_KEY = `valo-lineup:v4:${new URL(import.meta.env.BASE_URL, location.href).pathname}`;
export type LocalLibrary = { version: 1; token: string; packages: Manifest[]; manual: Manifest | null };
export const emptyLibrary = (): LocalLibrary => ({ version: 1, token: '', packages: [], manual: null });
let database: Promise<IDBDatabase> | undefined;
function db() {
  return database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(`${STORAGE_KEY}:images`, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('blobs');
    request.onerror = () => { database = undefined; reject(request.error); };
    request.onblocked = () => { database = undefined; reject(new Error('图片数据库被其他页面占用，请关闭其他标签页后重试')); };
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); database = undefined; };
      resolve(request.result);
    };
  });
}
export function readLibrary(): LocalLibrary {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return emptyLibrary();
  const value = JSON.parse(raw);
  if (value.version !== 1 || typeof value.token !== 'string' || !Array.isArray(value.packages)) throw new Error('本地资料格式无法识别；未覆盖原始数据，请先备份浏览器数据');
  const packages = value.packages.map((item: unknown) => manifestSchema.parse(item));
  if (new Set(packages.map((item: Manifest) => item.packageId)).size !== packages.length) throw new Error('本地更新包 ID 重复');
  return { version: 1, token: value.token, packages, manual: value.manual === null ? null : manifestSchema.parse(value.manual) };
}
export async function readImage(asset: Asset): Promise<Blob> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const request = database.transaction('blobs', 'readonly').objectStore('blobs').get(asset.sha256);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => request.result instanceof Blob && request.result.size === asset.size
      ? resolve(request.result) : reject(new Error(`本地图片丢失：${asset.key}。请重新导入原包恢复图片`));
  });
}
function assetsOf(library: LocalLibrary) { return [...library.packages, ...(library.manual ? [library.manual] : [])].flatMap((item) => item.uploadedAssets); }
const migrations = new Map<string, Promise<LocalLibrary>>();
export async function migrateLegacyImages(library: LocalLibrary): Promise<LocalLibrary> {
  if (!assetsOf(library).some((asset) => asset.mimeType !== 'image/webp')) return library;
  const pending = migrations.get(library.token);
  if (pending) return pending;
  const work = convertLegacyImages(library);
  migrations.set(library.token, work);
  try { return await work; } finally { migrations.delete(library.token); }
}
async function convertLegacyImages(library: LocalLibrary) {
  const incoming = new Map<string, Blob>();
  const convert = async (manifest: Manifest) => {
    const blobs = new Map<string, Blob>();
    for (const asset of manifest.uploadedAssets) blobs.set(asset.sha256, await readImage(asset));
    const data = await compressPackage({ manifest, blobs }, encodeWebp);
    data.blobs.forEach((blob, key) => incoming.set(key, blob));
    return data.manifest;
  };
  const packages: Manifest[] = [];
  for (const manifest of library.packages) packages.push(await convert(manifest));
  const manual = library.manual ? await convert(library.manual) : null;
  return persistLibrary(library, { ...library, packages, manual }, { manifest: manual ?? packages[0], blobs: incoming });
}
export async function libraryUrls(library: LocalLibrary, incoming = new Map<string, Blob>()) {
  const result = new Map<string, string>();
  try {
    for (const asset of assetsOf(library)) if (!result.has(asset.sha256)) result.set(asset.sha256, URL.createObjectURL(incoming.get(asset.sha256) ?? await readImage(asset)));
    return result;
  } catch (error) { result.forEach((url) => URL.revokeObjectURL(url)); throw error; }
}
export async function persistLibrary(previous: LocalLibrary, next: LocalLibrary, data?: PackageData): Promise<LocalLibrary> {
  const commit = async () => {
    if (readLibrary().token !== previous.token) throw new Error('另一标签页已修改本地资料，请先导出当前草稿再刷新，避免覆盖');
    const blobs = data?.blobs ?? new Map<string, Blob>();
    const database = await db();
    // Images commit first; metadata is the commit marker, so failed writes preserve the visible library.
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction('blobs', 'readwrite');
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
      for (const [digest, blob] of blobs) tx.objectStore('blobs').put(blob, digest);
    });
    for (const asset of assetsOf(next)) await readImage(asset);
    if (readLibrary().token !== previous.token) throw new Error('另一标签页已修改本地资料，请先导出当前草稿再刷新');
    const committed = { ...next, token: crypto.randomUUID() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(committed));
    // GC only under a cross-tab lock and after commit; cleanup failure must not report a failed save.
    if (navigator.locks) {
      const used = new Set(assetsOf(committed).map((asset) => asset.sha256));
      await new Promise<void>((resolve) => {
        const tx = database.transaction('blobs', 'readwrite');
        tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
        const cursor = tx.objectStore('blobs').openCursor();
        cursor.onsuccess = () => { const item = cursor.result; if (!item) return; if (!used.has(String(item.key))) item.delete(); item.continue(); };
      }).catch(() => {});
    }
    return committed;
  };
  try { return navigator.locks ? await navigator.locks.request(STORAGE_KEY, commit) : await commit(); }
  catch (error) {
    if (error instanceof DOMException && error.name === 'QuotaExceededError') throw new Error('浏览器存储空间不足，未保存此次操作。请先导出草稿或删除不用的更新包');
    throw error;
  }
}

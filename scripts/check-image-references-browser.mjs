import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import sharp from 'sharp';
import { browserFixture, requireFixtureServer } from './fixtures/browser.mjs';
import { allMedia, manifestSchema, sha256 } from '../src/package-model.mjs';

const [debugUrl = 'http://127.0.0.1:9335', appUrl = 'http://127.0.0.1:4174/'] = process.argv.slice(2);
await requireFixtureServer(appUrl);
const content = await browserFixture();
const base = content.lineups[0];
const other = content.lineups.find(item => item.id === 'test-independent');
const tabs = await (await fetch(`${debugUrl}/json`)).json();
const tab = tabs.find(item => item.type === 'page' && item.url.startsWith(appUrl));
assert(tab, 'Open the synthetic app in an isolated browser');
const socket = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let sequence = 0;
const pending = new Map();
socket.onmessage = event => {
  const message = JSON.parse(event.data);
  const request = pending.get(message.id);
  if (!request) return;
  clearTimeout(request.timer); pending.delete(message.id);
  if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
};
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timeout`)); }, 15000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
async function wait(expression) {
  for (let i = 0; i < 100; i++) {
    if (await evaluate(`Boolean(${expression})`)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Condition failed: ${expression}\n${await evaluate("document.querySelector('.editor-message')?.textContent")}`);
}
const storageKey = `valo-lineup:v4:${new URL(appUrl).pathname}`;
const storage = `JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)}))`;
const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
async function navigate() {
  await send('Page.navigate', { url: appUrl });
  await wait(`document.querySelector('.editor-enter') && !document.querySelector('.editor-enter').disabled`);
  await evaluate(`window.toy={isSupport:async()=>true,getUserProfile:async()=>({nickname:'Reference Tester',toyOpenId:'test-reference-only'})}`);
}
async function reset() {
  await send('Storage.clearDataForOrigin', { origin: new URL(appUrl).origin, storageTypes: 'local_storage,indexeddb' });
  await navigate();
}
async function importFixture(manifest, images = []) {
  const zip = new JSZip(); zip.file('manifest.json', JSON.stringify(manifestSchema.parse(manifest)));
  for (const [key, bytes] of images) zip.file(key, bytes);
  const encoded = await zip.generateAsync({ type: 'base64' });
  await evaluate(`(() => {const input=document.querySelector('.topbar .package-import input'); const dt=new DataTransfer();dt.items.add(new File([Uint8Array.from(atob(${JSON.stringify(encoded)}), c=>c.charCodeAt(0))],'reference-fixture.zip',{type:'application/zip'})); input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await wait(`!document.querySelector('.topbar .package-import input').disabled`);
}
async function exported() {
  await evaluate(`window.exportedBlob=null; if(!window.originalCreate){window.originalCreate=URL.createObjectURL;URL.createObjectURL=function(blob){if(blob.type==='application/zip')window.exportedBlob=blob;return window.originalCreate.call(this,blob)}}`);
  await click('.editor-export'); await wait(`window.exportedBlob && !document.querySelector('.editor-export').disabled`);
  return evaluate(`(async()=>{const {default:JSZip}=await import('/node_modules/.vite/deps/jszip.js');const zip=await JSZip.loadAsync(await window.exportedBlob.arrayBuffer());return {manifest:JSON.parse(await zip.file('manifest.json').async('string')),files:Object.keys(zip.files)}})()`);
}
try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Browser.setDownloadBehavior', { behavior: 'deny' });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await reset();
  await click('.editor-enter'); await wait(`document.querySelector('.instructions-editor textarea')`);
  await evaluate(`(() => {const input=document.querySelector('.instructions-editor textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Only text changed');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await wait(`!document.querySelector('.editor-save').disabled`);
  assert.equal(await evaluate(`document.querySelector('.package-size progress').value`), 0);
  await click('.editor-save'); await wait(`${storage}?.manual && document.querySelector('.editor-save').disabled`);
  const saved = await evaluate(`${storage}.manual`);
  assert.equal(saved.version, 6);
  assert.equal(saved.uploadedAssets.length, 0);
  assert.equal(saved.referencedAssets.length, allMedia([base]).length);
  const firstExport = await exported();
  assert.deepEqual(firstExport.files, ['manifest.json'], 'UI text-only export must contain no image files');
  assert.equal(firstExport.manifest.packageId, saved.packageId);
  assert.equal(firstExport.manifest.revision, saved.revision);
  assert(await evaluate(`(async()=>{const {readImage}=await import('/src/local-library.ts');for(const asset of ${storage}.manual.referencedAssets)if(!(await readImage(asset)).size)return false;return true})()`), 'Referenced bytes are cached in IDB');
  await click('.editor-cancel'); await wait(`document.querySelector('.exit-edit-dialog')?.open`);
  await click('.exit-edit-confirm'); await wait(`document.querySelector('.editor-enter')`);
  await navigate();
  await wait(`document.querySelector('.media-preview-button img')?.complete`);
  assert(await evaluate(`Array.from(document.querySelectorAll('.media-preview-button img')).every(img=>img.src.startsWith('blob:') && img.naturalWidth>0)`));
  // Previously saved full-image v4 edits must also shrink when exported without further edits.
  await evaluate(`(async()=>{const lib=await import('/src/local-library.ts');const old=lib.readLibrary();const manual={...old.manual,version:4,uploadedAssets:old.manual.referencedAssets};delete manual.referencedAssets;await lib.persistLibrary(old,{...old,manual})})()`);
  await navigate();
  const legacyExport = await exported();
  assert.deepEqual(legacyExport.files, ['manifest.json']);
  assert.equal(legacyExport.manifest.version, 6);
  console.log('PASS text-only zero-image ZIP/counter, cached references after reload, saved v4 export compaction');

  await reset();
  const prior = manifestSchema.parse({ ...saved, packageId: randomUUID(), changes: { added: [], updated: [{ id: base.id, before: base, after: { ...base, instructions: 'Retain previous on failure' } }] } });
  await importFixture(prior);
  const bytes = await sharp({ create: { width: 13, height: 11, channels: 3, background: '#182b54' } }).webp().toBuffer();
  const asset = { key: `lineups/${base.id}/external-reference.webp`, alt: '来源包图片', lineupId: base.id, kind: 'aim', mimeType: 'image/webp', size: bytes.length, sha256: await sha256(bytes) };
  const final = { ...base, instructions: 'Recovered dependent edit', media: { stance: [], aim: [{ key: asset.key, alt: asset.alt }], effect: [] } };
  const partial = { ...prior, revision: prior.revision + 1, referencedAssets: [asset], changes: { added: [], updated: [
    { id: base.id, before: base, after: final }, { id: other.id, before: other, after: { ...other, instructions: 'Independent success' } },
  ] } };
  await importFixture(partial);
  assert(await evaluate(`document.querySelector('.editor-message').textContent.includes('跳过 1 个')`));
  const result = await evaluate(`${storage}.packages[0]`);
  assert.equal(result.changes.updated.find(item => item.id === base.id).after.instructions, 'Retain previous on failure');
  assert.equal(result.changes.updated.find(item => item.id === other.id).after.instructions, 'Independent success');
  assert.deepEqual(result.referencedAssets, prior.referencedAssets, 'Failed revision keeps previous image declarations');
  await navigate();
  assert.equal(await evaluate(`document.querySelector('.detail-lead').textContent`), 'Retain previous on failure');
  assert(await evaluate(`Array.from(document.querySelectorAll('.media-preview-button img')).every(img=>img.src.startsWith('blob:'))`));

  // Import the dependency, put it below the dependent edit, then retry the same package.
  const dependency = { ...prior, version: 4, packageId: randomUUID(), referencedAssets: undefined, uploadedAssets: [asset], changes: { added: [], updated: [{ id: base.id, before: base, after: { ...final, instructions: 'Dependency source' } }] } };
  await importFixture(dependency, [[asset.key, bytes]]);
  await click('.history-toggle'); await wait(`document.querySelector('.package-list')`);
  await click('.package-list li:last-child button:first-child');
  await wait(`${storage}.packages[0].packageId === '${dependency.packageId}'`);
  await click('.history-toggle'); await wait(`!document.querySelector('.history-page')`);
  await importFixture(partial);
  assert(await evaluate(`document.querySelector('.editor-message').textContent.includes('更新包已导入')`));
  await wait(`document.querySelector('.detail-lead').textContent === 'Recovered dependent edit'`);
  assert.equal(await evaluate(`${storage}.packages.length`), 2, 'Retry does not append a duplicate package');
  const token = await evaluate(`${storage}.token`);
  await importFixture({ ...partial, referencedAssets: [{ ...asset, sha256: '0'.repeat(64) }], changes: { added: [], updated: [partial.changes.updated[0]] } });
  assert.equal(await evaluate(`${storage}.token`), token, 'All lineups failing leaves the entire existing library untouched');
  assert(await evaluate(`document.querySelector('.editor-message').textContent.includes('没有可导入的点位')`));
  await click('.history-toggle'); await wait(`document.querySelector('.package-list')`);
  await click('.package-list li:first-child button:last-child'); await wait(`document.querySelector('.confirm-dialog')?.open`);
  await click('.confirm-accept'); await wait(`${storage}.packages.length === 1`);
  await click('.history-toggle'); await navigate();
  await wait(`document.querySelector('.media-preview-button img')?.naturalWidth > 0`);
  assert.equal(await evaluate(`document.querySelector('.detail-lead').textContent`), 'Recovered dependent edit');
  assert(await evaluate(`document.querySelector('.media-preview-button img').src.startsWith('blob:')`), 'Successfully resolved images survive removing their original package');
  console.log('PASS partial import, retained same-package revision, local image dependency retry, all-failed no-op and cached images after dependency removal');
  await reset();
} finally { socket.close(); }

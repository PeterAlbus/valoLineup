// Isolated Chromium integration check: node scripts/check-local-library.mjs [debug URL] [app URL]
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import JSZip from 'jszip';
import sharp from 'sharp';
import { applyLayers, manifestSchema, readPackage, same } from '../src/package-model.mjs';

const [debugUrl = 'http://127.0.0.1:9335', appUrl = 'http://127.0.0.1:4174/'] = process.argv.slice(2);
const content = JSON.parse(await readFile('src/data/content.json', 'utf8'));
const base = content.lineups[0];
async function fixture(label, color, packageId = randomUUID()) {
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 4, background: color } }).png().toBuffer();
  const key = `lineups/${base.id}/test-overlay.png`;
  const after = { ...base, instructions: label, media: { stance: [], aim: [{ key, alt: label }], effect: [] } };
  if (label === 'Overlay B') after.target = { ...base.target, x: 0.75, y: 0.1 };
  const manifest = manifestSchema.parse({
    format: 'valo-lineup-edit-package', version: 4, packageId, revision: 1,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), author: { name: label, source: 'toy', toyOpenId: `test-${label}` },
    changes: { added: [], updated: [{ id: base.id, before: base, after }] },
    uploadedAssets: [{ key, alt: label, lineupId: base.id, kind: 'aim', mimeType: 'image/png', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }],
  });
  const zip = new JSZip(); zip.file('manifest.json', JSON.stringify(manifest)); zip.file(key, bytes);
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  return { manifest, base64: buffer.toString('base64'), imageBase64: bytes.toString('base64'), buffer };
}
const a = await fixture('Overlay A', '#ff0000');
const b = await fixture('Overlay B', '#0000ff');
assert.equal(applyLayers(content.lineups, [a.manifest, b.manifest]).lineups[0].instructions, 'Overlay B');
assert.equal(applyLayers(content.lineups, [b.manifest, a.manifest]).lineups[0].instructions, 'Overlay A');
assert.equal(applyLayers(content.lineups, [b.manifest], a.manifest).lineups[0].instructions, 'Overlay A');
assert.equal((await readPackage(a.buffer)).manifest.packageId, a.manifest.packageId);
assert(same({ a: 1, b: 2 }, { b: 2, a: 1 }));
const invalid = await JSZip.loadAsync(a.buffer);
invalid.file('manifest.json', JSON.stringify({ ...a.manifest, version: 3 }));
await assert.rejects(readPackage(await invalid.generateAsync({ type: 'nodebuffer' })), /当前版本无法读取/);
invalid.file('manifest.json', JSON.stringify(a.manifest));
invalid.file(a.manifest.uploadedAssets[0].key, Buffer.alloc(a.manifest.uploadedAssets[0].size));
await assert.rejects(readPackage(await invalid.generateAsync({ type: 'nodebuffer' })), /图片/);

const tabs = await fetch(`${debugUrl}/json`).then((response) => response.json());
const tab = tabs.find((item) => item.type === 'page' && item.url.startsWith(appUrl));
assert(tab, 'Start an isolated browser pointing at the app');
const socket = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let id = 0;
const pending = new Map();
const exceptions = [];
socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params);
  const request = pending.get(message.id);
  if (!request) return;
  clearTimeout(request.timer); pending.delete(message.id);
  if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
};
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => reject(new Error(`${method} timeout`)), 15000);
    pending.set(requestId, { resolve, reject, timer }); socket.send(JSON.stringify({ id: requestId, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(expression) {
  for (let attempt = 0; attempt < 100; attempt++) { if (await evaluate(`Boolean(${expression})`)) return; await delay(100); }
  throw new Error(`Condition failed: ${expression}\n${await evaluate("document.querySelector('.editor-message')?.textContent")}`);
}
async function click(selector) {
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  if (selector === '.editor-cancel') {
    await waitFor(`document.querySelector('.exit-edit-dialog')?.open`);
    await evaluate(`document.querySelector('.exit-edit-confirm').click()`);
    await waitFor(`!document.querySelector('.exit-edit-dialog')`);
  }
  if (['.lineup-delete', '.package-list li:nth-child(2) button:last-child', '.local-edit-card button:last-child'].includes(selector)) {
    await waitFor(`document.querySelector('.confirm-dialog')?.open`);
    await evaluate(`document.querySelector('.confirm-accept').click()`);
    await waitFor(`!document.querySelector('.confirm-dialog')`);
  }
}
const storage = `JSON.parse(localStorage.getItem('valo-lineup:v4:/'))`;
async function navigate() {
  await send('Page.navigate', { url: appUrl });
  await waitFor(`document.querySelector('.editor-enter') && !document.querySelector('.editor-enter').disabled`);
  await evaluate(`window.confirm = () => true; window.toy = {isSupport:async()=>true,getUserProfile:async()=>({nickname:'Browser Tester',avatar:'',toyOpenId:'test-private-id'}),navigate:async(req)=>{window.lastNavigate=req}}`);
}
async function importFixture(fixture) {
  await evaluate(`(() => {const bytes=Uint8Array.from(atob(${JSON.stringify(fixture.base64)}),c=>c.charCodeAt(0));const input=document.querySelector('.package-import input');const dt=new DataTransfer();dt.items.add(new File([bytes],'fixture.zip',{type:'application/zip'}));input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await waitFor(`!document.querySelector('.package-import input').disabled`);
}
async function instructions(text) {
  await evaluate(`(() => { const input = document.querySelector('.instructions-editor textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await waitFor(`!document.querySelector('.editor-save').disabled`);
}
async function imageDigest() {
  return evaluate(`(async () => {const bytes=await (await fetch(document.querySelector('.media-preview-button img').src)).arrayBuffer(); return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('')})()`);
}
async function screenshot(name) {
  if (!process.env.LIBRARY_SCREENSHOT_DIR) return;
  const image = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(`${process.env.LIBRARY_SCREENSHOT_DIR}/${name}.png`, Buffer.from(image.data, 'base64'));
}
try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Browser.setDownloadBehavior', { behavior: 'deny' }); // Inspect the ZIP Blob without writing to the user's Downloads folder.
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await navigate();
  await evaluate(`localStorage.removeItem('valo-lineup:v4:/')`); await navigate();
  await evaluate(`window.toy.getUserProfile=async()=>{throw new Error('用户取消授权')}`);
  await click('.editor-enter'); await waitFor(`document.querySelector('.instructions-editor')`);
  assert(await evaluate(`document.querySelector('.editor-message').textContent.includes('匿名编辑者')`));
  await click('.editor-cancel');
  await waitFor(`document.querySelector('.editor-enter')`);
  await evaluate(`window.toy.getUserProfile=async()=>({nickname:'Browser Tester',avatar:'',toyOpenId:'test-private-id'})`);
  await click('.uploader-link'); assert.deepEqual(await evaluate('window.lastNavigate'), { type: 'space', id: '2003822' });
  await click('.history-toggle'); await waitFor(`document.querySelector('.history-page')`);
  await importFixture(a); await importFixture(b);
  assert.equal(await evaluate(`${storage}.packages.length`), 2);
  await click('.history-toggle'); await waitFor(`document.querySelector('.detail-lead').textContent === 'Overlay B'`);
  assert.equal(await evaluate(`!!document.querySelector('.method-picker')`), false, 'A partially moved shared group must display its independent destination without conflicts');
  assert.equal(await imageDigest(), await evaluate(`${storage}.packages[1].uploadedAssets[0].sha256`), 'Same logical image keys must resolve to the winning layer');
  assert.equal(await evaluate(`${storage}.packages[1].uploadedAssets[0].mimeType`), 'image/webp');
  assert.equal(await evaluate(`${storage}.packages[1].changes.updated[0].after.media.aim[0].original.sha256`), b.manifest.uploadedAssets[0].sha256);
  await click('.history-toggle'); await waitFor(`document.querySelector('.package-list')`);
  await click('.package-list li:nth-child(2) button:first-child');
  await waitFor(`${storage}.packages[1].packageId === '${a.manifest.packageId}'`);
  await click('.history-toggle'); await waitFor(`document.querySelector('.detail-lead').textContent === 'Overlay A'`);
  assert.equal(await imageDigest(), await evaluate(`${storage}.packages[1].uploadedAssets[0].sha256`));
  console.log('PASS browser unconditional overlays, reorder, image isolation, Bilibili space navigation');

  await click('.editor-enter'); await waitFor(`document.querySelector('.instructions-editor')`);
  await instructions('Manual first save');
  await click('.media-paste');
  await evaluate(`(() => {const bytes=Uint8Array.from(atob('${a.imageBase64}'),c=>c.charCodeAt(0));const dt=new DataTransfer();dt.items.add(new File([bytes],'upload.png',{type:'image/png'}));document.querySelector('.media-paste').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,clipboardData:dt}));})()`);
  await waitFor(`!document.querySelector('.editor-save').disabled && document.querySelector('.media-item.is-pending')`);
  await click('.editor-save'); await waitFor(`${storage}.manual?.changes.updated[0].after.instructions === 'Manual first save' && document.querySelector('.editor-save').disabled`);
  const manualId = await evaluate(`${storage}.manual.packageId`);
  assert.equal(await evaluate(`${storage}.manual.author.toyOpenId`), 'test-private-id');
  assert.equal(await evaluate(`${storage}.manual.changes.updated[0].after.uploader.bilibiliUid`), '2003822', 'Editing keeps original uploader');
  assert.equal(await evaluate(`${storage}.manual.uploadedAssets.length`), 2);
  assert(await evaluate(`${storage}.manual.uploadedAssets.every(asset=>asset.mimeType==='image/webp' && asset.key.endsWith('.webp'))`));
  assert.equal(await evaluate(`Number(document.querySelector('.package-size progress').value)`), await evaluate(`${storage}.manual.uploadedAssets.reduce((sum,asset)=>sum+asset.size,0)`));
  await evaluate(`document.querySelector('.media-add-actions').scrollIntoView({block:'center'})`);
  await screenshot('webp-editor');
  await instructions('Unsaved throwaway');
  await evaluate("window.confirm=()=>false; document.querySelector('.editor-cancel').click()");
  await waitFor(`document.querySelector('.exit-edit-dialog')?.open`);
  await click('.exit-edit-continue');
  assert(await evaluate(`!!document.querySelector('.instructions-editor')`));
  await evaluate('window.confirm=()=>true'); await click('.editor-cancel');
  await waitFor(`document.querySelector('.detail-lead')?.textContent === 'Manual first save'`);
  await navigate();
  await waitFor(`document.querySelector('.detail-lead')?.textContent === 'Manual first save'`);
  assert(await evaluate(`document.querySelector('.media-preview-button img').src.startsWith('blob:')`));
  await click('.editor-enter'); await waitFor(`document.querySelector('.instructions-editor')`);
  await instructions('Manual second save'); await click('.editor-save');
  await waitFor(`${storage}.manual.revision === 2 && document.querySelector('.editor-save').disabled`);
  assert.equal(await evaluate(`${storage}.manual.packageId`), manualId);
  assert.equal(await evaluate(`${storage}.manual.changes.updated[0].before.instructions`), 'Overlay A');
  assert.equal(await evaluate(`${storage}.packages.length`), 2, 'Save must not create imported packages');
  console.log('PASS save/reload/resume, one cumulative editing layer, image persistence, confirmed discard');

  const savedToken = await evaluate(`${storage}.token`);
  await instructions('Quota failure draft');
  await evaluate(`window.realSetItem=Storage.prototype.setItem; Storage.prototype.setItem=function(key,value){if(key==='valo-lineup:v4:/')throw new DOMException('full','QuotaExceededError');return window.realSetItem.call(this,key,value)}`);
  await click('.editor-save'); await waitFor(`document.querySelector('.editor-message').textContent.includes('存储空间不足')`);
  assert.equal(await evaluate(`${storage}.token`), savedToken);
  assert.equal(await evaluate(`document.querySelector('.instructions-editor textarea').value`), 'Quota failure draft');
  await evaluate('Storage.prototype.setItem=window.realSetItem');
  await evaluate(`window.realCreate=URL.createObjectURL; URL.createObjectURL=function(blob){if(blob.type==='application/zip')window.exportedBlob=blob;return window.realCreate.call(this,blob)}`);
  await click('.editor-export'); await waitFor('!!window.exportedBlob');
  const exported = await evaluate(`(async()=>{const {readPackage}=await import('/src/package-model.mjs');return (await readPackage(await window.exportedBlob.arrayBuffer())).manifest})()`);
  assert.equal(exported.packageId, manualId); assert.equal(exported.changes.updated.length, 1);
  assert.equal(exported.changes.updated[0].after.instructions, 'Quota failure draft');
  assert.equal(await evaluate(`${storage}.manual.changes.updated[0].after.instructions`), 'Manual second save', 'Export must not silently save or clear edits');
  await waitFor(`!document.querySelector('.editor-cancel').disabled`); await click('.editor-cancel');
  await click('.history-toggle'); await waitFor(`document.querySelector('.local-edit-card')`);
  await screenshot('history-desktop');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await delay(200); await screenshot('history-mobile');
  assert(await evaluate(`!document.querySelector('.editing-toolbar') && !document.querySelector('.local-edit-card .action-primary').disabled && document.querySelector('.local-edit-card .action-primary').getBoundingClientRect().height >= 36`), 'Mobile history offers compact export for saved local edits');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await click('.package-list li:nth-child(2) button:last-child'); await waitFor(`${storage}.packages.length === 1`);
  await click('.history-toggle'); await waitFor(`document.querySelector('.detail-lead').textContent === 'Manual second save'`);
  assert.equal(await imageDigest(), await evaluate(`${storage}.manual.uploadedAssets[0].sha256`), 'Manual images survive removing dependency package');
  await click('.history-toggle'); await waitFor(`document.querySelector('.local-edit-card')`);
  await click('.local-edit-card button:last-child'); await waitFor(`${storage}.manual === null`);
  await importFixture(b); assert.equal(await evaluate(`${storage}.packages.length`), 1, 'Reimport replaces same package ID in place');
  const goodToken = await evaluate(`${storage}.token`);
  await importFixture({ base64: Buffer.from('not a zip').toString('base64') });
  assert.equal(await evaluate(`${storage}.token`), goodToken, 'Invalid imports do not mutate the library');
  await click('.history-toggle'); await waitFor(`!document.querySelector('.history-page')`);
  await click('.editor-enter'); await waitFor(`document.querySelector('.editor-new')`);
  await click('.perspective-controls button:nth-child(2)');
  await click('.editor-new'); await waitFor(`document.querySelector('.placement-banner')`);
  const placement = await evaluate(`(() => {const r=document.querySelector('.map-canvas').getBoundingClientRect();return {x:r.x+r.width*.78,y:r.y+r.height/2}})()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...placement, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...placement, button: 'left', clickCount: 1 });
  await waitFor(`document.querySelector('.new-lineup-heading')`);
  assert.equal(await evaluate(`document.querySelector('[aria-label="点位阵营"]').value`), 'defense');
  await click('.area-shortcuts button:nth-child(2)');
  assert.equal(await evaluate(`document.querySelector('[aria-label="点位区域"]').value`), 'B点');
  await evaluate(`(() => {const input=document.querySelector('[aria-label="点位区域"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'自定义区域');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await evaluate(`(() => {const input=document.querySelector('[aria-label="点位名称"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'SDK 新点位');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await waitFor(`document.querySelector('.detail-panel h2').textContent === 'SDK 新点位'`);
  const pin = await evaluate(`(() => {const r=document.querySelector('.lineup-pin.is-active').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pin.x, y: pin.y, button: 'left', clickCount: 1 });
  for (let step = 1; step <= 4; step++) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pin.x + 10 * step, y: pin.y, button: 'left', buttons: 1 }); await delay(25); }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pin.x + 40, y: pin.y, button: 'left', clickCount: 1 });
  assert.equal(await evaluate(`window.getSelection().toString()`), '', 'Dragging right side must not select text');
  assert(await evaluate(`(() => {const img=document.querySelector('.lineup-pin.is-active img');const event=new DragEvent('dragstart',{bubbles:true,cancelable:true});img.dispatchEvent(event);return event.defaultPrevented})()`), 'Native image dragging is suppressed');
  await click('.editor-save'); await waitFor(`${storage}.manual?.changes.added.length === 1 && document.querySelector('.editor-save').disabled`);
  const created = await evaluate(`${storage}.manual.changes.added[0]`);
  assert(Math.hypot(created.target.x - 0.5, created.target.y - 0.78) > 0.04, `Dragging right-side pin must preserve pointer capture across coordinate updates: ${JSON.stringify(created.target)}`);
  assert.equal(created.uploader.name, 'Browser Tester');
  assert.equal(created.side, 'defense'); assert.equal(created.area, '自定义区域');
  assert.equal(created.uploader.toyOpenId, 'test-private-id');
  assert(!('bilibiliUid' in created.uploader), 'SDK identities must never invent a UID');
  const createdPackageId = await evaluate(`${storage}.manual.packageId`);
  await instructions('继续编辑新增点位'); await click('.editor-save');
  await waitFor(`${storage}.manual?.revision === 2 && document.querySelector('.editor-save').disabled`);
  assert.equal(await evaluate(`${storage}.manual.packageId`), createdPackageId);
  assert.equal(await evaluate(`${storage}.manual.changes.added[0].id`), created.id);
  assert.equal(await evaluate(`${storage}.manual.changes.updated.length`), 0);
  await evaluate(`(() => {const input=document.querySelector('input[aria-label="点位名称"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'改名后的点位');input.dispatchEvent(new Event('input',{bubbles:true})); const side=document.querySelector('select[aria-label="点位阵营"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(side,'attack');side.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await click('.editor-save'); await waitFor(`${storage}.manual.revision === 3 && document.querySelector('.editor-save').disabled`);
  assert.equal(await evaluate(`${storage}.manual.changes.added[0].title`), '改名后的点位');
  assert.equal(await evaluate(`${storage}.manual.changes.added[0].side`), 'attack');
  await click('.lineup-delete'); await click('.editor-save'); await waitFor(`${storage}.manual === null && document.querySelector('.editor-save').disabled`);
  await click('.map-card:first-child');
  await click('.side-filter button:last-child');
  await click('.lineup-delete'); await click('.editor-save');
  await waitFor(`${storage}.manual?.changes.deleted?.length === 1 && document.querySelector('.editor-save').disabled`);
  const deletedId = await evaluate(`${storage}.manual.changes.deleted[0].id`);
  assert.equal(await evaluate(`${storage}.manual.version`), 5);
  assert.equal(await evaluate(`${storage}.manual.uploadedAssets.length`), 0);
  await click('.editor-cancel'); await navigate();
  assert(await evaluate(`!document.querySelector('.detail-panel h2').textContent.includes('改名后的点位')`));
  assert.equal(await evaluate(`(async()=>{const {applyLayers}=await import('/src/package-model.mjs');const c=await(await fetch('/src/data/content.json')).json();const l=${storage};return applyLayers(c.lineups,l.packages,l.manual).lineups.some(item=>item.id==='${deletedId}')})()`), false);
  await click('.history-toggle'); await waitFor(`document.querySelector('.local-edit-card')`);
  await click('.local-edit-card button:last-child'); await waitFor(`${storage}.manual === null`);
  console.log('PASS anonymous editing after denied authorization, authenticated new uploader, stable new lineup/package IDs, invalid ZIP atomic rejection');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await delay(250);
  assert(await evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Mobile history must not overflow');
  await click('.history-toggle'); await waitFor(`document.querySelector('.detail-lead').textContent === 'Overlay B'`);
  await evaluate(`localStorage.removeItem('valo-lineup:v4:/')`);
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await navigate();
  // Seed the exact storage shape used by the previous release, including original PNG blobs.
  await evaluate(`(async()=>{const lib=await import('/src/local-library.ts');const {readPackage}=await import('/src/package-model.mjs');const bytes=Uint8Array.from(atob('${a.base64}'),c=>c.charCodeAt(0));const data=await readPackage(bytes);const old=lib.readLibrary();await lib.persistLibrary(old,{...old,packages:[data.manifest],manual:null},data)})()`);
  await navigate();
  assert.equal(await evaluate(`${storage}.packages[0].uploadedAssets[0].mimeType`), 'image/webp', 'Previous release localStorage/IndexedDB data migrates on startup');
  assert.equal(await evaluate(`${storage}.packages[0].packageId`), a.manifest.packageId);
  assert.equal(await evaluate(`${storage}.packages[0].revision`), 1);
  assert.equal(await evaluate(`document.querySelector('.detail-lead').textContent`), 'Overlay A');
  assert(await evaluate(`document.querySelector('.media-preview-button img').src.startsWith('blob:')`));
  await evaluate(`localStorage.removeItem('valo-lineup:v4:/')`);
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
  console.log('PASS quota rollback, cumulative export, package removal/reimport, local edit priority, mobile history');
} finally { socket.close(); }

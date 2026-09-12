import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { browserFixture, requireFixtureServer } from './fixtures/browser.mjs';

// Synthetic records and an isolated browser only; never edit the live lineup library.
const [debugUrl = 'http://127.0.0.1:9335', appUrl = 'http://127.0.0.1:4174/', screenshot] = process.argv.slice(2);
await requireFixtureServer(appUrl);
const tab = (await fetch(`${debugUrl}/json`).then(r => r.json())).find(tab => tab.type === 'page' && tab.url.startsWith(appUrl));
assert(tab, 'Open the fixture app in an isolated test browser');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let sequence = 0;
const pending = new Map();
ws.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (message.method === 'Page.javascriptDialogOpening' && message.params.type === 'beforeunload') void send('Page.handleJavaScriptDialog', { accept: true });
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id); clearTimeout(request.timer);
  if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
};
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
async function wait(expression) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate(`Boolean(${expression})`)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Condition failed: ${expression}`);
}
const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const pin = id => `.lineup-pin[data-lineup-id="${id}"]`;
const method = id => `.method-list button[data-lineup-id="${id}"]`;
const selected = id => `document.querySelector('.lineup-pin.is-active')?.dataset.lineupId === ${JSON.stringify(id)}`;
const methods = () => evaluate("[...document.querySelectorAll('.method-list button')].map(button=>button.dataset.lineupId)");
const positions = () => evaluate("Object.fromEntries([...document.querySelectorAll('.lineup-pin')].map(pin=>[pin.dataset.lineupId,{left:pin.style.left,top:pin.style.top}]))");
const center = selector => evaluate(`(() => { const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
const mapPoint = (x, y) => evaluate(`(() => { const r=document.querySelector('.map-canvas').getBoundingClientRect(), m=new DOMMatrix(getComputedStyle(document.querySelector('.map-transform-layer')).transform), p=m.transformPoint(new DOMPoint((${x}-.5)*r.width,(${y}-.5)*r.height)); return {x:r.left+r.width/2+p.x,y:r.top+r.height/2+p.y}; })()`);
const mouse = (type, point) => send('Input.dispatchMouseEvent', { type, ...point, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
async function input(selector, value) {
  await evaluate(`(() => {const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
}
async function size(width, height = 1000) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 761 });
  await evaluate('new Promise(resolve=>setTimeout(resolve,300))');
}
async function ready() {
  await wait("document.querySelector('.editor-enter') && !document.querySelector('.editor-enter').disabled && document.querySelector('.map-stage')?.getAttribute('aria-busy')==='false'");
}
async function reload() { await send('Page.navigate', { url: appUrl }); await ready(); }
async function edit() {
  await evaluate("window.toy={isSupport:async()=>true,getUserProfile:async()=>({nickname:'Sidebar Test',toyOpenId:'sidebar-test'})}");
  await click('.editor-enter'); await wait("document.querySelector('.lineup-fields')");
}
async function topmost(id) {
  await wait(selected(id));
  assert.equal(await evaluate("document.querySelectorAll('.lineup-pin.is-active').length"), 1);
  const p = await center(pin(id));
  assert.equal(await evaluate(`document.elementFromPoint(${p.x},${p.y})?.closest('.lineup-pin')?.dataset.lineupId`), id, 'The selected member is the actual pointer hit target, not just visually highlighted');
}
async function drag(id, x, y) {
  const start = await center(pin(id)), end = await mapPoint(x, y);
  await mouse('mousePressed', start);
  for (let step = 1; step <= 8; step++) {
    await mouse('mouseMoved', { x: start.x + (end.x - start.x) * step / 8, y: start.y + (end.y - start.y) * step / 8 });
    await evaluate('new Promise(resolve=>requestAnimationFrame(resolve))');
  }
  await mouse('mouseReleased', end); await wait(selected(id));
  const actual = await center(pin(id));
  assert(Math.hypot(actual.x - end.x, actual.y - end.y) < 1, 'The same selected pin follows the full drag across cluster boundaries');
}
async function save() {
  await click('.editor-save'); await wait("document.querySelector('.save-state')?.dataset.dirty==='false' && !document.querySelector('.editor-cancel').disabled");
}
const content = await browserFixture();
const base = content.lineups[0];
const siblings = content.lineups.filter(item => item.mapId === base.mapId && item.target.groupId === base.target.groupId);
const ids = siblings.map(item => item.id);
const key = `valo-lineup:v4:${new URL(appUrl).pathname}`;
const library = `JSON.parse(localStorage.getItem(${JSON.stringify(key)}))`;
try {
  await send('Page.enable'); await size(1440);
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await send('Browser.setDownloadBehavior', { behavior: 'deny' });
  await reload();
  await evaluate(`localStorage.removeItem(${JSON.stringify(key)});localStorage.setItem('valo-lineup:guide:'+location.pathname,'seen')`);
  await reload(); await click(pin(base.id));
  assert.deepEqual(await methods(), ids, 'Reader keeps legacy multi-method grouping');
  const viewerCount = await evaluate("document.querySelectorAll('.lineup-pin').length");
  await edit();
  assert.equal(await evaluate("document.querySelectorAll('.lineup-pin').length"), viewerCount + ids.length - 1, 'Editor renders each legacy member separately');
  assert.equal(await evaluate("document.querySelectorAll('.lineup-pin b').length"), 0, 'Editor map never displays merged count badges');
  const original = await positions();
  for (const id of ids) {
    await click(pin(id)); await topmost(id);
    assert.deepEqual(await methods(), ids);
    assert.equal(await evaluate(`document.querySelector('${method(id)}').getAttribute('aria-pressed')`), 'true');
    assert.equal(await evaluate("document.querySelector('[aria-label=点位名称]').value"), siblings.find(item => item.id === id).title);
  }
  for (const id of ids) { await click(method(id)); await topmost(id); }
  const chosen = ids[1]; await click(method(chosen)); await topmost(chosen);
  const start = await center(pin(chosen));
  await mouse('mousePressed', start); await mouse('mouseMoved', { x: start.x + 1, y: start.y + 1 }); await mouse('mouseReleased', { x: start.x + 1, y: start.y + 1 });
  assert.equal(await evaluate("document.querySelector('.save-state').dataset.dirty"), 'false', 'Selecting and slight pointer jitter cannot create edits');
  assert.deepEqual(await positions(), original);
  await drag(chosen, .4, .45); assert.deepEqual(await methods(), [], 'Moving outside the threshold leaves a single-method editor');
  await drag(chosen, .255, .3); assert.deepEqual((await methods()).toSorted(), ids.toSorted(), 'Moving back merges only the sidebar');
  await topmost(chosen);
  const moved = await positions();
  for (const id of Object.keys(original).filter(id => id !== chosen)) assert.deepEqual(moved[id], original[id], `Sibling ${id} must not move`);
  await save();
  const saved = await evaluate(`${library}.manual`);
  assert.equal(saved.changes.updated.length, 1); assert.equal(saved.changes.added.length, 0);
  assert.deepEqual(saved.changes.updated[0].before, siblings[1], 'Keep the exact legacy snapshot for compatible imports');
  assert.notEqual(saved.changes.updated[0].after.target.groupId, base.target.groupId);
  assert.deepEqual(saved.changes.updated[0].after.media, siblings[1].media);
  await evaluate("window.originalCreateURL=URL.createObjectURL; URL.createObjectURL=blob=>{if(blob.type==='application/zip')window.exportedZip=blob;return window.originalCreateURL(blob)}");
  await click('.editor-export'); await wait("window.exportedZip && !document.querySelector('.editor-export').disabled");
  const exported = await evaluate("(async()=>{const {readPackage}=await import('/src/package-model.mjs');return (await readPackage(await window.exportedZip.arrayBuffer())).manifest})()");
  assert.deepEqual(exported.changes, saved.changes, 'Export contains only the selected member, not all nearby methods');
  await evaluate('URL.createObjectURL=window.originalCreateURL');
  await reload(); await edit(); await click(method(chosen)); await topmost(chosen);
  assert.deepEqual(await positions(), moved, 'Independent coordinates survive save and reload');
  if (screenshot) await writeFile(screenshot, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  console.log('PASS legacy grouping, all-member selection, real hit-test stacking, no-op clicks, independent continuous drag, cluster re-entry, save/export/reload');

  // Different group IDs and transitive proximity use exactly the reader threshold, not screen pixels.
  const nearby = [.4, .410, .420, .46].map((x, index) => ({ ...base, id: `sidebar-near-${index}`, title: `相近方法 ${index + 1}`, target: { groupId: `unique-${index}`, x, y: .55 }, media: { stance: [], aim: [], effect: [] } }));
  const manifest = { format: 'valo-lineup-edit-package', version: 4, packageId: crypto.randomUUID(), revision: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), author: base.uploader, changes: { added: nearby, updated: [] }, uploadedAssets: [] };
  await evaluate(`localStorage.setItem(${JSON.stringify(key)},JSON.stringify({version:1,token:'sidebar-near',packages:[],manual:${JSON.stringify(manifest)}}))`);
  await reload(); await click(pin(nearby[0].id));
  const nearIds = nearby.slice(0, 3).map(item => item.id);
  assert.deepEqual(await methods(), nearIds);
  await edit(); assert.deepEqual(await methods(), nearIds);
  for (const item of nearby) {
    const actual = await center(pin(item.id)), expected = await mapPoint(item.target.x, item.target.y);
    assert(Math.hypot(actual.x - expected.x, actual.y - expected.y) < 1, 'Editor uses actual coordinates, never the cluster average');
  }
  await click(method(nearIds[2])); await topmost(nearIds[2]);
  await input('.map-zoom-controls input[type=range]', '200');
  await wait("document.querySelector('.map-zoom-controls input[type=range]').value==='200'");
  assert.deepEqual(await methods(), nearIds, 'Zoom never changes normalized-distance grouping');
  await click('.perspective-controls button:last-child'); await click('.side-filter button:last-child'); await click(pin(nearIds[2]));
  assert.deepEqual(await methods(), nearIds, 'Perspective rotation preserves grouping when both sides are visible');
  await click('.perspective-controls button:first-child'); await click('.zoom-reset');
  await click('.editor-new'); await wait("document.querySelector('.placement-banner')");
  const newPoint = await mapPoint(.415, .555); await mouse('mousePressed', newPoint); await mouse('mouseReleased', newPoint);
  await wait("document.querySelector('.new-lineup-confirm')"); await input('[aria-label=点位名称]', '新增相近方法');
  await click('.area-shortcuts button:first-child'); await click('.new-lineup-confirm'); await wait("!document.querySelector('.new-lineup-confirm')");
  assert.equal((await methods()).length, nearIds.length + 1, 'A newly added nearby lineup is available in the same sidebar');
  const createdId = await evaluate("document.querySelector('.lineup-pin.is-active').dataset.lineupId"); await topmost(createdId);
  await save();
  const cumulative = await evaluate(`${library}.manual`);
  assert.equal(cumulative.changes.updated.length, 0, 'Adding a nearby point never edits repository records');
  for (const item of nearby) assert.deepEqual(cumulative.changes.added.find(record => record.id === item.id), item, 'Previously added methods remain unchanged');
  assert.equal(cumulative.packageId, manifest.packageId, 'Continued editing remains in the same manual package');
  await size(390, 844); await evaluate("document.querySelector('.map-stage').scrollIntoView({block:'center'})");
  await click(method(nearIds[0])); await topmost(nearIds[0]);
  assert.equal((await methods()).length, nearIds.length + 1);
  assert(await evaluate('document.documentElement.scrollWidth<=innerWidth'), 'Sidebar stays within mobile width');
  console.log('PASS shared proximity threshold, transitive groups, actual marker coordinates, zoom/rotation, new nearby method, cumulative save and mobile selection');
} finally {
  await evaluate(`localStorage.removeItem(${JSON.stringify(key)})`).catch(() => {});
  await size(1440).catch(() => {}); ws.close();
}

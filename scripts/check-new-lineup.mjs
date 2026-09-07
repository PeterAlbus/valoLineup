// Run only against an isolated Chromium instance; edits stay in the test browser.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [debugUrl = 'http://127.0.0.1:9335', appUrl = 'http://127.0.0.1:4174/'] = process.argv.slice(2);
const tab = (await fetch(`${debugUrl}/json`).then((r) => r.json())).find((tab) => tab.type === 'page' && tab.url.startsWith(appUrl));
assert(tab, 'Open the app in an isolated test browser');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0;
const pending = new Map();
ws.onmessage = ({ data }) => {
  const result = JSON.parse(data), request = pending.get(result.id);
  if (result.method === 'Page.javascriptDialogOpening' && result.params.type === 'beforeunload') {
    void send('Page.handleJavaScriptDialog', { accept: true });
  }
  if (!request) return;
  pending.delete(result.id); clearTimeout(request.timer);
  if (result.error) request.reject(new Error(result.error.message)); else request.resolve(result.result);
};
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const key = ++id;
    const timer = setTimeout(() => { pending.delete(key); reject(new Error(`Timeout: ${method}`)); }, 15000);
    pending.set(key, { resolve, reject, timer }); ws.send(JSON.stringify({ id: key, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
async function wait(expression) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate(`Boolean(${expression})`)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Condition failed: ${expression}`);
}
const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
async function size(width, height = 900) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 761 });
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
}

async function input(selector, value) {
  await evaluate(`(() => {const el=document.querySelector(${JSON.stringify(selector)}); const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
}
async function mouse(type, point) {
  await send('Input.dispatchMouseEvent', { type, ...point, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
}
async function point(x = .75, y = .6) {
  return evaluate(`(() => {const r=document.querySelector('.map-canvas').getBoundingClientRect();return {x:r.x+r.width*${x},y:r.y+r.height*${y}}})()`);
}
async function place() {
  const target = await point();
  await mouse('mousePressed', target);
  assert(await evaluate("!!document.querySelector('.placement-guide')"), 'Pressing does not create a point');
  await mouse('mouseReleased', target);
  await wait("document.querySelector('.new-lineup-heading') && document.activeElement.getAttribute('aria-label') === '点位名称'");
}
async function pan(start, end) {
  await mouse('mousePressed', start);
  for (let i = 1; i <= 5; i++) {
    await mouse('mouseMoved', { x: start.x + (end.x - start.x) * i / 5, y: start.y + (end.y - start.y) * i / 5 });
    await evaluate('new Promise(resolve => requestAnimationFrame(resolve))');
  }
  await mouse('mouseReleased', end);
}
async function save() {
  await click('.editor-save');
  await wait("document.querySelector('.save-state')?.dataset.dirty === 'false' && !document.querySelector('.editor-cancel').disabled");
}
const storageKey = `valo-lineup:v4:${new URL(appUrl).pathname}`;
const library = `JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)}))`;
const content = JSON.parse(await readFile(new URL('../src/data/content.json', import.meta.url), 'utf8'));
try {
  await send('Page.enable'); await size(1440, 900);
  await send('Browser.setDownloadBehavior', { behavior: 'deny' });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await send('Page.navigate', { url: appUrl });
  await wait("document.querySelector('.editor-enter') && !document.querySelector('.editor-enter').disabled");
  await evaluate(`localStorage.removeItem(${JSON.stringify(storageKey)})`);
  await send('Page.navigate', { url: appUrl });
  await wait("document.querySelector('.editor-enter') && !document.querySelector('.editor-enter').disabled && document.querySelector('.map-stage').getAttribute('aria-busy') === 'false'");
  for (const sdk of [
    'undefined',
    '{isSupport:async()=>false}',
    '{isSupport:async()=>{throw new Error("unsupported")}}',
    '{isSupport:async()=>true,getUserProfile:async()=>({nickname:" "})}',
    '{isSupport:async()=>true,getUserProfile:async()=>{throw new Error("用户取消授权")}}',
  ]) {
    await evaluate(`window.toy=${sdk}`);
    await click('.editor-enter'); await wait("document.querySelector('.editor-new')");
    assert((await evaluate("document.querySelector('.editor-message').textContent")).includes('匿名编辑者'));
    await click('.editor-cancel'); await click('.exit-edit-confirm');
    await wait("document.querySelector('.editor-enter')");
  }
  console.log('PASS absent, unsupported, rejected and empty SDK identity allow anonymous editing');
  await click('.editor-enter'); await wait("document.querySelector('.editor-new')");
  const filterIndex = () => evaluate("[...document.querySelectorAll('.side-filter button')].findIndex(button => button.getAttribute('aria-pressed') === 'true')");
  for (const filter of [0, 1, 2]) {
    await click(`.side-filter button:nth-child(${filter + 1})`);
    await wait(`document.querySelector('.side-filter button:nth-child(${filter + 1})').getAttribute('aria-pressed') === 'true'`);
    await click('.editor-new'); await place();
    for (const field of ['title', 'area', 'videoBvid']) {
      if (field === 'area') await input('[aria-label=点位名称]', '阵营筛选校验');
      if (field === 'videoBvid') {
        await click('.area-shortcuts button:first-child');
        await input('[aria-label="教学视频 BV 号"]', 'BV123');
      }
      await click('.new-lineup-confirm');
      await wait("document.querySelector('.editor-message.is-error') && document.activeElement.getAttribute('aria-invalid') === 'true'");
      assert.equal(await filterIndex(), filter, `${field} validation preserves the current side filter`);
      assert(await evaluate("!!document.querySelector('.new-lineup-confirm')"));
    }
    for (const side of ['defense', 'attack']) {
      await evaluate(`(() => {const select=document.querySelector('[aria-label=点位阵营]');select.value=${JSON.stringify(side)};select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await wait(`document.querySelector('[aria-label=点位阵营]').value === ${JSON.stringify(side)}`);
      assert.equal(await filterIndex(), filter === 2 ? 2 : side === 'attack' ? 0 : 1, 'Single-side filters follow the new point side; All stays All');
      await click('.new-lineup-confirm');
      await wait("document.querySelector('.editor-message.is-error')");
      assert.equal(await filterIndex(), filter === 2 ? 2 : side === 'attack' ? 0 : 1, 'Failed confirmation preserves the filter after a side change');
    }
    await click('.new-lineup-cancel');
    await wait("!document.querySelector('.new-lineup-heading')");
  }
  await click('.side-filter button:first-child');
  console.log('PASS confirmation errors preserve all three side filters; point side changes follow single-side filters and preserve All');
  await input('.instructions-editor textarea', '保留原点位的未保存修改');
  const originalTitle = await evaluate("document.querySelector('[aria-label=点位名称]').value");
  await click('.editor-new');
  const unzoomedStart = await point(.3, .55);
  await pan(unzoomedStart, { x: unzoomedStart.x + 40, y: unzoomedStart.y + 20 });
  assert(await evaluate("!!document.querySelector('.placement-guide') && !document.querySelector('.new-lineup-heading')"), 'Dragging at 100% must not accidentally place a point');
  await click('.new-lineup-cancel');
  await input('.map-zoom-controls input[type=range]', '200');
  await wait("document.querySelector('.map-zoom-controls input[type=range]').value === '200'");
  const transform = await evaluate("document.querySelector('.map-transform-layer').style.transform");
  await click('.editor-new');
  assert.equal(await evaluate("document.querySelector('.map-transform-layer').style.transform"), transform);
  const start = await point(.3, .55), end = { x: start.x + 40, y: start.y + 25 };
  await pan(start, end);
  assert(await evaluate("!!document.querySelector('.placement-guide') && !document.querySelector('.new-lineup-heading')"), 'Panning does not place a point');
  assert.notEqual(await evaluate("document.querySelector('.map-transform-layer').style.transform"), transform, 'Placement mode allows panning');
  await place();
  await input('[aria-label=点位名称]', '取消的点位');
  await click('.agent-picker-toggle');
  await click('.agent-picker-grid button');
  await click('.new-lineup-cancel');
  assert.equal(await evaluate("document.querySelector('[aria-label=点位名称]').value"), originalTitle);
  assert.equal(await evaluate("document.querySelector('.instructions-editor textarea').value"), '保留原点位的未保存修改');
  assert.equal(await evaluate("document.querySelector('.save-state').dataset.dirty"), 'true');
  await save();
  assert.equal(await evaluate(`${library}.manual.changes.added.length`), 0, 'Cancelled drafts are not saved');
  console.log('PASS map-first placement, preserved viewport, pan vs tap, cancellation preserves prior edits');

  await input('[aria-label=点位名称]', '   ');
  await click('.editor-new'); await place();
  await click('.new-lineup-confirm');
  await wait("document.querySelector('[aria-label=点位名称]').getAttribute('aria-invalid') === 'true'");
  assert.equal(await evaluate(`${library}.manual.changes.added.length`), 0, 'Incomplete point is not persisted');
  assert(await evaluate("!!document.querySelector('.new-lineup-confirm') && document.querySelector('.editor-new').disabled"), 'Invalid confirmation retains the current new draft');
  await input('[aria-label=点位名称]', 'B点测试落点');
  await click('.new-lineup-confirm');
  await wait("document.querySelector('[aria-label=点位区域]').getAttribute('aria-invalid') === 'true'");
  await click('.area-shortcuts button:nth-child(2)');
  await input('.instructions-editor textarea', '站在角落，瞄准墙沿后释放');
  await click('.agent-picker-toggle');
  const hero = content.agents.find(item => item.id === 'fade');
  await click(`.agent-picker-grid button[aria-label="${hero.name}"]`);
  await click('.ability-picker button:nth-child(2)');
  assert((await evaluate("document.querySelector('.lineup-pin.is-new img').src")).endsWith(hero.abilities[1].icon));
  await input('[aria-label="教学视频 BV 号"]', 'BV123');
  await click('.new-lineup-confirm');
  await wait("document.querySelector('[aria-label=\"教学视频 BV 号\"]').getAttribute('aria-invalid') === 'true'");
  await input('[aria-label="教学视频 BV 号"]', 'BV17x411w7KC');
  await evaluate(`(async () => {
    const canvas=document.createElement('canvas');canvas.width=80;canvas.height=40;
    canvas.getContext('2d').fillRect(0,0,80,40);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    const data=new DataTransfer();data.items.add(new File([blob],'stance.png',{type:'image/png'}));
    const el=document.querySelector('.media-add input');el.files=data.files;el.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await wait("document.querySelector('.media-item img') && !document.querySelector('.editor-cancel').disabled");
  await click('.map-card:nth-child(2)');
  await wait("document.querySelector('.placement-guide') && document.querySelector('.map-stage').getAttribute('aria-busy') === 'false'");
  assert(await evaluate("document.querySelector('.editor-save').disabled"), 'A changed map requires a fresh coordinate');
  await place();
  assert.equal(await evaluate("document.querySelector('[aria-label=点位名称]').value"), 'B点测试落点');
  assert.equal(await evaluate("document.querySelector('.instructions-editor textarea').value"), '站在角落，瞄准墙沿后释放');
  assert.equal(await evaluate("document.querySelectorAll('.media-item img').length"), 1, 'Map change preserves images');
  await click('.perspective-controls button:nth-child(2)');
  assert.equal(await evaluate("document.querySelector('[aria-label=点位阵营]').value"), 'attack', 'Viewing perspective does not change draft side');
  const confirmedCoordinates = await evaluate("document.querySelector('.coordinate-readout').textContent");
  await click('.new-lineup-confirm');
  await wait("!document.querySelector('.new-lineup-heading') && !document.querySelector('.editor-new').disabled");
  assert.equal(await evaluate("document.querySelector('[aria-label=点位名称]').value"), 'B点测试落点', 'Confirmation validates only the current point');
  assert.equal(await evaluate(`${library}.manual.changes.added.length`), 0, 'Confirmation keeps edits in the draft until Save');
  assert.equal(await evaluate("document.querySelector('.save-state').dataset.dirty"), 'true');
  assert(await evaluate("[...document.querySelectorAll('.agent-tab, .lineup-pin, .side-filter button')].every(button => !button.disabled)"), 'Confirmation unlocks point, hero and side selection');
  await click('.editor-new'); await place(); await click('.new-lineup-cancel');
  assert.equal(await evaluate("document.querySelector('[aria-label=点位名称]').value"), 'B点测试落点', 'Cancelling the next new point preserves the confirmed draft');
  await click('.map-card:first-child');
  await wait("document.querySelector('[aria-label=点位名称]')?.value === '   '");
  await input('[aria-label=点位名称]', originalTitle);
  await input('.instructions-editor textarea', '确认新增后编辑其他点位');
  await click('.map-card:nth-child(2)');
  await wait("document.querySelector('.map-stage').getAttribute('aria-busy') === 'false'");
  await evaluate(`document.querySelectorAll('.agent-tab').forEach(button=>{if(button.textContent.includes(${JSON.stringify(hero.name)})) button.click()})`);
  await wait("[...document.querySelectorAll('.lineup-pin')].some(pin=>pin.getAttribute('aria-label').includes('B点测试落点'))");
  await evaluate("[...document.querySelectorAll('.lineup-pin')].find(pin=>pin.getAttribute('aria-label').includes('B点测试落点')).click()");
  await wait("document.querySelector('[aria-label=点位名称]')?.value === 'B点测试落点'");
  assert.equal(await evaluate("document.querySelector('.coordinate-readout').textContent"), confirmedCoordinates);
  assert.equal(await evaluate("document.querySelectorAll('.media-item img').length"), 1, 'Switching away and back retains pending images');
  assert.equal(await evaluate("document.querySelector('.instructions-editor textarea').value"), '站在角落，瞄准墙沿后释放');
  await input('.instructions-editor textarea', '站在角落，瞄准墙沿后释放，确认后继续编辑');
  await save();
  const created = await evaluate(`${library}.manual.changes.added[0]`);
  assert.equal(created.instructions, '站在角落，瞄准墙沿后释放，确认后继续编辑');
  assert((await evaluate(`${library}.manual.changes.updated`)).some(change => change.after.instructions === '确认新增后编辑其他点位'));
  console.log('PASS confirm current point, validation, unsaved draft retention, switch away/back, continued edits and cumulative save');
  assert.deepEqual(created.uploader, { name: '匿名编辑者', source: 'local' });
  assert.deepEqual(await evaluate(`${library}.manual.author`), created.uploader);
  assert.equal(created.mapId, 'bind'); assert.equal(created.agentId, hero.id); assert.equal(created.abilityId, hero.abilities[1].id);
  assert.equal(created.media.stance.length, 1); assert.equal(created.title, 'B点测试落点');
  assert.equal(created.videoBvid, 'BV17x411w7KC');
  await evaluate("window.downloadedPackage = null; window.originalObjectURL = URL.createObjectURL; URL.createObjectURL = blob => { if (blob.type === 'application/zip') window.downloadedPackage = {type: blob.type, size: blob.size}; return window.originalObjectURL(blob); }");
  await click('.editor-export');
  await wait("document.querySelector('.editor-message.is-success')?.textContent.includes('已下载') && !document.querySelector('.editor-export').disabled");
  assert(await evaluate("window.downloadedPackage?.size > 0"), 'Anonymous editors can export a ZIP package');
  await evaluate("URL.createObjectURL = window.originalObjectURL");
  console.log('PASS field validation, avatar/ability selection, map reassignment with text and images, anonymous save/export, perspective independent of side');

  const savedTransform = await evaluate("document.querySelector('.map-transform-layer').style.transform");
  await click('.editor-new'); await place();
  assert.equal(await evaluate("document.querySelector('.map-transform-layer').style.transform"), savedTransform);
  assert.equal(await evaluate("document.querySelector('[aria-label=点位名称]').value"), '');
  assert.equal(await evaluate("document.querySelector('.instructions-editor textarea').value"), '');
  assert.equal(await evaluate("document.querySelectorAll('.media-item').length"), 0);
  assert((await evaluate("document.querySelector('.agent-picker-toggle').textContent")).includes(hero.name));
  await click('.new-lineup-cancel');
  assert.equal(await evaluate("document.querySelector('.save-state').dataset.dirty"), 'false');
  await click('.editor-cancel'); await click('.exit-edit-confirm');
  await send('Page.navigate', { url: appUrl });
  await wait("document.querySelector('.editor-enter') && !document.querySelector('.editor-enter').disabled");
  await click('.map-card:nth-child(2)'); await wait("document.querySelector('.map-stage').getAttribute('aria-busy') === 'false'");
  await evaluate(`document.querySelectorAll('.agent-tab').forEach(button=>{if(button.textContent.includes(${JSON.stringify(hero.name)})) button.click()})`);
  await wait("[...document.querySelectorAll('.lineup-pin')].some(pin=>pin.getAttribute('aria-label').includes('B点测试落点'))");
  await evaluate("[...document.querySelectorAll('.lineup-pin')].find(pin=>pin.getAttribute('aria-label').includes('B点测试落点')).click()");
  await wait("document.querySelector('.media-item img')?.src.startsWith('blob:')");
  assert(!await evaluate("/localStorage|IndexedDB|SDK|YAML|manifest\\.json|SHA-256/.test(document.body.innerText + [...document.querySelectorAll('[title]')].map(el=>el.title).join(' '))"), 'Visible UI uses reader-facing language');
  console.log('PASS consecutive entries, cancellation returns to clean state, save/reload with images and reader-facing copy');
} finally { ws.close(); }

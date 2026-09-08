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
  await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', {bubbles:true})); })()`);
}
async function mouse(type, point) {
  await send('Input.dispatchMouseEvent', { type, ...point, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
}
const content = JSON.parse(await readFile(new URL('../src/data/content.json', import.meta.url), 'utf8'));
const base = content.lineups[0];
const make = (id, title, abilityId, x, y) => ({ ...base, id, title, agentId: 'sova', abilityId, side: 'attack', target: { groupId: id, x, y }, media: { stance: [], aim: [], effect: [] } });
const pathRecord = make('geometry-path', '几何路径', 'owl-drone', .5, .5);
const directionRecord = make('geometry-direction', '几何方向', 'hunters-fury', .65, .5);
const fixedRecord = make('geometry-fixed', '几何固定', 'recon-bolt', .4, .4);
const secondMethod = { ...make('geometry-method', '同点第二种方法', 'recon-bolt', .5, .5), target: { ...pathRecord.target } };
const key = `valo-lineup:v4:${new URL(appUrl).pathname}`;
const manifest = { format: 'valo-lineup-edit-package', version: 4, packageId: crypto.randomUUID(), revision: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), author: base.uploader, changes: { added: [pathRecord, directionRecord, fixedRecord, secondMethod], updated: [] }, uploadedAssets: [] };
const button = (text) => evaluate(`(() => {const buttons=[...document.querySelectorAll('button')]; (buttons.find(el=>el.getAttribute('aria-label')===${JSON.stringify(text)}) ?? buttons.find(el=>el.textContent.trim()===${JSON.stringify(text)})).click();})()`);
const pick = (name) => click(`.lineup-pin[aria-label*="${name}"]`);
const mapPoint = (x, y) => evaluate(`(() => {const canvas=document.querySelector('.map-canvas').getBoundingClientRect();const matrix=new DOMMatrix(getComputedStyle(document.querySelector('.map-transform-layer')).transform);const p=matrix.transformPoint(new DOMPoint((${x}-.5)*canvas.width,(${y}-.5)*canvas.height));return {x:canvas.left+canvas.width/2+p.x,y:canvas.top+canvas.height/2+p.y};})()`);
const center = (selector) => evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
async function dragControl(selector, to) {
  await mouse('mousePressed', await center(selector));
  await mouse('mouseMoved', await mapPoint(...to));
  await mouse('mouseReleased', await mapPoint(...to));
}
const pathLine = () => evaluate("document.querySelector('.ability-path')?.getAttribute('d') ?? null");
const pathLength = () => evaluate("(document.querySelector('.ability-path')?.getTotalLength() ?? 0) / 7");
const vertices = async () => (await pathLine())?.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi).map(Number);
const near = (actual, expected, tolerance = .01) => assert(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
const curve = Array.from({length:16}, (_,i) => {const t=(i+1)/16;return [.5+.1*t,.5+.05*Math.sin(Math.PI*t)];});
async function drawCurve() {
  await mouse('mousePressed', await center('.geometry-endpoint-drag'));
  for (const point of curve) await mouse('mouseMoved', await mapPoint(...point));
  await mouse('mouseReleased', await mapPoint(...curve.at(-1)));
}
try {
  await send('Page.enable'); await size(1440, 900);
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await send('Page.navigate', { url: appUrl });
  await wait("document.querySelector('.editor-enter') && !document.querySelector('.editor-enter').disabled");
  await evaluate(`localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify({ version: 1, token: crypto.randomUUID(), packages: [manifest], manual: null }))})`);
  await send('Page.navigate', { url: appUrl });
  await wait("document.querySelector('.lineup-pin[aria-label*=几何固定]') && !document.querySelector('.editor-enter').disabled && document.querySelector('.map-stage').getAttribute('aria-busy')==='false'");
  await pick('几何固定');
  assert.equal(await evaluate("Number(document.querySelector('.ability-overlay circle').getAttribute('r'))"), 210);
  await pick('几何方向'); assert.equal(await evaluate("document.querySelectorAll('.ability-overlay').length"), 0);
  await pick('几何路径'); assert.equal(await evaluate("document.querySelectorAll('.ability-overlay').length"), 0);
  await click('.editor-enter'); await wait("document.querySelector('.editor-new')");
  assert.equal(await evaluate("document.querySelectorAll('.detail-panel .geometry-controls').length"), 0);
  await button('编辑路径');
  await input('[aria-label="地图放大倍率"]', '200');
  const viewportBefore = await evaluate("document.querySelector('.map-transform-layer').style.transform");
  await drawCurve();
  const drawn = await vertices();
  assert.deepEqual(drawn.slice(0,2), [500,500], 'The original marker is the fixed start');
  near(drawn.at(-2),600); near(drawn.at(-1),500);
  assert(drawn.length > 20 && drawn.some((value,index)=>index%2 && value>540), 'The displayed path follows a curved pointer trace');
  assert(await pathLength() > 18, 'Movement distance follows the curve, rather than its chord');
  const marker = await center('.lineup-pin[aria-label*=几何路径]'), endpoint = await mapPoint(.6,.5);
  assert(Math.hypot(marker.x-endpoint.x,marker.y-endpoint.y)<1);
  assert.equal(await evaluate("document.querySelectorAll('.ability-path').length"), 1);
  assert.equal(await evaluate("document.querySelector('.ability-path').tagName"), 'path');
  assert.equal(await evaluate("document.querySelectorAll('[data-effect-shape=path] circle').length"), 0);
  assert.equal(await evaluate("document.querySelector('.map-transform-layer').style.transform"), viewportBefore);
  await mouse('mousePressed', await center('.geometry-endpoint-drag'));
  await mouse('mouseMoved', await mapPoint(.73,.5));
  near(await pathLength(),31,.01);
  const capped = await pathLine();
  assert((await evaluate("document.querySelector('[aria-label=引导路径距离]').textContent")).includes('已达上限'));
  await mouse('mouseMoved', await mapPoint(.75,.55));
  assert.equal(await pathLine(), capped, 'The endpoint stops at the limit even when the pointer continues');
  await mouse('mouseMoved', await mapPoint(...curve.at(-4)));
  assert(await pathLength() < 20, 'Dragging back onto the existing curve retracts its tail');
  const shortened = await vertices();
  near(shortened.at(-2),curve.at(-4)[0]*1000); near(shortened.at(-1),curve.at(-4)[1]*1000);
  await mouse('mouseMoved', await mapPoint(.57,.58));
  const redirected = await vertices();
  near(redirected.at(-2),570); near(redirected.at(-1),580);
  await mouse('mouseReleased', await mapPoint(.57,.58));
  await mouse('mousePressed', await center('.geometry-endpoint-drag'));
  await mouse('mouseMoved', await mapPoint(.5,.5));
  await mouse('mouseReleased', await mapPoint(.5,.5));
  assert.equal(await pathLine(), null, 'Retracing to the origin removes the whole curve');
  await dragControl('.geometry-endpoint-drag', [.6,.5]);
  await dragControl('.geometry-endpoint-drag', [.55,.501]);
  const snapped = await vertices();
  near(snapped.at(-2),550); near(snapped.at(-1),500);
  assert.equal(snapped.length,4, 'Releasing near the trace preserves the retracted endpoint');
  await button('重置');
  await drawCurve();
  await button('重置'); assert.equal(await pathLine(), null);
  const origin = await center('.geometry-endpoint-drag'), originalMapPoint = await mapPoint(.5,.5);
  assert(Math.hypot(origin.x-originalMapPoint.x,origin.y-originalMapPoint.y)<1);
  await drawCurve();
  const confirmedPath = await pathLine();
  await click('.geometry-save');
  await button('编辑路径'); await button('重置'); await send('Input.dispatchKeyEvent', {type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27}); await send('Input.dispatchKeyEvent', {type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  assert.deepEqual(await pathLine(), confirmedPath, 'Cancel restores both saved positions');
  await pick('同点第二种方法');
  assert.equal(await pathLine(), null);
  assert.equal(await evaluate("Number(document.querySelector('.ability-overlay circle').getAttribute('r'))"), 210);
  await pick('几何路径'); assert.deepEqual(await pathLine(), confirmedPath);
  await pick('几何方向'); await button('编辑方向');
  assert(await evaluate("(() => {const a=document.querySelector('.geometry-toolbar').getBoundingClientRect(),b=document.querySelector('.geometry-direction-handle').getBoundingClientRect();return a.right<=b.left||a.left>=b.right||a.bottom<=b.top||a.top>=b.bottom;})()"), 'Toolbar leaves the direction handle accessible');
  await dragControl('.geometry-direction-handle', [.75, .5]);
  assert((await evaluate("document.querySelector('[data-effect-shape=rectangle]').getAttribute('transform')")).endsWith('rotate(0)'));
  await dragControl('.geometry-direction-handle', [.65, .6]);
  assert((await evaluate("document.querySelector('[data-effect-shape=rectangle]').getAttribute('transform')")).endsWith('rotate(90)'));
  await click('.geometry-save');
  await button('守方视角'); await button('全部道具'); await pick('几何方向');
  assert((await evaluate("document.querySelector('[data-effect-shape=rectangle]').getAttribute('transform')")).endsWith('rotate(90)'));
  await pick('几何路径'); assert.deepEqual(await pathLine(), confirmedPath);
  await click('.editor-save'); await wait("document.querySelector('.editor-message')?.textContent.includes('已保存')");
  const saved = await evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(key)})).manual`);
  const savedRecord = saved.changes.updated.find(item=>item.id==='geometry-path').after;
  assert.equal(savedRecord.effect.type, 'path');
  assert(savedRecord.effect.points.length >= 16);
  near(savedRecord.effect.points.at(-1).x,.6); near(savedRecord.effect.points.at(-1).y,.5);
  assert(savedRecord.effect.points.some(point=>point.y>.54));
  assert.deepEqual(savedRecord.target, {groupId:'geometry-path',x:.5,y:.5});
  assert.deepEqual(saved.changes.updated.find(item=>item.id==='geometry-direction').after.effect, { type: 'direction', angle: 90 });
  assert.equal(saved.version, 4);
  assert(!saved.changes.updated.some(item=>['geometry-fixed', 'geometry-method'].includes(item.id)));
  await send('Page.navigate', { url: appUrl });
  await wait("document.querySelector('.lineup-pin[aria-label*=几何路径]') && !document.querySelector('.editor-enter').disabled");
  await pick('几何路径'); assert.deepEqual(await pathLine(), confirmedPath);
  await size(390, 844);
  assert.equal(await evaluate("document.querySelectorAll('.editor-enter, .geometry-controls').length"), 0);
  assert.equal(await evaluate("document.querySelectorAll('.ability-path').length"), 1);
  assert(await evaluate("document.documentElement.scrollWidth <= innerWidth"));
  await size(1440, 900); await click('.editor-enter'); await wait("document.querySelector('.editor-new')");
  await pick('几何路径');
  await dragControl('.lineup-pin[aria-label*=几何路径]', [.55,.55]);
  assert.deepEqual(await pathLine(), confirmedPath, 'Saved endpoints stay fixed until reset');
  await pick('同点第二种方法');
  await dragControl('.lineup-pin[aria-label*=同点第二种方法]', [.45,.55]);
  await pick('几何路径'); assert.deepEqual(await pathLine(), confirmedPath, 'Shared origins remain fixed while a path uses them');
  await button('编辑路径'); await button('重置'); await click('.geometry-save');
  assert.equal(await evaluate("document.querySelectorAll('.ability-path').length"), 0);
  await pick('几何方向'); await button('寻敌箭');
  assert.equal(await evaluate("document.querySelectorAll('[data-effect-shape=rectangle], .geometry-controls').length"), 0);
  assert.equal(await evaluate("document.querySelectorAll('[data-effect-shape=circle]').length"), 1);
  await click('.editor-save'); await wait("document.querySelector('.editor-message')?.textContent.includes('已保存')");
  const cleared = await evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(key)})).manual`);
  assert(!cleared.changes.updated.some(item=>item.id==='geometry-path'), 'Reset and save restore the original record');
  assert(!Object.hasOwn(cleared.changes.updated.find(item=>item.id==='geometry-direction').after, 'effect'));
  console.log('PASS fixed origin, continuous curved trace, cumulative distance cap, backward trimming, resumed drawing, reset/cancel/save, independent methods, direction, rotation, persistence and mobile reading');
} finally { ws.close(); }

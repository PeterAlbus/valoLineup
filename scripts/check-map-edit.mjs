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
async function clickPoint(point) {
  await mouse('mousePressed', point);
  await mouse('mouseReleased', point);
}
async function bounds(selector) {
  return evaluate(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().toJSON()`);
}
async function assertPinAt(point, label) {
  await evaluate('new Promise(resolve => requestAnimationFrame(resolve))');
  const pin = await bounds('.lineup-pin.is-active');
  assert(Math.hypot(pin.x + pin.width / 2 - point.x, pin.y + pin.height / 2 - point.y) < 1, `${label}: marker center (${pin.x + pin.width / 2}, ${pin.y + pin.height / 2}) must follow pointer (${point.x}, ${point.y})`);
  const expected = await evaluate(`(() => {
    const canvas = document.querySelector('.map-canvas').getBoundingClientRect();
    const matrix = new DOMMatrix(getComputedStyle(document.querySelector('.map-transform-layer')).transform);
    const local = matrix.inverse().transformPoint(new DOMPoint(${point.x} - canvas.left - canvas.width / 2, ${point.y} - canvas.top - canvas.height / 2));
    return [0.5 + local.x / canvas.width, 0.5 + local.y / canvas.height];
  })()`);
  const actual = await evaluate("[...document.querySelectorAll('.coordinate-readout b')].map(el => Number(el.textContent.slice(2)))");
  actual.forEach((value, index) => assert(Math.abs(value - expected[index]) < 0.00002, `${label}: coordinate ${value} must match rendered coordinate ${expected[index]}`));
}
async function dragTo(point, label) {
  const pin = await bounds('.lineup-pin.is-active');
  const start = { x: pin.x + pin.width / 2, y: pin.y + pin.height / 2 };
  await mouse('mousePressed', start);
  for (let step = 1; step <= 8; step++) {
    const next = { x: start.x + (point.x - start.x) * step / 8, y: start.y + (point.y - start.y) * step / 8 };
    await mouse('mouseMoved', next);
    await evaluate('new Promise(resolve => requestAnimationFrame(resolve))');
  }
  await mouse('mouseReleased', point);
  await assertPinAt(point, label);
}
const content = JSON.parse(await readFile(new URL('../src/data/content.json', import.meta.url), 'utf8'));
try {
  await send('Page.enable');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  for (const [width, mapId, side, zoom] of [
    [1440, 'ascent', 'attack', 200], [1440, 'ascent', 'defense', 300],
    [1440, 'bind', 'attack', 150], [1440, 'bind', 'defense', 800],
    [390, 'ascent', 'attack', 200], [390, 'bind', 'defense', 300],
  ]) {
    const label = `${width}px ${mapId} ${side} ${zoom}%`;
    await size(1440, 1000);
    await send('Page.navigate', { url: appUrl });
    await wait("document.querySelector('.editor-enter') && !document.querySelector('.editor-enter').disabled");
    await click(`.map-card:nth-child(${content.maps.findIndex(map => map.id === mapId) + 1})`);
    await click(`.perspective-controls button:nth-child(${side === 'attack' ? 1 : 2})`);
    await wait("document.querySelector('.map-stage').getAttribute('aria-busy') === 'false'");
    await evaluate("window.toy={isSupport:async()=>true,getUserProfile:async()=>({nickname:'Map Regression',avatar:'',toyOpenId:'map-test-only'})}");
    await click('.editor-enter'); await wait("document.querySelector('.editor-new')");
    await size(width, 1000);
    await input('.map-zoom-controls input[type=range]', String(zoom));
    await wait(`document.querySelector('.map-zoom-controls input[type=range]').value === '${zoom}'`);
    const transform = await evaluate("document.querySelector('.map-transform-layer').style.transform");
    await click('.editor-new'); await wait("document.querySelector('.placement-banner')");
    assert.equal(await evaluate("document.querySelector('.map-transform-layer').style.transform"), transform, 'Starting placement preserves the map viewport');
    await evaluate("document.querySelector('.map-stage').scrollIntoView({block:'center'})");
    const stage = await bounds('.map-stage');
    const canvas = await bounds('.map-canvas');
    const right = { x: (canvas.right + stage.right) / 2, y: stage.y + stage.height / 2 };
    await clickPoint(right);
    assert.equal(await evaluate("!!document.querySelector('.placement-banner')"), false, `${label}: add a marker on the visible map beyond the original canvas`);
    await input('[aria-label="点位名称"]', label);
    await click('.area-shortcuts button');
    await assertPinAt(right, label);
    await dragTo({ x: canvas.x + canvas.width / 2, y: right.y }, label);
    await dragTo(right, label);
    await dragTo({ x: (stage.left + canvas.left) / 2, y: right.y }, label);
    await dragTo({ x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 }, label);

    // Move the map, then move its marker using the same visible coordinate system.
    const panStart = { x: canvas.x + canvas.width * .3, y: canvas.y + canvas.height * .35 };
    await mouse('mousePressed', panStart);
    await mouse('mouseMoved', { x: panStart.x + 25, y: panStart.y + 20 });
    await mouse('mouseReleased', { x: panStart.x + 25, y: panStart.y + 20 });
    await dragTo(right, `${label} after pan`);

    await click('.zoom-reset');
    const unzoomed = { x: canvas.x + canvas.width * .9, y: right.y };
    await dragTo(unzoomed, `${label} reset to 100%`);
    await mouse('mousePressed', unzoomed);
    await mouse('mouseMoved', right);
    await assertPinAt(unzoomed, `${label}: leave map padding inactive at 100%`);
    await mouse('mouseMoved', { x: stage.right + 30, y: right.y });
    await assertPinAt(unzoomed, `${label}: ignore captured pointer outside the map stage`);
    await mouse('mouseReleased', right);
    console.log(`PASS ${label}: placement, continuous drag, pan, rotation and reset`);
    await click('.editor-cancel'); await wait("document.querySelector('.exit-edit-dialog')?.open");
    await click('.exit-edit-confirm'); await wait("!document.querySelector('.editor-cancel')");
  }
} finally { ws.close(); }

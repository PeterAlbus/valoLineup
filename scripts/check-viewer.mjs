// Run against an isolated Chromium instance with remote debugging enabled:
// node scripts/check-viewer.mjs http://127.0.0.1:9335 http://127.0.0.1:4174/
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const [debugUrl = 'http://127.0.0.1:9335', appUrl = 'http://127.0.0.1:4174/'] = process.argv.slice(2);
const tabs = await fetch(`${debugUrl}/json`).then((response) => response.json());
const tab = tabs.find((item) => item.type === 'page' && item.url.startsWith(appUrl));
assert(tab, 'Open the app in an isolated browser before running this check');
const socket = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let id = 0;
const pending = new Map();
const paused = [];
const exceptions = [];
socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.method === 'Fetch.requestPaused') paused.push(message.params);
  if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params);
  const request = pending.get(message.id);
  if (request) {
    clearTimeout(request.timer);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  }
};
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`${method} timed out`)); }, 15000);
    pending.set(requestId, { resolve, reject, timer });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(expression) {
  for (let count = 0; count < 100; count++) { if (await evaluate(expression)) return; await delay(100); }
  throw new Error(`Condition failed: ${expression}`);
}
const click = (selector) => evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); element.focus({preventScroll:true}); element.click(); })()`);
async function rect(selector) {
  return evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height}; })()`);
}
async function setInput(selector, value) {
  await evaluate(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); input.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(String(value))}); input.dispatchEvent(new Event('input', {bubbles:true})); })()`);
  await delay(50);
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).blur()`);
}
async function touch(type, points) {
  await send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([id, x, y]) => ({ id, x, y, radiusX: 4, radiusY: 4, force: 1 })) });
}
async function pinch(selector) {
  const {x,y} = await rect(selector);
  await touch('touchStart', [[0,x-35,y],[1,x+35,y]]);
  for (let step = 1; step <= 8; step++) {
    await touch('touchMove', [[0,x-35-step*6,y],[1,x+35+step*6,y]]);
    await delay(20);
  }
  // Continue dragging with the remaining finger, without a position jump.
  await touch('touchEnd', [[0,x-83,y]]);
  await touch('touchMove', [[0,x-60,y+15]]);
  await touch('touchEnd', []);
}
async function screenshot(filename) {
  if (!process.env.VIEWER_SCREENSHOT_DIR) return;
  const result = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(`${process.env.VIEWER_SCREENSHOT_DIR}/${filename}.png`, Buffer.from(result.data, 'base64'));
}

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: appUrl });
  await waitFor(`document.querySelector('.map-stage')?.getAttribute('aria-busy') === 'false'`);
  const mapRange = '.map-zoom-controls input[type=range]';
  const mapNumber = '.map-zoom-controls input[type=number]';
  const startScroll = await evaluate('window.scrollY');
  const mapRect = await rect('.map-canvas');
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: mapRect.x, y: mapRect.y, deltaX: 0, deltaY: -120 });
  await waitFor(`Number(document.querySelector('${mapRange}').value) > 120`);
  assert.equal(await evaluate('window.scrollY'), startScroll, 'Map wheel must not scroll document');
  await setInput(mapNumber, 237);
  await waitFor(`document.querySelector('${mapRange}').value === '237'`);
  await setInput(mapRange, 350);
  await waitFor(`document.querySelector('${mapRange}').value === '350'`);
  console.log('PASS desktop wheel isolation, numeric zoom, continuous slider');

  const content = JSON.parse(await readFile(new URL('../src/data/content.json', import.meta.url), 'utf8'));
  const bindMap = content.maps.find((map) => map.id === 'bind');
  await send('Fetch.enable', { patterns: [{ urlPattern: `*${bindMap.imageHiRes}*`, requestStage: 'Request' }] });
  await click('.map-card:nth-child(2)');
  await waitFor(`document.querySelector('.map-stage').getAttribute('aria-busy') === 'true'`);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.map-canvas')).visibility`), 'hidden', 'Hide both image and annotations while loading');
  // Switch again before the previous image arrives; its late load cannot win.
  await click('.map-card:nth-child(3)');
  await waitFor(`document.querySelector('.map-stage').getAttribute('aria-busy') === 'false'`);
  for (const request of paused.splice(0)) await send('Fetch.continueRequest', { requestId: request.requestId });
  await send('Fetch.disable');
  await delay(300);
  assert((await evaluate(`document.querySelector('.map-image').src`)).includes(content.maps[2].imageHiRes));
  assert.equal(await evaluate(`document.querySelector('${mapRange}').value`), '100');

  await send('Fetch.enable', { patterns: [{ urlPattern: `*${content.maps[4].imageHiRes}*`, requestStage: 'Request' }] });
  await click('.map-card:nth-child(5)');
  for (let count = 0; !paused.length && count < 30; count++) await delay(100);
  assert(paused.length, 'Map request should be intercepted');
  for (const request of paused.splice(0)) await send('Fetch.failRequest', { requestId: request.requestId, errorReason: 'Failed' });
  await waitFor(`document.querySelector('.canvas-status')?.textContent.includes('地图加载失败')`);
  await send('Fetch.disable');
  await click('.canvas-status button');
  await waitFor(`document.querySelector('.map-stage').getAttribute('aria-busy') === 'false' && !document.querySelector('.canvas-status')`);
  console.log('PASS slow map loading, stale request protection, failure and retry');

  await click('.map-card:first-child');
  await waitFor(`document.querySelector('.media-preview-button') !== null`);
  await click('.media-preview-button');
  await waitFor(`document.querySelector('.image-lightbox-image') !== null`);
  const imageRange = '.image-lightbox input[type=range]';
  const imageNumber = '.image-lightbox input[type=number]';
  await setInput(imageNumber, 250);
  await waitFor(`document.querySelector('${imageRange}').value === '250'`);
  const imageRect = await rect('.image-lightbox-canvas');
  const lockedScroll = await evaluate('window.scrollY');
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: imageRect.x, y: imageRect.y, deltaX: 0, deltaY: -120 });
  await waitFor(`Number(document.querySelector('${imageRange}').value) > 300`);
  assert.equal(await evaluate('window.scrollY'), lockedScroll);
  const close = await rect('.image-lightbox-close');
  const cross = await rect('.image-lightbox-close svg');
  assert(Math.abs(close.x-cross.x) < .5 && Math.abs(close.y-cross.y) < .5, 'Close icon must be centered');
  await screenshot('viewer-desktop');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await waitFor(`!document.querySelector('.image-lightbox')`);
  assert.equal(await evaluate('document.body.style.position'), '');
  assert.equal(await evaluate(`document.activeElement.className`), 'media-preview-button');
  console.log('PASS image zoom, scroll lock, centered close icon, Escape and focus restoration');

  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: appUrl });
  await waitFor(`document.querySelector('.map-stage')?.getAttribute('aria-busy') === 'false'`);
  await evaluate(`document.querySelector('.map-stage').scrollIntoView({block:'center'})`);
  const mobileScroll = await evaluate('window.scrollY');
  await pinch('.map-canvas');
  await waitFor(`Number(document.querySelector('${mapRange}').value) > 200`);
  assert.equal(await evaluate('window.scrollY'), mobileScroll);
  await click('.media-preview-button');
  await waitFor(`document.querySelector('.image-lightbox-image') !== null`);
  await pinch('.image-lightbox-canvas');
  await waitFor(`Number(document.querySelector('${imageRange}').value) > 200`);
  await setInput(imageNumber, 800);
  await waitFor(`document.querySelector('${imageRange}').value === '800'`);
  const dragCenter = await rect('.image-lightbox-canvas');
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: dragCenter.x, y: dragCenter.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: -5000, y: -5000, button: 'left', buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: -5000, y: -5000, button: 'left', clickCount: 1 });
  assert(await evaluate(`(() => {
    const img = document.querySelector('.image-lightbox-image');
    const box = document.querySelector('.image-lightbox-canvas');
    const m = new DOMMatrix(getComputedStyle(img).transform);
    const scale = Math.min(box.clientWidth / img.naturalWidth, box.clientHeight / img.naturalHeight);
    const maxX = Math.max(0, (img.naturalWidth * scale * m.a - box.clientWidth) / 2);
    const maxY = Math.max(0, (img.naturalHeight * scale * m.a - box.clientHeight) / 2);
    return Math.abs(m.e) <= maxX + 1 && Math.abs(m.f) <= maxY + 1;
  })()`), 'Letterboxed image must remain within pan bounds');
  await click('.image-lightbox .zoom-reset');
  await pinch('.image-lightbox-canvas');
  await screenshot('viewer-mobile');
  for (const [width, height] of [[320,568],[844,390]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
    await delay(200);
    assert(await evaluate(`(() => { const r = document.querySelector('.image-lightbox-footer').getBoundingClientRect(); const c = document.querySelector('.image-lightbox-close').getBoundingClientRect(); return r.bottom <= innerHeight + 1 && r.right <= innerWidth && c.right <= innerWidth && c.top >= 0 && document.querySelector('.image-lightbox-canvas').clientHeight > 0; })()`), 'Controls must fit portrait and landscape');
  }
  await click('.image-lightbox-close');
  await waitFor(`!document.querySelector('.image-lightbox')`);
  assert.equal(await evaluate('document.body.style.position'), '');
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
  console.log('PASS mobile pinch and pan, scroll isolation, narrow and landscape layouts');
} finally {
  await send('Fetch.disable').catch(() => {});
  socket.close();
}

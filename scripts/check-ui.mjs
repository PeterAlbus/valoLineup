// Use only an isolated Chromium instance: this resets the test origin's local edits.
// Optional third argument saves screenshots to an existing directory.
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

for (const file of await readdir('src')) {
  if (!/\.(tsx?|mjs)$/.test(file)) continue;
  assert(!/\b(?:window\.)?(?:confirm|alert|prompt)\s*\(/.test(await readFile(`src/${file}`, 'utf8')), `${file} must not use host-blocked system prompts`);
}
const [debugUrl = 'http://127.0.0.1:9335', appUrl = 'http://127.0.0.1:4174/', output] = process.argv.slice(2);
const tab = (await fetch(`${debugUrl}/json`).then((r) => r.json())).find((tab) => tab.type === 'page' && tab.url.startsWith(appUrl));
assert(tab, 'Open the app in an isolated test browser');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0;
const pending = new Map();
ws.onmessage = ({ data }) => {
  const result = JSON.parse(data), request = pending.get(result.id);
  if (result.method === 'Page.javascriptDialogOpening' && result.params.type === 'beforeunload') void send('Page.handleJavaScriptDialog', { accept: true });
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
async function screenshot(name) {
  if (!output) return;
  const capture = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(output, `${name}.png`), Buffer.from(capture.data, 'base64'));
}
async function viewportFits(label) {
  assert(await evaluate('document.documentElement.scrollWidth <= innerWidth'), `${label}: page must not overflow horizontally`);
}
try {
  await send('Page.enable'); await size(1440);
  await send('Page.navigate', { url: appUrl });
  await wait("document.querySelector('.editor-enter') && !document.querySelector('.editor-enter').disabled");
  await evaluate("localStorage.removeItem('valo-lineup:v4:/')");
  await send('Page.navigate', { url: appUrl });
  await wait("document.querySelector('.editor-enter') && !document.querySelector('.editor-enter').disabled && document.querySelector('.map-stage').getAttribute('aria-busy') === 'false'");
  assert(await evaluate("document.querySelector('.topbar .package-import input') && !document.querySelector('.topbar .package-import input').disabled"));
  await screenshot('refined-desktop');
  const viewerLayout = new Map();
  for (const width of [1440, 1280, 1024, 980, 760, 390, 320]) {
    await size(width); await viewportFits(`Viewer ${width}`);
    viewerLayout.set(width, await evaluate("document.querySelector('.content-grid').getBoundingClientRect().top"));
    if (width > 760) assert(await evaluate("Math.abs(document.querySelector('.editor-actions').getBoundingClientRect().right - document.querySelector('.editing-toolbar').getBoundingClientRect().right) < 1"), 'Editing entry aligns with the right edge');
  }
  await size(390, 844); await screenshot('refined-mobile');
  await size(1440);
  await evaluate("window.toy={isSupport:async()=>true,getUserProfile:async()=>({nickname:'UI Test',avatar:'',toyOpenId:'ui-test-only'})}");
  await click('.editor-enter'); await wait("document.querySelector('.lineup-fields select')");
  assert(await evaluate("document.querySelector('.topbar .package-import input').disabled"), 'Import must not overwrite an active unsaved edit session');
  for (const [width, top] of viewerLayout) {
    await size(width); await viewportFits(`Editor ${width}`);
    assert(Math.abs(await evaluate("document.querySelector('.content-grid').getBoundingClientRect().top") - top) < 1, `Entering editor preserves content height at ${width}px`);
    assert(await evaluate("(() => {const input=document.querySelector('[aria-label=点位区域]').getBoundingClientRect();return [...document.querySelectorAll('.area-shortcuts button')].every(button=>{const r=button.getBoundingClientRect();return Math.abs(r.top-input.top)<1 && r.left>=input.right})})()"), `Area shortcuts stay beside the input at ${width}px`);
  }
  await size(1440);
  await wait("!document.querySelector('.editor-message')");
  const contentTop = await evaluate("document.querySelector('.content-grid').getBoundingClientRect().top");
  await evaluate("window.dispatchEvent(new StorageEvent('storage',{key:'valo-lineup:v4:/'}))");
  await wait("document.querySelector('.editor-message[role=alert]')");
  assert.equal(await evaluate("document.querySelector('.content-grid').getBoundingClientRect().top"), contentTop, 'Error messages do not shift layout');
  await wait("!document.querySelector('.editor-message')");
  await evaluate("window.dispatchEvent(new StorageEvent('storage',{key:'valo-lineup:v4:/'}))");
  await wait("document.querySelector('.editor-message')");
  await click('[aria-label=关闭提示]');
  assert(!await evaluate("document.querySelector('.editor-message')"));
  console.log('PASS stable editor height, right-aligned entry, inline area shortcuts, transient and dismissible messages');
  await viewportFits('Editor'); await screenshot('refined-editor');
  await click('.editor-new'); await wait("document.querySelector('.placement-guide')");
  const point = await evaluate("(() => {const r=document.querySelector('.map-canvas').getBoundingClientRect();return {x:r.x+r.width*.8,y:r.y+r.height/2}})()");
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  await wait("document.querySelector('.new-lineup-heading')");
  await wait("document.activeElement.getAttribute('aria-label') === '点位名称'");
  await click('.agent-picker-toggle');
  assert(await evaluate("[...document.querySelectorAll('.agent-picker-grid button')].every(button => button.querySelector('img') && button.textContent.trim())"), 'Each hero choice includes an avatar and name');
  await evaluate("document.querySelector('.agent-picker-grid button').focus()");
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await wait("!document.querySelector('.agent-picker-grid')");
  await click('.agent-picker-toggle');
  await screenshot('editor-hero-grid');
  for (const width of [1440, 1024, 980, 760, 390, 320]) {
    await size(width); await viewportFits(`New point ${width}`);
    await evaluate("document.querySelector('.detail-panel').scrollTop = 10000; window.scrollTo(0, document.documentElement.scrollHeight)");
    assert(await evaluate("(() => {const r=document.querySelector('.editor-save').getBoundingClientRect();const n=document.querySelector('.save-state').getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight && n.top>=0 && n.bottom<=innerHeight})()"), `Save and feedback remain visible at ${width}px`);
  }
  await screenshot('editor-narrow');
  await click('.new-lineup-cancel'); await wait("!document.querySelector('.new-lineup-heading')");
  await size(1440);
  await click('.lineup-delete'); await wait("document.querySelector('.confirm-dialog')?.open");
  await screenshot('refined-confirm');
  // The dialog traps focus, protects background buttons, and does not confirm on backdrop clicks.
  await evaluate("document.querySelector('.confirm-cancel').focus()");
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: 8 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  assert(await evaluate("document.querySelector('.confirm-dialog').contains(document.activeElement)"));
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 10, y: 10, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 10, y: 10, button: 'left', clickCount: 1 });
  assert(await evaluate("document.querySelector('.confirm-dialog').open"));
  await size(390, 844); await screenshot('refined-mobile-confirm');
  await click('.confirm-cancel'); await wait("!document.querySelector('.confirm-dialog')");
  await click('.editor-cancel'); await wait("document.querySelector('.exit-edit-dialog')?.open");
  await click('.exit-edit-confirm'); await wait("!document.querySelector('.editor-cancel')");
  await click('.history-toggle'); await wait("document.querySelector('.history-page')");
  await viewportFits('Mobile history'); await screenshot('refined-mobile-history');
  await size(1440); await screenshot('refined-history');
  console.log('PASS unified prompt audit, responsive layouts 320–1440px, keyboard-operable hero grid and persistent save controls, modal focus and backdrop safety');
} finally { ws.close(); }

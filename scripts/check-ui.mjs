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
  for (const width of [1440, 1280, 1024, 980, 760, 390, 320]) {
    await size(width); await viewportFits(`Viewer ${width}`);
  }
  await size(390, 844); await screenshot('refined-mobile');
  await size(1440);
  await evaluate("window.toy={isSupport:async()=>true,getUserProfile:async()=>({nickname:'UI Test',avatar:'',toyOpenId:'ui-test-only'})}");
  await click('.editor-enter'); await wait("document.querySelector('.lineup-fields select')");
  assert(await evaluate("document.querySelector('.topbar .package-import input').disabled"), 'Import must not overwrite an active unsaved edit session');
  await viewportFits('Editor'); await screenshot('refined-editor');
  await click('.editor-new'); await wait("document.querySelector('.new-lineup-dialog')?.open");
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.new-lineup-dialog select')).colorScheme"), 'dark');
  assert(await evaluate("document.querySelector('.new-lineup-dialog').contains(document.activeElement)"));
  assert(await evaluate("(() => {const area=document.querySelector('.area-input').getBoundingClientRect(); const title=document.querySelector('.new-lineup-dialog input[maxlength=\"100\"]').getBoundingClientRect();return Math.abs(area.top-title.top)<1 && Math.abs(area.height-title.height)<1})()"), 'Area shortcuts must not add a row or misalign the title field');
  // Native select still supports keyboard navigation, without adding a custom inaccessible listbox.
  await evaluate("document.querySelectorAll('.new-lineup-dialog select')[1].focus()");
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
  await wait("document.querySelectorAll('.new-lineup-dialog select')[1].value === 'defense'");
  await screenshot('refined-new-lineup');
  await size(390, 844);
  assert(await evaluate("(() => {const r=document.querySelector('.new-lineup-dialog').getBoundingClientRect(); return r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight})()"));
  await screenshot('refined-mobile-form');
  await click('.dialog-cancel'); await wait("!document.querySelector('.new-lineup-dialog')");
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
  console.log('PASS unified prompt audit, responsive layouts 320–1440px, dark keyboard-operable selects, modal focus and backdrop safety');
} finally { ws.close(); }

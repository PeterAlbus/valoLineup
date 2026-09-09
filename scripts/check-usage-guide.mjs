// Run against an isolated Chromium instance; guide read state is reset for this test.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
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

const guideKey = `valo-lineup:guide:${new URL(appUrl).pathname}`;
async function escape() {
  await send('Input.dispatchKeyEvent', {type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await send('Input.dispatchKeyEvent', {type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
}
async function assertDialogFits() {
  assert(await evaluate("(()=>{const r=document.querySelector('.usage-guide').getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&document.querySelector('.guide-body').scrollWidth<=document.querySelector('.guide-body').clientWidth})()"));
  assert.equal(await evaluate("document.body.style.overflow"), 'hidden');
}
try {
  await send('Page.enable'); await size(1440);
  await send('Page.navigate', {url:appUrl});
  await wait("document.querySelector('.guide-trigger')");
  await evaluate(`localStorage.removeItem(${JSON.stringify(guideKey)})`);
  await send('Page.navigate', {url:appUrl});
  await wait("document.querySelector('.usage-guide')?.open");
  assert.equal(await evaluate("document.querySelectorAll('.guide-desktop-note').length"),0);
  assert((await evaluate("document.querySelector('.usage-guide').textContent")).includes('确认新增'));
  assert((await evaluate("document.querySelector('.usage-guide').textContent")).includes('不会自动同步'));
  await assertDialogFits(); await screenshot('guide-desktop');
  assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(guideKey)})`),'seen');
  await send('Page.navigate', {url:appUrl}); await wait("document.querySelector('.guide-trigger')");
  assert.equal(await evaluate("document.querySelectorAll('.usage-guide').length"),0, 'A second visit does not reopen an unclosed first-visit guide');
  await click('.guide-trigger'); await wait("document.querySelector('.usage-guide')?.open");
  await click('.guide-done'); await wait("!document.querySelector('.usage-guide')");
  assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(guideKey)})`),'seen');
  assert.equal(await evaluate("document.activeElement.className"),'guide-trigger');
  assert.equal(await evaluate("document.body.style.overflow"),'');
  await send('Page.navigate', {url:appUrl}); await wait("document.querySelector('.guide-trigger')");
  assert.equal(await evaluate("document.querySelectorAll('.usage-guide').length"),0);
  const layoutBefore=await evaluate("document.querySelector('.content-grid').getBoundingClientRect().top");
  await click('.guide-trigger'); await wait("document.querySelector('.usage-guide')?.open");
  await click('.guide-close');
  assert.equal(await evaluate("document.querySelector('.content-grid').getBoundingClientRect().top"),layoutBefore);
  await click('.history-toggle'); await wait("document.querySelector('.topbar h1').textContent==='更新历史'");
  await click('.guide-trigger'); await wait("document.querySelector('.usage-guide')?.open"); await escape();
  assert.equal(await evaluate("document.querySelectorAll('.usage-guide').length"),0);
  await click('.history-toggle');
  for(const [width,height] of [[390,844],[320,568],[844,390]]) {
    await size(width,height);
    await evaluate(`localStorage.removeItem(${JSON.stringify(guideKey)})`);
    await send('Page.navigate',{url:appUrl}); await wait("document.querySelector('.usage-guide')?.open");
    assert.equal(await evaluate("document.querySelector('.guide-body').firstElementChild.className"),'guide-desktop-note');
    assert.equal(await evaluate("document.querySelector('.guide-desktop-note a').href"),'https://www.bilibili.com/toy/valo-lineup/index.html');
    assert.equal(await evaluate("document.querySelectorAll('.editor-enter').length"),0);
    assert(!(await evaluate("document.querySelector('.guide-body').textContent")).includes('确认新增'));
    await assertDialogFits(); await viewportFits(`Guide ${width}`); await screenshot(`guide-mobile-${width}`);
    await send('Page.navigate', {url:appUrl}); await wait("document.querySelector('.guide-trigger')");
    assert.equal(await evaluate("document.querySelectorAll('.usage-guide').length"),0, 'Mobile repeat visits also preserve first-display state');
    await click('.guide-trigger'); await wait("document.querySelector('.usage-guide')?.open");
    await escape(); await wait("!document.querySelector('.usage-guide')");
    await viewportFits(`Page ${width}`);
    assert(await evaluate("(()=>{const r=document.querySelector('.guide-trigger').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})()"));
  }
  await size(1440); await send('Page.navigate',{url:appUrl});
  await wait("document.querySelector('.editor-enter') && !document.querySelector('.editor-enter').disabled");
  assert.equal(await evaluate("document.querySelectorAll('.usage-guide').length"),0);
  await evaluate("window.toy={isSupport:async()=>false}");
  await click('.editor-enter'); await wait("document.querySelector('.editor-new')");
  await click('.editor-new'); await wait("document.querySelector('.placement-guide')");
  await click('.guide-trigger'); await wait("document.querySelector('.usage-guide')?.open");
  await escape(); assert(await evaluate("Boolean(document.querySelector('.placement-guide'))"),'Help does not cancel pending placement');
  await click('.placement-guide .new-lineup-cancel');
  await click('.editor-cancel'); await wait("document.querySelector('.exit-edit-dialog')?.open"); await click('.exit-edit-confirm');
  console.log('PASS first-visit guide, desktop/mobile copy, PC link, persistent dismissal, title entry, history access, focus restoration, scroll lock and 320px/landscape layouts');
} finally { ws.close(); }

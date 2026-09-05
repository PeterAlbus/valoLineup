// Run only in the isolated browser used by test:browser. This resets the test origin's local edits.
import assert from 'node:assert/strict';

const [debugUrl = 'http://127.0.0.1:9335', appUrl = 'http://127.0.0.1:4174/'] = process.argv.slice(2);
const tabs = await fetch(`${debugUrl}/json`).then((response) => response.json());
const tab = tabs.find((item) => item.type === 'page' && item.url.startsWith(appUrl));
assert(tab, 'Open the app in an isolated browser');
const socket = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let sequence = 0;
const pending = new Map();
socket.onmessage = (event) => {
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
const frame = 'window.exitTestFrame.contentWindow';
const doc = `${frame}.document`;
const storageKey = `valo-lineup:v4:${new URL(appUrl).pathname}`;
async function wait(expression) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate(`Boolean(${expression})`)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Condition failed: ${expression}`);
}
const click = (selector) => evaluate(`${doc}.querySelector(${JSON.stringify(selector)}).click()`);
async function edit(value) {
  await evaluate(`(() => {const input=${doc}.querySelector('.instructions-editor textarea');Object.getOwnPropertyDescriptor(${frame}.HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new ${frame}.Event('input',{bubbles:true}));})()`);
}
async function enter() {
  await evaluate(`${frame}.toy={isSupport:async()=>true,getUserProfile:async()=>({nickname:'Exit Regression',avatar:'',toyOpenId:'test-only-exit'})}`);
  await click('.editor-enter'); await wait(`${doc}.querySelector('.instructions-editor textarea')`);
}
async function requestExit() {
  await click('.editor-cancel'); await wait(`${doc}.querySelector('.exit-edit-dialog')?.open`);
}
try {
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: appUrl });
  await wait(`document.querySelector('.editor-enter') && !document.querySelector('.editor-enter').disabled`);
  await evaluate(`localStorage.removeItem(${JSON.stringify(storageKey)});window.exitTestFrame=document.createElement('iframe');window.exitTestFrame.sandbox='allow-scripts allow-same-origin';window.exitTestFrame.src=${JSON.stringify(appUrl)};window.exitTestFrame.style.cssText='position:fixed;inset:0;width:100%;height:100%;border:0;z-index:9999';document.body.append(window.exitTestFrame)`);
  await wait(`${doc}.querySelector('.editor-enter') && !${doc}.querySelector('.editor-enter').disabled`);
  assert.equal(await evaluate(`${frame}.confirm('Native modal sandbox probe')`), false, 'The regression environment must suppress native confirm');
  await enter();
  await requestExit();
  assert.equal(await evaluate(`${doc}.activeElement.className`), 'exit-edit-continue', 'Default focus must be non-destructive');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await wait(`!${doc}.querySelector('.exit-edit-dialog')`);
  assert(await evaluate(`!!${doc}.querySelector('.editor-cancel')`));

  await edit('Unsaved sandbox draft'); await requestExit();
  await click('.exit-edit-continue');
  await wait(`!${doc}.querySelector('.exit-edit-dialog')`);
  assert.equal(await evaluate(`${doc}.querySelector('.instructions-editor textarea').value`), 'Unsaved sandbox draft');
  await requestExit(); await click('.exit-edit-confirm');
  await wait(`${doc}.querySelector('.editor-enter') && !${doc}.querySelector('.editor-cancel')`);
  assert.notEqual(await evaluate(`${doc}.querySelector('.detail-lead').textContent`), 'Unsaved sandbox draft');
  assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(storageKey)})`), null, 'Discard must not implicitly save');

  await enter(); await edit('Saved sandbox draft'); await click('.editor-save');
  await wait(`${doc}.querySelector('.editor-save').disabled && !${doc}.querySelector('.editor-cancel').disabled`);
  const saved = await evaluate(`localStorage.getItem(${JSON.stringify(storageKey)})`);
  await edit('Throw away only the newest change'); await requestExit();
  await click('.exit-edit-confirm'); await wait(`${doc}.querySelector('.detail-lead')?.textContent === 'Saved sandbox draft'`);
  assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(storageKey)})`), saved, 'Exit preserves the saved manual layer and images');
  await enter(); await requestExit(); await click('.exit-edit-confirm');
  await wait(`${doc}.querySelector('.editor-enter')`);

  await enter(); await edit('Mobile unsaved draft');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await requestExit();
  assert(await evaluate(`(() => {const r=${doc}.querySelector('.exit-edit-dialog').getBoundingClientRect();return r.left>=0 && r.right<=${frame}.innerWidth && r.top>=0 && r.bottom<=${frame}.innerHeight})()`));
  await click('.exit-edit-confirm'); await wait(`!${doc}.querySelector('.editor-cancel')`);
  assert.equal(await evaluate(`${doc}.querySelector('.detail-lead').textContent`), 'Saved sandbox draft');
  console.log('PASS sandboxed exit without allow-modals, Escape/cancel, unsaved discard, saved-layer preservation, clean exit and mobile dialog');
} finally {
  await evaluate(`window.exitTestFrame?.remove();localStorage.removeItem(${JSON.stringify(storageKey)})`).catch(() => {});
  socket.close();
}

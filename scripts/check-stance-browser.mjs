// Run only against an isolated Chromium instance; edits stay in the test browser.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const [debugUrl = 'http://127.0.0.1:9335', appUrl = 'http://127.0.0.1:4174/', output] = process.argv.slice(2);
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
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }).catch(error => { throw new Error(expression + ': ' + error.message); });
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
const click = (selector) => evaluate(`(() => { const el=document.querySelector(${JSON.stringify(selector)}); el.focus({preventScroll:true}); el.click(); })()`);
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

const content = JSON.parse(await readFile('src/data/content.json', 'utf8'));
const base = content.lineups[0];
const make = (id, abilityId, target) => ({ ...base, id, title: id, agentId: 'sova', abilityId, target, media: { stance: [], aim: [], effect: [] } });
const target = { groupId: 'stance-methods', x: .6, y: .4 };
const first = make('stance-first', 'recon-bolt', target);
const second = make('stance-second', 'recon-bolt', target);
const pathRecord = { ...make('stance-path', 'owl-drone', { groupId:'stance-path', x:.45, y:.4 }), effect: { type:'path', points:[{x:.5,y:.4},{x:.6,y:.4}] } };
const unsetPath = make('stance-no-path', 'owl-drone', { groupId:'stance-no-path', x:.3, y:.7 });
const key = `valo-lineup:v4:${new URL(appUrl).pathname}`;
const manifest = { format:'valo-lineup-edit-package', version:4, packageId:crypto.randomUUID(), revision:1, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), author:base.uploader, changes:{added:[first,second,pathRecord,unsetPath],updated:[]},uploadedAssets:[] };
const pick = (name) => click(`.lineup-pin[aria-label*="${name}"]`);
const button = (name) => evaluate(`(() => { const buttons=[...document.querySelectorAll('button')]; const b=buttons.find(b=>b.getAttribute('aria-label')===${JSON.stringify(name)}) ?? buttons.find(b=>b.textContent.trim()===${JSON.stringify(name)}); if(!b) throw Error('Missing button'); b.click(); })()`);
const center = selector => evaluate(`(() => {const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
const mapPoint = (x,y) => evaluate(`(() => {const r=document.querySelector('.map-canvas').getBoundingClientRect(),m=new DOMMatrix(getComputedStyle(document.querySelector('.map-transform-layer')).transform),p=m.transformPoint(new DOMPoint((${x}-.5)*r.width,(${y}-.5)*r.height));return {x:r.left+r.width/2+p.x,y:r.top+r.height/2+p.y};})()`);
async function place(x,y) { const p=await mapPoint(x,y);await mouse('mousePressed',p);await mouse('mouseReleased',p); }
const marker = id => `.stance-pin[data-lineup-id="${id}"]`;
async function drag(selector,x,y) { const start=await center(selector),end=await mapPoint(x,y);await mouse('mousePressed',start);for(let i=1;i<=8;i++)await mouse('mouseMoved',{x:start.x+(end.x-start.x)*i/8,y:start.y+(end.y-start.y)*i/8});await mouse('mouseReleased',end); }
const linePoint = id => evaluate(`(() => {const l=document.querySelector('.stance-connections line[data-lineup-id="${id}"]');return {x:Number(l.getAttribute('x1'))/1000,y:Number(l.getAttribute('y1'))/1000};})()`);
const close = (a,b) => assert(Math.hypot(a.x-b.x,a.y-b.y)<.003,JSON.stringify({a,b}));
async function ready() { await wait("document.querySelector('.editor-enter') && !document.querySelector('.editor-enter').disabled && document.querySelector('.map-stage').getAttribute('aria-busy') === 'false'"); }
async function edit() { await evaluate("window.toy={isSupport:async()=>true,getUserProfile:async()=>({nickname:'Stance Test',toyOpenId:'stance-test'})}");await click('.editor-enter');await wait("document.querySelector('.lineup-fields')"); }
try {
  await send('Page.enable');await size(1440,900);await send('Page.navigate',{url:appUrl});await ready();
  await evaluate(`localStorage.setItem(${JSON.stringify(key)},JSON.stringify({version:1,token:'stance-test',packages:[],manual:${JSON.stringify(manifest)}}));localStorage.setItem('valo-lineup:guide:'+location.pathname,'seen')`);
  await send('Page.navigate',{url:appUrl});await ready();await edit();await pick('stance-first');
  assert.equal(await evaluate("document.querySelectorAll('.stance-add').length"),2);
  await click('.lineup-fields .stance-add');await wait("document.querySelector('.stance-placement')");
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});
  assert(!await evaluate("Boolean(document.querySelector('.stance-placement'))"));
  assert(!await evaluate("Boolean(document.querySelector('.stance-pin'))"));
  await click('.lineup-fields .stance-add');await place(.35,.6);await wait(`document.querySelector('${marker(first.id)}')`);
  assert.equal(await evaluate("document.querySelectorAll('.stance-add').length"),0,'Both entries disappear after placement');
  close(await linePoint(first.id),{x:.35,y:.6});
  await click('.method-list button:nth-child(2)');await click('.media-section .stance-add');await place(.7,.6);
  assert.equal(await evaluate("document.querySelectorAll('.stance-pin').length"),2);
  await click(marker(first.id));assert.equal(await evaluate("document.querySelector('[aria-label=点位名称]').value"),first.id);
  assert(await evaluate("document.querySelector('.method-list button:first-child').getAttribute('aria-pressed')==='true'"));
  await input('.map-zoom-controls input[type=range]','200');await wait("document.querySelector('.map-zoom-controls input[type=range]').value==='200'");
  await evaluate('new Promise(r=>setTimeout(r,500))');
  await drag(marker(first.id),.4,.55);close(await linePoint(first.id),{x:.4,y:.55});
  close(await linePoint(second.id),{x:.7,y:.6});
  await click('.zoom-reset');
  await pick('stance-no-path');assert(!await evaluate("Boolean(document.querySelector('.stance-add,.stance-pin'))"),'Unset paths have no independent stance');
  await pick('stance-path');close(await linePoint(pathRecord.id),{x:.45,y:.4});
  assert(!await evaluate("Boolean(document.querySelector('.stance-add'))"));
  await drag(marker(pathRecord.id),.45,.48);close(await linePoint(pathRecord.id),{x:.45,y:.48});
  assert.equal(await evaluate("document.querySelector('.stance-connections line').getAttribute('x2')"),'600','Path endpoint is preserved');
  await button('编辑路径');await button('重置');assert(!await evaluate("Boolean(document.querySelector('.stance-pin'))"),'Reset path preview removes derived stance');
  await click('.geometry-cancel');await wait("document.querySelector('.stance-pin')");
  await button('保存编辑');await wait("document.querySelector('.save-state')?.textContent.includes('已保存')");
  const saved = await evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(key)})).manual`);
  const records=[...saved.changes.added,...saved.changes.updated.map(x=>x.after)];
  close(records.find(x=>x.id===first.id).stance,{x:.4,y:.55});
  close(records.find(x=>x.id===pathRecord.id).target,{x:.45,y:.48});
  assert(!Object.hasOwn(records.find(x=>x.id===pathRecord.id),'stance'));
  await send('Page.navigate',{url:appUrl});await ready();await pick('stance-first');
  assert.equal(await evaluate("document.querySelectorAll('.stance-pin').length"),3,'Viewer shows all methods at the selected destination');
  await click(marker(second.id));assert.equal(await evaluate("document.querySelector('.detail-panel h2').textContent"),second.id);
  await click(marker(pathRecord.id));assert.equal(await evaluate("document.querySelector('.detail-panel h2').textContent"),pathRecord.id);
  if (output) await writeFile(output+'-desktop.png',Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await size(390,844);await click(marker(first.id));assert.equal(await evaluate("document.querySelector('.detail-panel h2').textContent"),first.id);
  assert(!await evaluate("Boolean(document.querySelector('.stance-add'))"));
  assert(await evaluate("document.documentElement.scrollWidth<=innerWidth"));
  if (output) await writeFile(output+'-mobile.png',Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await size(1440,900);
  console.log('PASS stance entry points, cancellation, drag at zoom, method selection, path origin/reset, local persistence and mobile viewer');
} finally { await evaluate(`localStorage.removeItem(${JSON.stringify(key)})`).catch(()=>{}); ws.close(); }

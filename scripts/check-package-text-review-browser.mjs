import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';
import { browserFixture, requireFixtureServer } from './fixtures/browser.mjs';
import { manifestSchema } from '../src/package-model.mjs';
import { TEXT_REVIEW_RULES_URL } from '../src/package-text-review.mjs';
const wordList=JSON.parse(await readFile(new URL('../publishing/text-review-rules.json',import.meta.url),'utf8'));
const [debugUrl = 'http://127.0.0.1:9335', appUrl = 'http://127.0.0.1:4174/'] = process.argv.slice(2);
await requireFixtureServer(appUrl);
const content = await browserFixture();
const base = content.lineups[0];
const tabs = await (await fetch(`${debugUrl}/json`)).json();
const tab = tabs.find(item => item.type === 'page' && item.url.startsWith(appUrl));
assert(tab, 'Open the synthetic app in an isolated browser');
const socket = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let sequence = 0;
const pending = new Map();
socket.onmessage = event => {
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
async function wait(expression) {
  for (let i = 0; i < 100; i++) {
    if (await evaluate(`Boolean(${expression})`)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Condition failed: ${expression}\n${await evaluate("document.querySelector('.editor-message')?.textContent")}`);
}
const storageKey = `valo-lineup:v4:${new URL(appUrl).pathname}`;
const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
async function navigate() {
  await send('Page.navigate', { url: appUrl });
  await wait(`document.querySelector('.editor-enter') && !document.querySelector('.editor-enter').disabled`);
  await evaluate(`window.toy={isSupport:async()=>true,getUserProfile:async()=>({nickname:'Reference Tester',toyOpenId:'test-reference-only'})}`);
}
async function reset() {
  await send('Storage.clearDataForOrigin', { origin: new URL(appUrl).origin, storageTypes: 'local_storage,indexeddb' });
  await navigate();
}

async function importFixture(manifest) {
  await evaluate("document.querySelector('.editor-message button')?.click()");
  await wait("!document.querySelector('.editor-message') && !document.querySelector('.package-import input').disabled");
  const zip=new JSZip();zip.file('manifest.json',JSON.stringify(manifestSchema.parse(manifest)));
  const bytes=(await zip.generateAsync({type:'nodebuffer'})).toString('base64');
  await evaluate(`(() => {const data=Uint8Array.from(atob('${bytes}'),c=>c.charCodeAt(0));const input=document.querySelector('.package-import input'),transfer=new DataTransfer();transfer.items.add(new File([data],'review.zip',{type:'application/zip'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
}
const record={...base,instructions:'正常测试说明',media:{stance:[],aim:[],effect:[]}};
const clean={format:'valo-lineup-edit-package',version:4,packageId:crypto.randomUUID(),revision:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),author:base.uploader,changes:{added:[],updated:[{id:base.id,before:base,after:record}]},uploadedAssets:[]};
let reviewScript;
try {
  await send('Page.enable');
  reviewScript=await send('Page.addScriptToEvaluateOnNewDocument',{source:`(() => {
    const original=window.fetch;
    window.reviewMode='loaded';window.reviewRequests=0;
    window.fetch=(url,options)=>{
      if(String(url)!==${JSON.stringify(TEXT_REVIEW_RULES_URL)}) return original.call(window,url,options);
      window.reviewRequests++;
      if(window.reviewMode==='failed')return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve(Response.json(${JSON.stringify(wordList)}));
    };
  })()`});
  await send('Browser.setDownloadBehavior',{behavior:'deny'});
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await reset();
  await evaluate("localStorage.setItem('valo-lineup:guide:'+location.pathname,'seen')");await navigate();
  await importFixture(clean);await wait("document.querySelector('.editor-message')?.textContent.includes('已导入')");
  const prior=await evaluate(`localStorage.getItem(${JSON.stringify(storageKey)})`);
  for(const field of ['title','instructions','uploader','before']) {
    const bad=structuredClone(clean);bad.packageId=crypto.randomUUID();
    const update=bad.changes.updated[0];
    if(field==='title')update.after.title='https://example.com';
    if(field==='instructions')update.after.instructions='裸聊';
    if(field==='uploader')update.after.uploader.name='习近平';
    if(field==='before')update.before.instructions='www.example.com';
    await importFixture(bad);await wait("document.querySelector('.editor-message')?.textContent.includes('导入已中止')");
    assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(storageKey)})`),prior);
  }
  const deleted={...structuredClone(clean),version:5,changes:{added:[],updated:[],deleted:[{id:base.id,before:{...record,title:'色情'}}]}};
  await importFixture(deleted);await wait("document.querySelector('.editor-message')?.textContent.includes('删除点位')");
  assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(storageKey)})`),prior);
  const media=Object.values(base.media).flat()[0],descriptor=content.mediaAssets[media.key];
  const referenced={...structuredClone(clean),version:6,referencedAssets:[{...descriptor,key:media.key,lineupId:base.id,kind:'stance',alt:'https://example.com'}]};
  referenced.changes.updated[0].after.media.stance=[{key:media.key,alt:'https://example.com'}];
  await importFixture(referenced);await wait("document.querySelector('.editor-message')?.textContent.includes('导入已中止')");
  assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(storageKey)})`),prior);
  await click('.editor-enter');await wait("document.querySelector('.instructions-editor textarea')");
  await evaluate("(() => { const input=document.querySelector('.instructions-editor textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'https://example.com');input.dispatchEvent(new Event('input',{bubbles:true}));window.zipCount=0;const create=URL.createObjectURL;URL.createObjectURL=function(blob){if(blob.type==='application/zip')window.zipCount++;return create.call(this,blob)}; })()");
  await click('.editor-export');await wait("document.querySelector('.editor-message')?.textContent.includes('导出已中止')");
  assert.equal(await evaluate('window.zipCount'),0);
  assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(storageKey)})`),prior);
  assert.equal(await evaluate("document.querySelector('.instructions-editor textarea').value"),'https://example.com');
  const selectionExpression="({side:document.querySelector('.side-filter [aria-pressed=true]').textContent,title:document.querySelector('input[aria-label=点位名称]').value})";
  const selection=await evaluate(selectionExpression);
  for(const text of ['https://example.com','成人小說','中央統戰部']) {
    await evaluate(`(() => {const input=document.querySelector('.instructions-editor textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await click('.editor-save');await wait("document.querySelector('.editor-message')?.textContent.includes('保存已中止') && !document.querySelector('.editor-save').disabled");
    assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(storageKey)})`),prior,'Rejected save preserves committed data');
    assert.equal(await evaluate("document.querySelector('.instructions-editor textarea').value"),text,'Rejected save preserves the draft');
    assert.deepEqual(await evaluate(selectionExpression),selection,'Rejected save preserves the selection');
  }
  await evaluate("(() => {const input=document.querySelector('.instructions-editor textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'正常说明，A点跳投');input.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await click('.editor-save');await wait("document.querySelector('.editor-message')?.textContent.includes('已保存') && document.querySelector('.editor-save').disabled");
  // Seed an existing local edit to exercise loading and repairing previously saved text.
  await evaluate(`(() => {const key=${JSON.stringify(storageKey)},lib=JSON.parse(localStorage.getItem(key));lib.manual.changes.updated[0].before.instructions='裸聊';lib.manual.changes.updated[0].after.instructions='https://example.com';localStorage.setItem(key,JSON.stringify(lib));})()`);
  await navigate();await click('.history-toggle');await wait("document.querySelector('.local-edit-card .action-primary')");
  await click('.local-edit-card .action-primary');await wait("document.querySelector('.editor-message')?.textContent.includes('导出已中止')");
  await click('.history-toggle');await click('.editor-enter');await wait("document.querySelector('.instructions-editor textarea')");
  assert.equal(await evaluate("document.querySelector('.instructions-editor textarea').value"),'https://example.com','Existing data still loads');
  await evaluate("(() => {const input=document.querySelector('.instructions-editor textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'正常说明，A点跳投');input.dispatchEvent(new Event('input',{bubbles:true}));window.zipCount=0;const create=URL.createObjectURL;URL.createObjectURL=function(blob){if(blob.type==='application/zip')window.zipCount++;return create.call(this,blob)};})()");
  await click('.editor-save');await wait("document.querySelector('.editor-message')?.textContent.includes('已保存') && document.querySelector('.editor-save').disabled");
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)})).manual.changes.updated[0].after.instructions`),'正常说明，A点跳投','Old text can be corrected and saved');
  await click('.editor-export');await wait("document.querySelector('.editor-message')?.textContent.includes('导出已中止')");
  assert.equal(await evaluate('window.zipCount'),0,'Exchange still checks the historical snapshot');
  await evaluate(`(() => {const key=${JSON.stringify(storageKey)},lib=JSON.parse(localStorage.getItem(key));lib.manual.changes.updated[0].before.instructions='正常测试说明';localStorage.setItem(key,JSON.stringify(lib));})()`);
  await navigate();
  await evaluate("window.zipCount=0;const create=URL.createObjectURL;URL.createObjectURL=function(blob){if(blob.type==='application/zip')window.zipCount++;return create.call(this,blob)}");
  await click('.editor-export');await wait('window.zipCount===1');
  await evaluate("window.reviewMode='failed'");
  const unavailable={...structuredClone(clean),packageId:crypto.randomUUID()};
  unavailable.changes.updated[0].after.instructions='成人小說';
  await importFixture(unavailable);await wait("document.querySelector('.editor-message')?.textContent.includes('已导入') && document.querySelector('.editor-message')?.textContent.includes('词库加载失败')");
  assert(await evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)})).packages.some(item=>item.packageId==='${unavailable.packageId}')`),'Dictionary failure does not block import');
  await click('.editor-enter');await wait("document.querySelector('.instructions-editor textarea')");
  await evaluate("(() => {const input=document.querySelector('.instructions-editor textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'成人小說');input.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await click('.editor-save');await wait("document.querySelector('.editor-message')?.textContent.includes('已保存') && document.querySelector('.editor-message')?.textContent.includes('词库加载失败')");
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)})).manual.changes.updated[0].after.instructions`),'成人小說','Dictionary failure does not block save');
  await click('.editor-export');await wait("window.zipCount===2 && document.querySelector('.editor-message')?.textContent.includes('词库加载失败')");
  await evaluate("window.reviewMode='loaded'");
  await click('.editor-export');await wait("document.querySelector('.editor-message')?.textContent.includes('导出已中止')");
  assert.equal(await evaluate('window.zipCount'),2,'Recovered dictionary blocks matching content');
  await evaluate("window.reviewMode='failed';(() => {const input=document.querySelector('.instructions-editor textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'https://example.com');input.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await click('.editor-save');await wait("document.querySelector('.editor-message')?.textContent.includes('保存已中止')");
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)})).manual.changes.updated[0].after.instructions`),'成人小說','Links still block saving during a dictionary outage');
  console.log('PASS remote save/import/export review, preserved data on matches, nonblocking dictionary outages with messages, recovery and link checks');
} finally {
  try { if(reviewScript)await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:reviewScript.identifier}); }
  finally { socket.close(); }
}

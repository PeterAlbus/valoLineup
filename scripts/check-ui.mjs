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
  await wait("document.querySelector('.editor-enter')");
  await evaluate("localStorage.removeItem('valo-lineup:v4:/')");
  await send('Page.navigate', { url: appUrl });
  await wait("document.querySelector('.editor-enter') && !document.querySelector('.editor-enter').disabled && document.querySelector('.map-stage').getAttribute('aria-busy') === 'false'");
  assert(await evaluate("document.querySelector('.topbar .package-import input') && !document.querySelector('.topbar .package-import input').disabled"));
  await screenshot('refined-desktop');
  const viewerLayout = new Map();
  for (const width of [1440, 1280, 1024, 980, 760, 390, 320]) {
    await size(width); await viewportFits(`Viewer ${width}`);
    if (width > 760) viewerLayout.set(width, await evaluate("document.querySelector('.content-grid').getBoundingClientRect().top"));
    if (width > 760) assert(await evaluate("Math.abs(document.querySelector('.editor-actions').getBoundingClientRect().right - document.querySelector('.editing-toolbar').getBoundingClientRect().right) < 1"), 'Editing entry aligns with the right edge');
  }
  await size(390, 844); await screenshot('refined-mobile');
  const mobileStageTop = await evaluate("document.querySelector('.map-stage').getBoundingClientRect().top");
  assert(mobileStageTop < 190, 'Mobile map starts near the top of the screen');
  assert(!await evaluate("document.querySelector('.editing-toolbar, .editor-enter, .agent-tabs')"), 'Phone browsing has no editing toolbar or expanding hero tabs');
  for (const [width, height] of [[320,844], [390,844], [844,390]]) {
    await size(width, height);
    assert(await evaluate("document.querySelector('.map-detail-jump').getBoundingClientRect().width > 0"), 'Stacked map offers a details button');
    assert(await evaluate("document.querySelector('.map-detail-jump').getBoundingClientRect().left >= document.querySelector('.perspective-controls').getBoundingClientRect().right"), 'Details button does not overlap perspective controls');
    assert(!await evaluate("document.querySelector('.page-back-top')"), 'Back to top stays hidden while the map is visible');
    const selectedPin = await evaluate("document.querySelector('.lineup-pin.is-active')?.getAttribute('aria-label')");
    await click('.map-detail-jump');
    await wait("document.querySelector('.page-back-top') && Math.abs(document.querySelector('.detail-panel').getBoundingClientRect().top - 12) < 2");
    assert.equal(await evaluate("document.activeElement.id"), 'lineup-detail', 'Detail navigation moves keyboard focus to the reading section');
    assert.equal(await evaluate("document.querySelector('.lineup-pin.is-active')?.getAttribute('aria-label')"), selectedPin, 'Navigation preserves the selected point');
    assert(await evaluate("(() => { const button=document.querySelector('.page-back-top').getBoundingClientRect(), text=document.querySelector('.detail-lead').getBoundingClientRect(); return button.left >= text.right && button.right <= innerWidth; })()"), 'Back to top stays outside the text column');
    await viewportFits(`Detail navigation ${width}`);
    await screenshot(`mobile-details-${width}`);
    await click('.page-back-top');
    await wait("window.scrollY === 0 && !document.querySelector('.page-back-top')");
  }
  await size(1440);
  assert(await evaluate("document.querySelector('.map-detail-jump').getBoundingClientRect().width === 0"), 'Side-by-side desktop layout hides scroll navigation');
  await size(980,900);
  await click('.map-detail-jump');
  await wait("Math.abs(document.querySelector('.detail-panel').getBoundingClientRect().top - document.querySelector('.workspace-toolbar').getBoundingClientRect().bottom - 12) < 2");
  await evaluate("window.scrollTo(0,0)");
  await wait("window.scrollY === 0 && !document.querySelector('.page-back-top')");
  console.log('PASS detail navigation, map visibility, text clearance, selection preservation and desktop/tablet/phone layouts');
  await size(390,844);
  const content = JSON.parse(await readFile('src/data/content.json', 'utf8'));
  const fixture = {
    format: 'valo-lineup-edit-package', version: 5, packageId: 'baaa5138-4667-48ac-9117-19c971e68fc1', revision: 1,
    createdAt: '2026-09-07T00:00:00.000Z', updatedAt: '2026-09-07T00:00:00.000Z', author: {name:'Mobile Test',source:'local'},
    changes: { added: content.agents.flatMap(agent => ['attack','defense'].map(side => ({
      ...content.lineups[0], id: `mobile-${agent.id}-${side}`, mapId:'ascent', agentId:agent.id, abilityId:agent.abilities[0].id,
      title:`${agent.name}手机浏览`, side, target:{groupId:`mobile-${agent.id}-${side}`,x:.5,y:.5},
      media:{stance:[],aim:[],effect:[]},
    }))), updated:[], deleted:[] }, uploadedAssets:[],
  };
  await evaluate(`localStorage.setItem('valo-lineup:v4:/',JSON.stringify({version:1,token:'mobile-fixture',packages:[],manual:${JSON.stringify(fixture)}}))`);
  await send('Page.navigate', {url:appUrl});
  await wait(`document.querySelector('.mobile-agent-select select')?.options.length === ${content.agents.length} && !document.querySelector('.topbar .package-import input').disabled`);
  assert.equal(await evaluate("document.querySelector('.map-stage').getBoundingClientRect().top"), mobileStageTop, 'Many heroes and saved edits do not increase header height');
  await evaluate("document.querySelector('.mobile-agent-select select').focus()");
  await send('Input.dispatchKeyEvent', {type:'keyDown',key:'End',code:'End',windowsVirtualKeyCode:35});
  await send('Input.dispatchKeyEvent', {type:'keyUp',key:'End',code:'End',windowsVirtualKeyCode:35});
  await wait(`document.querySelector('.mobile-agent-select select').value === ${JSON.stringify(content.agents.at(-1).id)}`);
  assert.equal(await evaluate("document.querySelector('.mobile-agent-current b').textContent"), content.agents.at(-1).name);
  assert((await evaluate("document.querySelector('.detail-panel h2').textContent")).includes(content.agents.at(-1).name));
  for (const [width, height] of [[320,844],[390,844],[430,844],[760,844],[844,390]]) {
    await size(width,height); await viewportFits(`Mobile with many heroes ${width}`);
    assert(await evaluate("document.querySelector('.map-stage').getBoundingClientRect().top < 190"));
    assert(await evaluate("(() => {const a=document.querySelector('.mobile-agent-select').getBoundingClientRect(), b=document.querySelector('.side-filter').getBoundingClientRect();return a.right<=b.left && Math.abs((a.top+a.height/2)-(b.top+b.height/2))<1})()"), 'Hero and side filters share one row');
    await evaluate("window.scrollTo(0,400)");
    await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    assert(await evaluate("document.querySelector('.workspace-toolbar').getBoundingClientRect().bottom < 0"), 'Mobile toolbar scrolls out of view');
    await evaluate("window.scrollTo(0,0)");
  }
  await size(390,844); await screenshot('mobile-many-heroes');
  await click('.side-filter button:nth-child(2)');
  await wait("document.querySelector('.side-filter button:nth-child(2)').getAttribute('aria-pressed') === 'true'");
  await click('.map-card:nth-child(2)');
  await wait("document.querySelector('.mobile-agent-select select').options.length < 3");
  const emptyMapIndex = content.maps.findIndex(map => !content.lineups.some(lineup => lineup.mapId === map.id));
  assert(emptyMapIndex >= 0, 'The empty-map scenario needs a map without built-in points');
  await click(`.map-card:nth-child(${emptyMapIndex + 1})`);
  await wait("document.querySelector('.mobile-agent-select select').disabled");
  assert(!await evaluate("document.querySelector('.map-detail-jump, .page-back-top')"), 'Empty maps have no detail navigation');
  assert((await evaluate("document.querySelector('.empty-state').textContent")).includes('切换阵营'));
  await click('.history-toggle'); await wait("document.querySelector('.local-edit-card')");
  assert(await evaluate("!document.querySelector('.editing-toolbar') && !document.querySelector('.local-edit-card .action-primary').disabled"), 'Saved package download remains available in mobile history');
  await screenshot('mobile-compact-history');
  await evaluate("localStorage.removeItem('valo-lineup:v4:/')");
  await size(1440); await send('Page.navigate',{url:appUrl});
  await wait("document.querySelector('.editor-enter') && !document.querySelector('.editor-enter').disabled");
  console.log('PASS compact mobile layout, natural scrolling, native hero selection with many heroes, empty maps and history access');
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
    if (width > 760) assert(await evaluate("(() => {const r=document.querySelector('.editor-save').getBoundingClientRect();const n=document.querySelector('.save-state').getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight && n.top>=0 && n.bottom<=innerHeight})()"), `Save and feedback remain visible at ${width}px`);
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

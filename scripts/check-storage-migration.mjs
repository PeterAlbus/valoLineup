// Run with an isolated Chromium on port 9336 and the fixture server on port 4174.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { browserFixture } from './fixtures/browser.mjs';

const origin = 'http://127.0.0.1:4174';
const tabs = await fetch('http://127.0.0.1:9336/json').then((r) => r.json());
const tab = tabs.find((item) => item.type === 'page' && item.url.startsWith(origin));
assert(tab, 'Start an isolated test browser');
const socket = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve) => { socket.onopen = resolve; });
let sequence = 0;
const pending = new Map();
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  const callback = pending.get(message.id);
  if (callback) { pending.delete(message.id); callback(message); }
};
async function evaluate(expression) {
  const id = ++sequence;
  const response = new Promise((resolve) => pending.set(id, resolve));
  socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  const result = await response;
  assert(!result.error && !result.result.exceptionDetails, JSON.stringify(result));
  return result.result.result.value;
}
// Keep production relative-base behavior, which Vite replaces with '/' during dev.
const source = (await readFile(new URL('../src/local-library.ts', import.meta.url), 'utf8'))
  .replaceAll('import.meta.env.BASE_URL', "'./'")
  .replace("'./package-model.mjs'", `'${origin}/src/package-model.mjs'`)
  .replace("'./image-compression'", `'${origin}/src/image-compression.ts'`);
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const fixture = await browserFixture();
try {
  const result = await evaluate(`(async () => {
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    const moduleUrl = ${JSON.stringify(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)};
    const load = async (path, suffix) => { history.replaceState(null, '', path); return import(moduleUrl + '#' + suffix); };
    const root = '/toy/migration-test-' + crypto.randomUUID() + '/';
    const base = ${JSON.stringify(fixture.lineups[0])};
    const lib = await load(root + '28949166118912-v12228/index.html', root + 'first');
    const stable = 'valo-lineup:v4:' + root;
    check(lib.STORAGE_KEY === stable, 'Toy-level key');
    const next = await load(root + '99999999999999-v12229/index.html', root + 'next');
    check(next.STORAGE_KEY === stable, 'Key survives publication');
    check((await load('/custom/index.html', 'custom')).STORAGE_KEY === 'valo-lineup:v4:/custom/', 'Other deployments remain scoped');
    const prefix = stable + '28949166118912-v';
    const dbName = (key) => key + ':images';
    const putImage = async (key, blob) => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName(key), 1);
        request.onupgradeneeded = () => request.result.createObjectStore('blobs');
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      await new Promise((resolve, reject) => {
        const tx = database.transaction('blobs', 'readwrite');
        tx.objectStore('blobs').put(blob, 'a'.repeat(64));
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
      }); database.close();
    };
    const manifest = (date, image = false) => ({
      format: 'valo-lineup-edit-package', version: 4, packageId: crypto.randomUUID(), revision: 1,
      createdAt: date, updatedAt: date, author: { name: 'Migration test', source: 'local' },
      changes: { added: image ? [{ ...base, id: 'test', media: { stance: [], aim: [{ key: 'lineups/test/image.png', alt: 'test' }], effect: [] } }] : [], updated: [] }, uploadedAssets: image ? [{
        key: 'lineups/test/image.png', lineupId: 'test', kind: 'aim', alt: 'test',
        mimeType: 'image/png', size: 3, sha256: 'a'.repeat(64),
      }] : [],
    });
    const seed = (key, manual) => localStorage.setItem(key, JSON.stringify({ version: 1, token: key, packages: [], manual }));
    const older = prefix + '1/', latest = prefix + '2/';
    seed(older, manifest('2026-09-01T00:00:00Z'));
    const selected = manifest('2026-09-02T00:00:00Z', true);
    seed(latest, selected); await putImage(latest, new Blob(['abc']));
    const [saved, duplicate] = await Promise.all([lib.migrateVersionStorage(), lib.migrateVersionStorage()]);
    check(saved.manual.packageId === selected.packageId && duplicate.token === saved.token, 'Latest snapshot and concurrent startup');
    check(await (await lib.readImage(selected.uploadedAssets[0])).text() === 'abc', 'Image copied');
    check(localStorage.getItem(latest) === null && localStorage.getItem(older) !== null, 'Only migrated metadata removed');
    check(!(await indexedDB.databases()).some((db) => db.name === dbName(latest)), 'Migrated image database removed');
    seed(latest, manifest('2026-09-03T00:00:00Z'));
    check((await next.migrateVersionStorage()).token === saved.token && localStorage.getItem(latest) !== null, 'Existing stable data wins');
    localStorage.removeItem(stable); localStorage.removeItem(older);
    seed(latest, manifest('2026-09-04T00:00:00Z', true));
    let failed = false;
    try { await lib.migrateVersionStorage(); } catch { failed = true; }
    check(failed && localStorage.getItem(latest) !== null && localStorage.getItem(stable) === null, 'Missing images preserve source without committing');
    await putImage(latest, new Blob(['abc']));
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) { if (key === stable) throw new DOMException('full', 'QuotaExceededError'); return setItem.call(this, key, value); };
    failed = false;
    try { await lib.migrateVersionStorage(); } catch { failed = true; } finally { Storage.prototype.setItem = setItem; }
    check(failed && localStorage.getItem(latest) !== null && localStorage.getItem(stable) === null, 'Failed commit preserves source');
    await lib.migrateVersionStorage();
    check(localStorage.getItem(stable) !== null && localStorage.getItem(latest) === null, 'Retry recovers');
    return 'PASS stable Toy key, newest snapshot, images, cleanup, concurrent startup, existing data, missing images, quota failure and retry';
  })()`);
  console.log(result);
} finally { socket.close(); }

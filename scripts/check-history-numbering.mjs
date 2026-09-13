import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

// Render the actual component with synthetic history, never with live lineup counts.
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' });
try {
  const { default: HistoryPage } = await server.ssrLoadModule('/src/HistoryPage.tsx');
  const noop = () => {};
  const render = (entries, packages = []) => renderToStaticMarkup(createElement(HistoryPage, {
    entries, packages, manual: null, dirty: false, maps: [], busy: false, editing: false,
    onImport: noop, onMove: noop, onRemove: noop, onExport: noop, onClearManual: noop,
  }));
  const labels = html => [...html.matchAll(/<small>(.*?)<\/small>/g)].map(match => match[1]);
  const revisions = [44, 1, 44, 7, 99, 2, 3];
  const history = revisions.map((revision, index) => ({
    id: `history-${index}`, packageId: `package-${index % 2}`, revision,
    appliedAt: '2026-01-01T00:00:00.000Z', author: { name: 'Fixture Author' },
    mapIds: [], lineupIds: [], added: 0, updated: 0,
  }));
  for (const count of [0, 1, 3, history.length]) {
    const entries = history.slice(0, count), before = structuredClone(entries);
    const expected = entries.map((entry, index) => `第 ${index + 1} 次更新 · 编辑包修订版 r${entry.revision}`).reverse();
    assert.deepEqual(labels(render(entries)), expected, 'Chronological numbering is independent of package IDs and revisions');
    assert.deepEqual(entries, before, 'Rendering never reverses or rewrites stored history');
  }
  const packages = [44, 1].map((revision, index) => ({
    format: 'valo-lineup-edit-package', version: 4, packageId: `local-${index}`, revision,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    author: { name: 'Fixture Author', source: 'local' }, changes: { added: [], updated: [] }, uploadedAssets: [],
  }));
  for (const ordered of [packages, [...packages].reverse()]) {
    assert.deepEqual(labels(render([], ordered)), ordered.map(item => `编辑包修订版 r${item.revision}`), 'Reordering browser packages preserves their revisions, without claiming repository update counts');
  }
  const appended = [...history, { ...history[0], id: 'next-update', revision: 1 }];
  assert.equal(labels(render(appended))[0], `第 ${appended.length} 次更新 · 编辑包修订版 r1`, 'A new history entry increments the update count even when its revision starts over');
  assert.deepEqual(labels(render(appended)).slice(1), labels(render(history)), 'Appending history leaves existing update numbers unchanged');
  assert.match(render([]), /还没有内置资料更新记录/);
  console.log('PASS history numbering: empty/single/multiple records, repeated and decreasing revisions, append stability, local package reorder and non-mutating rendering');
} finally { await server.close(); }

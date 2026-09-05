import { readFile, readdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { stringify } from 'yaml';
import { encodeWebp } from './webp.mjs';
import { readSourceContent, stringifyLineups, writeTextAtomic, buildContent } from './content-model.mjs';

const root = process.cwd();
const publicRoot = path.resolve(root, 'public');
const publishingRoot = path.resolve(root, 'publishing');
const content = await readSourceContent(root);
const migrations = { ...content.imageMigrations };
const converted = [];
const metadataPaths = ['content/maps.yaml', 'content/agents.yaml', 'content/lineups.yaml', 'content/image-migrations.json'];
const originals = new Map();
for (const name of metadataPaths) {
  try { originals.set(name, await readFile(path.join(root, name), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; originals.set(name, null); }
}
async function visit(directory, boundary) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.resolve(directory, entry.name);
    if (!file.startsWith(`${boundary}${path.sep}`) || entry.isSymbolicLink()) throw new Error(`拒绝越界或链接路径：${file}`);
    if (entry.isDirectory()) { await visit(file, boundary); continue; }
    if (!/\.(png|jpe?g)$/i.test(file)) continue; // Existing WebP assets are already encoded; never degrade them repeatedly.
    const bytes = await readFile(file);
    const output = new Uint8Array(await (await encodeWebp(new Blob([bytes], { type: /\.png$/i.test(file) ? 'image/png' : 'image/jpeg' }))).arrayBuffer());
    const sourceSha256 = createHash('sha256').update(bytes).digest('hex');
    const sha256 = createHash('sha256').update(output).digest('hex');
    const destination = file.replace(/\.[^.]+$/, `-${sha256.slice(0, 16)}.webp`);
    await writeFile(destination, output, { flag: 'wx' });
    converted.push({ file, destination, before: bytes.length, after: output.length });
    if (boundary === publicRoot) migrations[path.relative(publicRoot, file).replaceAll('\\', '/')] = { key: path.relative(publicRoot, destination).replaceAll('\\', '/'), sourceSha256, sha256 };
  }
}
try {
  await visit(publicRoot, publicRoot);
  await visit(publishingRoot, publishingRoot);
  for (const map of content.maps) for (const field of ['image', 'imageHiRes']) map[field] = migrations[map[field]]?.key ?? map[field];
  for (const agent of content.agents) {
    agent.icon = migrations[agent.icon]?.key ?? agent.icon;
    for (const ability of agent.abilities) ability.icon = migrations[ability.icon]?.key ?? ability.icon;
  }
  for (const lineup of content.lineups) for (const kind of ['stance', 'aim', 'effect']) for (const item of lineup.media[kind]) {
    const migration = migrations[item.key];
    if (!migration) continue;
    item.original ??= { key: item.key, sha256: migration.sourceSha256 };
    item.key = migration.key;
  }
  await writeTextAtomic(path.join(root, 'content/maps.yaml'), stringify(content.maps, { lineWidth: 0 }));
  await writeTextAtomic(path.join(root, 'content/agents.yaml'), stringify(content.agents, { lineWidth: 0 }));
  await writeTextAtomic(path.join(root, 'content/lineups.yaml'), stringifyLineups(content.lineups));
  await writeTextAtomic(path.join(root, 'content/image-migrations.json'), `${JSON.stringify(migrations, null, 2)}\n`);
  await buildContent(root);
} catch (error) {
  for (const [name, value] of originals) {
    if (value === null) await unlink(path.join(root, name)).catch(() => {});
    else await writeTextAtomic(path.join(root, name), value);
  }
  for (const item of converted) await unlink(item.destination);
  throw error;
}
// The replacement files and metadata have been validated. Delete only the exact originals converted above.
for (const item of converted) await unlink(item.file);
const before = converted.reduce((sum, item) => sum + item.before, 0);
const after = converted.reduce((sum, item) => sum + item.after, 0);
console.log(JSON.stringify({ converted: converted.length, originalBytes: before, webpBytes: after, savedPercent: before ? (100 * (1 - after / before)).toFixed(1) : 0 }));

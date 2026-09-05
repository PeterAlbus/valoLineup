import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import JSZip from 'jszip';
import { parse } from 'yaml';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'valo-lineup-parallel-test-'));
const importer = path.join(root, 'scripts', 'import-edit-package.mjs');

function changed(lineup, videoBvid) {
  return { ...lineup, videoBvid };
}

async function createPackage(name, changes, assets = []) {
  const zip = new JSZip();
  for (const asset of assets) zip.file(asset.key, asset.bytes);
  zip.file('manifest.json', `${JSON.stringify({
    format: 'valo-lineup-edit-package',
    version: 3,
    createdAt: new Date().toISOString(),
    changes,
    uploadedAssets: assets.map((asset) => ({
      key: asset.key,
      lineupId: asset.lineupId,
      kind: asset.kind,
      alt: asset.alt,
      mimeType: asset.mimeType,
      size: asset.size,
      sha256: asset.sha256,
    })),
  }, null, 2)}\n`);
  const packagePath = path.join(temporaryRoot, `${name}.zip`);
  await writeFile(packagePath, await zip.generateAsync({ type: 'nodebuffer' }));
  return packagePath;
}

async function importPackage(packagePath) {
  return execFileAsync(process.execPath, [importer, packagePath], { cwd: temporaryRoot });
}

try {
  await cp(path.join(root, 'content'), path.join(temporaryRoot, 'content'), { recursive: true });
  await mkdir(path.join(temporaryRoot, 'public', 'lineups'), { recursive: true });
  await symlink(path.join(root, 'public', 'maps'), path.join(temporaryRoot, 'public', 'maps'), 'dir');
  await symlink(path.join(root, 'public', 'agents'), path.join(temporaryRoot, 'public', 'agents'), 'dir');
  for (const entry of await readdir(path.join(root, 'public', 'lineups'), { withFileTypes: true })) {
    if (entry.isDirectory()) {
      await symlink(
        path.join(root, 'public', 'lineups', entry.name),
        path.join(temporaryRoot, 'public', 'lineups', entry.name),
        'dir',
      );
    }
  }
  await mkdir(path.join(temporaryRoot, 'src', 'data'), { recursive: true });

  const base = parse(await readFile(path.join(temporaryRoot, 'content', 'lineups.yaml'), 'utf8'));
  const firstBefore = base[0];
  const secondBefore = base.find((lineup) => lineup.target.groupId === 'a-site-fast');
  const firstAfter = changed(firstBefore, 'BV17x411w7KC');
  const secondAfter = changed(secondBefore, 'BV1xx411c7mD');
  const conflictingAfter = changed(firstBefore, 'BV1Q541167Qg');
  const sharedGroupBefore = base.filter((lineup) => lineup.target.groupId === 'a-site-scan');
  const sharedGroupAfter = sharedGroupBefore.map((lineup) => ({
    ...lineup,
    target: { ...lineup.target, x: lineup.target.x + 0.01 },
  }));
  const addedImage = {
    key: 'lineups/ascent-sova-paralleladd01/effect-01.png',
    alt: '并行新增测试点位效果图 1',
  };
  const added = {
    ...firstBefore,
    id: 'ascent-sova-paralleladd01',
    title: '并行新增测试点位',
    videoBvid: '',
    target: { groupId: 'parallel-add-test-target', x: 0.61, y: 0.62 },
    media: { stance: [], aim: [], effect: [addedImage] },
  };
  const addedImageBytes = await readFile(path.join(root, 'public', 'lineups', 'ascent-sova-01', 'aim-01.png'));
  const addedAsset = {
    ...addedImage,
    lineupId: added.id,
    kind: 'effect',
    mimeType: 'image/png',
    size: addedImageBytes.length,
    sha256: createHash('sha256').update(addedImageBytes).digest('hex'),
    bytes: addedImageBytes,
  };

  const firstPackage = await createPackage('first-update', {
    added: [],
    updated: [{ id: firstBefore.id, before: firstBefore, after: firstAfter }],
  });
  const secondPackage = await createPackage('second-update', {
    added: [],
    updated: [{ id: secondBefore.id, before: secondBefore, after: secondAfter }],
  });
  const mixedPackage = await createPackage('mixed-update', {
    added: [],
    updated: [
      { id: firstBefore.id, before: firstBefore, after: conflictingAfter },
      { id: secondBefore.id, before: secondBefore, after: secondAfter },
    ],
  });
  const sharedGroupPackage = await createPackage('shared-group-update', {
    added: [],
    updated: sharedGroupBefore.map((lineup, index) => ({
      id: lineup.id,
      before: lineup,
      after: sharedGroupAfter[index],
    })),
  });
  const additionPackage = await createPackage('addition', { added: [added], updated: [] }, [addedAsset]);

  await importPackage(firstPackage);
  const sharedGroupConflict = await importPackage(sharedGroupPackage);
  const mixed = await importPackage(mixedPackage);
  const repeated = await importPackage(secondPackage);
  await importPackage(additionPackage);

  const finalLineups = parse(await readFile(path.join(temporaryRoot, 'content', 'lineups.yaml'), 'utf8'));
  assert.equal(finalLineups.find((lineup) => lineup.id === firstBefore.id).videoBvid, firstAfter.videoBvid);
  assert.equal(finalLineups.find((lineup) => lineup.id === secondBefore.id).videoBvid, secondAfter.videoBvid);
  assert.ok(finalLineups.some((lineup) => lineup.id === added.id), 'A stale addition package must still merge');
  await access(path.join(temporaryRoot, 'public', addedImage.key));
  assert.match(repeated.stdout, /Already applied:/, 'Repeated imports must be idempotent');
  assert.match(mixed.stdout, /Imported 0 new and 1 updated/, 'A non-conflicting sibling update must still apply');
  assert.match(mixed.stderr, new RegExp(`Skipped 1 conflicting lineups:[\\s\\S]*${firstBefore.id}`));
  assert.match(sharedGroupConflict.stderr, /Skipped 3 conflicting lineups:/, 'A shared destination must remain coordinate-consistent');
  assert.ok(sharedGroupBefore.every((before) => {
    const current = finalLineups.find((lineup) => lineup.id === before.id);
    return current.target.x === before.target.x && current.target.y === before.target.y;
  }), 'A conflicted shared destination must keep all original coordinates');

  console.log('Edit package checks passed: parallel updates merge, conflicts skip per lineup, additions and images remain importable.');
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

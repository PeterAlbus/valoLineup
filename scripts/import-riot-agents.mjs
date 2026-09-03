import { access, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { stringify } from 'yaml';
import { buildContent, writeTextAtomic } from './content-model.mjs';

const root = process.cwd();
const catalogPath = process.argv[2];
const assetsRoot = process.argv[3];
if (!catalogPath || !assetsRoot) {
  throw new Error('用法：npm run content:import-agents -- /path/PublicContentCatalog.json /path/catalog-assets');
}

const catalog = JSON.parse(await readFile(path.resolve(catalogPath), 'utf8'));
const sourceRoot = path.resolve(assetsRoot);
const outputRoot = path.join(root, 'public', 'agents');
const slotOrder = ['ability1', 'ability2', 'grenade', 'ultimate', 'passive'];

function localized(value) {
  return value?.localizedByCulture?.['zh-CN'] || value?.defaultText || '';
}

function slug(value) {
  return value
    .normalize('NFKD')
    .replace(/[’']/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const agents = [];
for (const character of catalog.characters) {
  const agentId = slug(character.name.defaultText);
  const characterAsset = path.join(sourceRoot, 'Characters', `${character.id}_small.png`);
  await access(characterAsset);
  const agentDirectory = path.join(outputRoot, agentId);
  await mkdir(agentDirectory, { recursive: true });
  await sharp(characterAsset).resize(256, 256, { fit: 'contain' }).webp({ lossless: true }).toFile(path.join(agentDirectory, 'icon.webp'));

  const abilities = [];
  for (const slot of slotOrder) {
    const ability = character.abilities?.[slot];
    if (!ability?.name?.defaultText) continue;
    const source = path.join(sourceRoot, 'Abilities', `${character.id}_${slot[0].toUpperCase()}${slot.slice(1)}.png`);
    try {
      await access(source);
    } catch {
      continue;
    }
    const abilityId = slug(ability.name.defaultText);
    await sharp(source).resize(128, 128, { fit: 'contain' }).webp({ lossless: true }).toFile(path.join(agentDirectory, `${abilityId}.webp`));
    abilities.push({ id: abilityId, name: localized(ability.name), icon: `agents/${agentId}/${abilityId}.webp` });
  }

  if (abilities.length < 4) throw new Error(`${localized(character.name)} 的主动技能资料不完整`);
  agents.push({ id: agentId, name: localized(character.name), icon: `agents/${agentId}/icon.webp`, abilities });
}

agents.sort((left, right) => left.id.localeCompare(right.id));
const header = `# Riot Public Content Catalog ${catalog.version}\n# https://developer.riotgames.com/docs/valorant\n`;
await writeTextAtomic(path.join(root, 'content', 'agents.yaml'), `${header}${stringify(agents, { lineWidth: 0 })}`);
await buildContent(root);
console.log(`Imported ${agents.length} agents and ${agents.flatMap((agent) => agent.abilities).length} abilities from Riot catalog ${catalog.version}`);

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { mapUnitsPerMeter } from '../src/ability-geometry.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const content = JSON.parse(await fs.readFile(path.join(root, 'src/data/content.json'), 'utf8'));
const map = content.maps.find((item) => item.id === 'ascent');
const agent = content.agents.find((item) => item.id === 'sova');
const ability = agent?.abilities.find((item) => item.id === 'recon-bolt');
const selectedLineup = content.lineups.find((item) => item.target.groupId === 'a-site-scan');
const nearbyLineup = content.lineups.find((item) => item.target.groupId === 'a-site-upper');

if (!map || !agent || !ability || !selectedLineup || !nearbyLineup) throw new Error('Poster source data is incomplete');

const outputWidth = 1200;
const outputHeight = 900;
const mapSize = 1600;
const mapLeft = -450;
const mapTop = 170;
const backgroundPath = path.join(root, 'publishing/toy-poster-background-v2.png');
const outputPath = path.join(root, 'publishing/toy-poster-v2.png');

function rotatePoint(point, degrees) {
  const radians = degrees * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const x = point.x - 0.5;
  const y = point.y - 0.5;
  return { x: 0.5 + x * cos - y * sin, y: 0.5 + x * sin + y * cos };
}

function posterPoint(point) {
  const rotated = rotatePoint(point, map.perspectives.attack.rotation);
  return { x: mapLeft + rotated.x * mapSize, y: mapTop + rotated.y * mapSize };
}

function dataUrl(buffer, mimeType) {
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

const mapBuffer = await sharp(path.join(root, 'public', map.imageHiRes))
  .rotate(map.perspectives.attack.rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .resize(mapSize, mapSize, { fit: 'contain' })
  .grayscale()
  .tint('#68e0d6')
  .modulate({ brightness: 0.72, saturation: 1.08 })
  .png()
  .toBuffer();
const mapGlowBuffer = await sharp(mapBuffer)
  .blur(18)
  .modulate({ brightness: 0.45 })
  .png()
  .toBuffer();
const visibleMapWidth = Math.min(mapSize + mapLeft, outputWidth);
const visibleMapHeight = Math.min(mapSize, outputHeight - mapTop);
const visibleMapBuffer = await sharp(mapBuffer)
  .extract({ left: -mapLeft, top: 0, width: visibleMapWidth, height: visibleMapHeight })
  .png()
  .toBuffer();
const visibleMapGlowBuffer = await sharp(mapGlowBuffer)
  .extract({ left: -mapLeft, top: 0, width: visibleMapWidth, height: visibleMapHeight })
  .png()
  .toBuffer();
const abilityIcon = dataUrl(await sharp(path.join(root, 'public', ability.icon)).png().toBuffer(), 'image/png');

const selectedPoint = posterPoint(selectedLineup.target);
const nearbyPoint = posterPoint(nearbyLineup.target);
const rangeRadius = 30 * mapUnitsPerMeter.ascent * mapSize;
const site = map.sites.find((item) => item.label === 'A');
const sitePoint = posterPoint(site.region);
const siteWidth = site.region.height * mapSize;
const siteHeight = site.region.width * mapSize;

const overlaySvg = Buffer.from(`
<svg width="${outputWidth}" height="${outputHeight}" viewBox="0 0 ${outputWidth} ${outputHeight}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="title-plate" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#11191b" stop-opacity=".98"/>
      <stop offset=".58" stop-color="#090e10" stop-opacity=".96"/>
      <stop offset="1" stop-color="#05090b" stop-opacity=".86"/>
    </linearGradient>
    <linearGradient id="title-metal" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset=".54" stop-color="#f3f1e9"/>
      <stop offset="1" stop-color="#c8cfce"/>
    </linearGradient>
    <linearGradient id="title-red" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#7d211d" stop-opacity=".45"/>
      <stop offset="1" stop-color="#ff5a44"/>
    </linearGradient>
    <filter id="title-shadow" x="-20%" y="-30%" width="150%" height="190%">
      <feDropShadow dx="0" dy="10" stdDeviation="9" flood-color="#000" flood-opacity=".9"/>
      <feDropShadow dx="0" dy="2" stdDeviation="1" flood-color="#ff5a44" flood-opacity=".42"/>
    </filter>
    <filter id="plate-shadow" x="-15%" y="-15%" width="140%" height="150%">
      <feDropShadow dx="0" dy="16" stdDeviation="18" flood-color="#000" flood-opacity=".76"/>
    </filter>
    <filter id="pin-shadow" x="-150%" y="-150%" width="400%" height="400%">
      <feDropShadow dx="0" dy="8" stdDeviation="8" flood-color="#000" flood-opacity=".76"/>
    </filter>
  </defs>

  <circle cx="${selectedPoint.x}" cy="${selectedPoint.y}" r="${rangeRadius}" fill="#5ad4d1" fill-opacity=".2" stroke="#79e3d7" stroke-width="3"/>

  <rect x="${sitePoint.x - siteWidth / 2}" y="${sitePoint.y - siteHeight / 2}" width="${siteWidth}" height="${siteHeight}" rx="8" fill="#68e0d6" fill-opacity=".1" stroke="#68e0d6" stroke-opacity=".55" stroke-width="2"/>
  <text x="${sitePoint.x}" y="${sitePoint.y + 28}" text-anchor="middle" fill="#f4f1e9" fill-opacity=".72" font-family="Arial, sans-serif" font-size="84" font-weight="700">A</text>

  <g transform="translate(${nearbyPoint.x} ${nearbyPoint.y})" filter="url(#pin-shadow)">
    <circle r="29" fill="none" stroke="#68e0d6" stroke-opacity=".24" stroke-width="2"/>
    <circle r="21" fill="#0b1113" fill-opacity=".96" stroke="#68e0d6" stroke-width="2"/>
    <image href="${abilityIcon}" x="-12" y="-12" width="24" height="24"/>
  </g>

  <g transform="translate(${selectedPoint.x} ${selectedPoint.y})" filter="url(#pin-shadow)">
    <circle r="54" fill="none" stroke="#ff5a44" stroke-opacity=".22" stroke-width="2"/>
    <circle r="43" fill="#ff5a44" fill-opacity=".08" stroke="#ff5a44" stroke-width="3"/>
    <circle r="31" fill="#0b1113" fill-opacity=".98" stroke="#ff5a44" stroke-width="3"/>
    <image href="${abilityIcon}" x="-19" y="-19" width="38" height="38"/>
  </g>

  <g filter="url(#plate-shadow)">
    <path d="M46 48 H536 L568 78 H648 L616 115 H600 V300 L566 334 H390 L338 398 H46 V344 L30 328 V119 L46 103 Z"
      fill="url(#title-plate)" stroke="#68e0d6" stroke-opacity=".28" stroke-width="2"/>
    <path d="M46 48 H536 L568 78" fill="none" stroke="#68e0d6" stroke-width="4"/>
    <path d="M46 103 L30 119 V218" fill="none" stroke="#68e0d6" stroke-width="4"/>
    <path d="M46 398 H338 L390 334" fill="none" stroke="#68e0d6" stroke-opacity=".82" stroke-width="3"/>
    <path d="M479 89 H600 L574 121 H453 Z" fill="url(#title-red)"/>
    <path d="M559 334 L524 369 H500 L535 334 Z" fill="#68e0d6" fill-opacity=".5"/>
  </g>

  <g filter="url(#title-shadow)" transform="skewX(-4)">
    <text x="79" y="145" fill="url(#title-metal)" font-family="PingFang SC, Heiti SC, Arial Unicode MS, sans-serif" font-size="70" font-weight="900" letter-spacing="-5">无畏契约</text>
    <rect x="70" y="164" width="413" height="5" fill="#ff5a44"/>
    <text x="70" y="279" fill="url(#title-metal)" stroke="#ffffff" stroke-opacity=".18" stroke-width="1" font-family="Impact, Arial Black, Arial, sans-serif" font-size="128" font-weight="900" letter-spacing="-2">LINEUP</text>
    <text x="80" y="374" fill="url(#title-metal)" font-family="PingFang SC, Heiti SC, Arial Unicode MS, sans-serif" font-size="84" font-weight="900" letter-spacing="-6">图鉴</text>
  </g>
</svg>`);

await sharp(backgroundPath)
  .resize(outputWidth, outputHeight, { fit: 'cover' })
  .modulate({ brightness: 0.76, saturation: 0.9 })
  .composite([
    { input: visibleMapGlowBuffer, left: 0, top: mapTop, blend: 'screen' },
    { input: visibleMapBuffer, left: 0, top: mapTop, blend: 'screen' },
    { input: overlaySvg, left: 0, top: 0 },
  ])
  .png({ compressionLevel: 9 })
  .toFile(outputPath);

console.log(JSON.stringify({
  outputPath,
  width: outputWidth,
  height: outputHeight,
  map: map.name,
  perspective: 'attack',
  selectedAbility: ability.name,
  rangeMeters: 30,
  displayedMarkers: 2,
}, null, 2));

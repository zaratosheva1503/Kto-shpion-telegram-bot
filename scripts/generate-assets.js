const fs = require('fs');
const path = require('path');
const { PACKS } = require('../data/packs');

const root = path.join(__dirname, '..');
const packsDir = path.join(root, 'assets', 'packs');
const cardsDir = path.join(root, 'assets', 'cards');
fs.mkdirSync(packsDir, { recursive: true });
fs.mkdirSync(cardsDir, { recursive: true });

const escapeXml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;');

const palette = [
  ['#7c3aed', '#111827'], ['#2563eb', '#111827'], ['#dc2626', '#1f2937'],
  ['#059669', '#111827'], ['#d97706', '#111827'], ['#9333ea', '#18181b'],
  ['#0891b2', '#111827'], ['#be123c', '#111827'], ['#4f46e5', '#111827'],
  ['#65a30d', '#111827'], ['#c026d3', '#111827'], ['#0f766e', '#111827']
];

function writeSvg(filePath, { title, subtitle = '', emoji = '🃏', index = 0, kind = 'pack' }) {
  const [accent, bg] = palette[index % palette.length];
  const text = escapeXml(title);
  const sub = escapeXml(subtitle);
  const iconSize = kind === 'pack' ? 96 : 82;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600" viewBox="0 0 900 600">
  <defs>
    <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="${accent}"/>
      <stop offset="0.52" stop-color="${bg}"/>
      <stop offset="1" stop-color="#0b0b10"/>
    </linearGradient>
    <radialGradient id="spot" cx="70%" cy="18%" r="65%">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.24"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="14" stdDeviation="16" flood-color="#000" flood-opacity="0.45"/>
    </filter>
  </defs>
  <rect width="900" height="600" rx="54" fill="url(#g)"/>
  <rect width="900" height="600" rx="54" fill="url(#spot)"/>
  <circle cx="760" cy="95" r="135" fill="#fff" opacity="0.08"/>
  <circle cx="112" cy="508" r="190" fill="#000" opacity="0.18"/>
  <g filter="url(#shadow)">
    <rect x="94" y="90" width="712" height="420" rx="42" fill="#18181f" opacity="0.72"/>
    <text x="450" y="245" text-anchor="middle" font-size="${iconSize}" font-family="Arial, sans-serif">${emoji}</text>
    <text x="450" y="354" text-anchor="middle" fill="#fff" font-size="54" font-weight="800" font-family="Arial, sans-serif">${text}</text>
    <text x="450" y="420" text-anchor="middle" fill="#d7d2ff" font-size="28" font-weight="700" font-family="Arial, sans-serif">${sub}</text>
  </g>
</svg>`;
  fs.writeFileSync(filePath, svg);
}

let count = 0;
PACKS.forEach((pack, packIndex) => {
  writeSvg(path.join(packsDir, `${pack.id}.svg`), {
    title: pack.title,
    subtitle: `${pack.cards.length} карточек`,
    emoji: pack.emoji,
    index: packIndex,
    kind: 'pack'
  });
  pack.cards.forEach((card, cardIndex) => {
    writeSvg(path.join(cardsDir, `${card.id}.svg`), {
      title: card.name,
      subtitle: pack.title,
      emoji: pack.emoji,
      index: packIndex + cardIndex,
      kind: 'card'
    });
    count += 1;
  });
});

console.log(`Generated ${PACKS.length} pack images and ${count} card images.`);

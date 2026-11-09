// Deterministic application icons. No remote assets or fonts.
import { createCanvas } from '@napi-rs/canvas';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['icon-maskable.png', 512]]) {
  const canvas = createCanvas(size, size); const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#43866c'; ctx.fillRect(0, 0, size, size);
  ctx.scale(size / 128, size / 128); ctx.fillStyle = '#eef5df';
  ctx.beginPath(); ctx.moveTo(39, 77); ctx.bezierCurveTo(39, 49, 60, 37, 91, 37); ctx.bezierCurveTo(91, 70, 74, 89, 48, 83); ctx.lineTo(36, 94); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#43866c'; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(46, 79); ctx.lineTo(74, 54); ctx.stroke();
  writeFileSync(fileURLToPath(new URL(`../frontend/public/${name}`, import.meta.url)), canvas.toBuffer('image/png'));
}

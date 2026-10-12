import { cp, mkdir, readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'design-fee-calculator', 'dist');
const target = path.join(root, 'public', 'design-fee-calculator');
const html = await readFile(path.join(source, 'index.html'), 'utf8');
if (!html.includes('Design Fee Calculator') || !html.includes('./assets/')) {
  throw new Error('Expected a built calculator with relative asset URLs.');
}
await mkdir(target, { recursive: true });
for (const name of await readdir(source)) {
  await cp(path.join(source, name), path.join(target, name), { recursive: true });
}
console.log('Design Fee Calculator assets copied to public/design-fee-calculator');

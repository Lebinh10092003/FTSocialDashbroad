import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../src/', import.meta.url));
const allowed = new Set(['components/AppDialog.tsx']);
const nativeDialog = /(?<![\w.])(?:window\.)?(?:alert|confirm|prompt)\s*\(/g;
const violations = [];

async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await scan(path);
      continue;
    }
    if (!['.ts', '.tsx'].includes(extname(entry.name))) continue;

    const displayPath = relative(root, path).replaceAll('\\', '/');
    if (allowed.has(displayPath)) continue;

    const source = await readFile(path, 'utf8');
    for (const match of source.matchAll(nativeDialog)) {
      const line = source.slice(0, match.index).split('\n').length;
      violations.push(`${displayPath}:${line} (${match[0].trim()})`);
    }
  }
}

await scan(root);

if (violations.length) {
  console.error('Phát hiện popup trình duyệt kiểu cũ. Hãy dùng appDialog:');
  console.error(violations.map(item => `- ${item}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log('Không còn alert/confirm/prompt native trong src.');
}

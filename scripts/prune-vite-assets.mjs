import { promises as fs } from 'node:fs';
import path from 'node:path';

const projectDir = process.cwd();
const distDir = path.join(projectDir, 'dist');
const assetsDir = path.join(distDir, 'assets');
const viteDir = path.join(distDir, '.vite');
const manifestPath = path.join(viteDir, 'manifest.json');
const historyPath = path.join(viteDir, 'release-history.json');
const dryRun = process.argv.includes('--dry-run');
const keepArg = Number(process.argv[process.argv.indexOf('--keep') + 1]);
const keep = Number.isInteger(keepArg) && keepArg > 0 ? keepArg : 5;

const normalize = value => value.replaceAll('\\', '/').replace(/^\/+/, '');
const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const exists = async file => fs.access(file).then(() => true, () => false);

const manifest = await readJson(manifestPath);
const currentAssets = new Set();
for (const entry of Object.values(manifest)) {
  for (const value of [entry.file, ...(entry.css || []), ...(entry.assets || [])]) {
    if (value) currentAssets.add(normalize(value));
  }
}

const assetFiles = (await fs.readdir(assetsDir, { withFileTypes: true }))
  .filter(entry => entry.isFile())
  .map(entry => ({
    name: entry.name,
    relative: `assets/${entry.name}`,
    absolute: path.join(assetsDir, entry.name),
  }));
const byName = new Map(assetFiles.map(file => [file.name, file]));
const referencePattern = /[A-Za-z0-9_.-]+\.(?:js|css|map|woff2?|ttf|otf|png|jpe?g|gif|webp|svg|ico)/g;

async function collectClosure(seed) {
  const found = new Set();
  const queue = [...seed];
  while (queue.length) {
    const relative = normalize(queue.pop());
    if (found.has(relative)) continue;
    const file = byName.get(path.posix.basename(relative));
    if (!file) continue;
    found.add(file.relative);
    if (!/\.(?:js|css)$/.test(file.name)) continue;
    const source = await fs.readFile(file.absolute, 'utf8');
    for (const name of source.match(referencePattern) || []) {
      const linked = byName.get(name);
      if (linked && !found.has(linked.relative)) queue.push(linked.relative);
    }
  }
  return [...found];
}

let history = [];
if (await exists(historyPath)) {
  const stored = await readJson(historyPath);
  if (Array.isArray(stored.releases)) history = stored.releases;
}

if (!history.length) {
  const rootCandidates = [];
  for (const file of assetFiles.filter(file => /^index-.+\.js$/.test(file.name))) {
    if (currentAssets.has(file.relative)) continue;
    const source = await fs.readFile(file.absolute, 'utf8');
    if (!source.includes('DigitalTraining-')) continue;
    const stat = await fs.stat(file.absolute);
    rootCandidates.push({ file, mtimeMs: stat.mtimeMs });
  }
  rootCandidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const cssCandidates = [];
  for (const file of assetFiles.filter(file => /^index-.+\.css$/.test(file.name) && !currentAssets.has(file.relative))) {
    const stat = await fs.stat(file.absolute);
    cssCandidates.push({ file, mtimeMs: stat.mtimeMs });
  }
  cssCandidates.sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (let index = Math.min(keep - 1, rootCandidates.length) - 1; index >= 0; index -= 1) {
    const candidate = rootCandidates[index];
    const seeds = [candidate.file.relative];
    if (cssCandidates[index]) seeds.push(cssCandidates[index].file.relative);
    history.push({
      id: `legacy-${Math.round(candidate.mtimeMs)}`,
      createdAt: new Date(candidate.mtimeMs).toISOString(),
      assets: await collectClosure(seeds),
    });
  }
}

const currentRelease = {
  id: `release-${Date.now()}`,
  createdAt: new Date().toISOString(),
  assets: [...currentAssets].sort(),
};
history = [...history.filter(release => release.assets?.length), currentRelease].slice(-keep);

const retained = new Set(history.flatMap(release => release.assets.map(normalize)));
const stale = assetFiles.filter(file => !retained.has(file.relative));

if (!dryRun) {
  for (const file of stale) await fs.rm(file.absolute, { force: true });
  await fs.mkdir(viteDir, { recursive: true });
  const temporary = `${historyPath}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify({ keep, releases: history }, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, historyPath);
}

console.log(`${dryRun ? '[dry-run] ' : ''}Frontend releases retained: ${history.length}/${keep}`);
for (const release of history) {
  console.log(`- ${release.id}: ${release.assets.length} asset(s)`);
}
console.log(`${dryRun ? 'Would remove' : 'Removed'} ${stale.length} unreferenced asset(s); retained ${retained.size}.`);

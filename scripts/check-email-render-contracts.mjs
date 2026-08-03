import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = path => readFileSync(resolve(process.cwd(), path), 'utf8');
const fail = message => {
  console.error(`[email-render-contract] ${message}`);
  process.exitCode = 1;
};

const typesSource = read('src/types/emailBuilder.ts');
const contractSource = read('src/lib/emailRenderContract.ts');
const presentationSource = read('src/lib/emailPresentation.ts');
const generatorSource = read('src/lib/emailHtmlGenerator.ts');
const canvasSource = read('src/components/email-builder/EmailCanvas.tsx');

const blockTypeBody = typesSource.match(/export type BlockType\s*=([\s\S]*?);/)?.[1] || '';
const blockTypes = [...blockTypeBody.matchAll(/'([^']+)'/g)].map(match => match[1]);
if (!blockTypes.length) fail('Could not read BlockType union.');

for (const type of blockTypes) {
  const quotedKey = `  '${type}':`;
  const plainKey = `  ${type}:`;
  if (!contractSource.includes(quotedKey) && !contractSource.includes(plainKey)) {
    fail(`Missing Canvas / Preview / Copy contract for block type: ${type}`);
  }
}

const coreImportTypes = ['heading', 'paragraph', 'section', 'columns', 'data-table'];
for (const type of coreImportTypes) {
  if (!generatorSource.includes(`data-ft-block-type="${type}"`)) {
    fail(`Canonical email HTML is missing a test marker for imported block: ${type}`);
  }
}

if (!canvasSource.includes('data-ft-block-id={block.id}') || !canvasSource.includes('data-ft-block-type={block.type}')) {
  fail('Canvas blocks are missing stable visual-parity markers.');
}

for (const [name, source] of [['Canvas', canvasSource], ['email HTML generator', generatorSource]]) {
  if (!source.includes('getEmailBlockPresentation')) {
    fail(`${name} is not consuming the shared presentation contract.`);
  }
}

if (!presentationSource.includes('getEmailLayoutCellPresentation')) {
  fail('Column cells are missing a shared presentation contract.');
}

if (!generatorSource.includes('const blockHtmls =') || !generatorSource.includes('copyHtml') || !generatorSource.includes('previewHtml')) {
  fail('Preview and Copy must be emitted by the same canonical email generator.');
}

if (!generatorSource.includes(`.replace(/"/g, "'")`)) {
  fail('Email font stacks must not contain double quotes that break inline style attributes.');
}

if (!process.exitCode) {
  console.log(`[email-render-contract] OK: ${blockTypes.length} block types mapped; ${coreImportTypes.length} imported HTML block types share presentation values.`);
}

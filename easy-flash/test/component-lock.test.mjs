import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
const root = join(import.meta.dirname, '..', '..');
const lock = JSON.parse(await readFile(join(root, 'easy-flash/component-lock.json'), 'utf8'));
const sha = async p => createHash('sha256').update(await readFile(join(root, p))).digest('hex');

test('component lock freezes the known-good whole app', async () => {
  for (const [file, expected] of Object.entries(lock.frozenFiles)) assert.equal(await sha(file), expected, file);
});
test('component contract retains the complete preview surface', async () => {
  const html = await readFile(join(root, 'easy-flash/index.html'), 'utf8');
  const app = await readFile(join(root, 'easy-flash/app.mjs'), 'utf8');
  const surface = `${html}\\n${app}`;
  for (const marker of lock.requiredUiMarkers) assert.match(surface, new RegExp(marker.replace(/[.*+?^${}()|[\\]\\]/g, '\\\\$&')));
  const receipt = JSON.parse(await readFile(join(root, lock.receiptPath), 'utf8'));
  const actual = Object.fromEntries(receipt.sourceReceipt.targets.map(t => [t.targetId, t.artifacts.usb.sha256]));
  assert.deepEqual(actual, lock.targetArtifactSha256);
});
test('only Diagnose-local iteration is permitted', () => {
  assert.deepEqual(lock.allowedEditRoots, ['easy-flash/diagnose.mjs', 'easy-flash/test/diagnose*.test.mjs', 'easy-flash/test/helpers/diagnose*.mjs']);
});

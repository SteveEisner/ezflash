import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const root = new URL('..', import.meta.url);
const run = (script, args=[]) => spawnSync(process.execPath, [new URL(script, root).pathname, ...args], {encoding:'utf8'});

test('dependency lock is an immutable Steve upstream commit', async () => {
  const lock=JSON.parse(await readFile(new URL('../dependency-lock.json', import.meta.url)));
  assert.equal(lock.repository, 'https://github.com/SteveEisner/WLEDtubes.git');
  assert.match(lock.commit, /^[0-9a-f]{40}$/);
  assert.equal(lock.ref, lock.commit);
});

test('production build-static refuses checked-in firmware without a fresh receipt', () => {
  const result=run('scripts/build-static.mjs', ['--receipt', 'missing-receipt.json']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /receipt/i);
});

test('explicit fixture mode produces a provenance-bound receipt which verifies', async () => {
  const out=await mkdtemp(join(tmpdir(),'easy-flash-fixture-'));
  try {
    let result=run('scripts/build-firmware.mjs', ['--fixture','--output',out]);
    assert.equal(result.status,0,result.stderr);
    result=run('scripts/verify-build-receipt.mjs', [join(out,'build-receipt.json'),'--fixture']);
    assert.equal(result.status,0,result.stderr);
    const receipt=JSON.parse(await readFile(join(out,'build-receipt.json')));
    assert.equal(receipt.mode,'fixture');
    assert.match(receipt.source.commit,/^[0-9a-f]{40}$/);
    assert.match(receipt.contract.sha256,/^[0-9a-f]{64}$/);
    assert.match(receipt.partition.sha256,/^[0-9a-f]{64}$/);
  } finally { await rm(out,{recursive:true,force:true}); }
});

test('workflow is least privilege, immutable, builds dependency, and never deploys', async () => {
  const workflow=await readFile(new URL('../.github/workflows/build.yml', import.meta.url),'utf8');
  assert.match(workflow,/permissions:\s*\n\s+contents: read/);
  assert.doesNotMatch(workflow,/uses:\s*[^\s]+@(?![0-9a-f]{40}\b)/);
  assert.match(workflow,/build-firmware\.mjs/);
  assert.match(workflow,/upload-artifact/);
  assert.doesNotMatch(workflow,/vercel|deploy/i);
});

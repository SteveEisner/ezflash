import test from 'node:test';
import assert from 'node:assert/strict';
import {cp, mkdtemp, readFile, rm, unlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {jsonHash} from '../scripts/release-provenance.mjs';

const root = new URL('..', import.meta.url);
const run = (script, args=[]) => spawnSync(process.execPath, [new URL(script, root).pathname, ...args], {encoding:'utf8'});
const runAt = (cwd,script,args=[]) => spawnSync(process.execPath, [new URL(script,root).pathname,...args], {cwd,encoding:'utf8'});
const verifyAt = (cwd,args=[]) => runAt(cwd,'scripts/verify-release.mjs',args);

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

test('fixture firmware build is portable from an arbitrary checkout path', async () => {
  const checkout=await mkdtemp(join(tmpdir(),'easy-flash-portable-')), out=join(checkout,'receipt');
  try {
    for (const path of ['dependency-lock.json','easy-flash','scripts']) await cp(new URL(`../${path}`,import.meta.url),join(checkout,path),{recursive:true});
    const result=spawnSync(process.execPath,[join(checkout,'scripts/build-firmware.mjs'),'--fixture','--output',out],{cwd:checkout,encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    await readFile(join(out,'build-receipt.json'));
  } finally { await rm(checkout,{recursive:true,force:true}); }
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
    assert.equal(receipt.targets.length,3);
    for(const target of receipt.targets) assert.match(target.partition.sha256,/^[0-9a-f]{64}$/);
  } finally { await rm(out,{recursive:true,force:true}); }
});

test('fixture static release carries equivalent provenance and remains production-rejected', async () => {
  const temp=await mkdtemp(join(tmpdir(),'easy-flash-fixture-release-')), receiptDir=join(temp,'receipt');
  try {
    for(const path of ['dependency-lock.json','easy-flash','scripts']) await cp(new URL(`../${path}`,import.meta.url),join(temp,path),{recursive:true});
    await cp(new URL('../_headers',import.meta.url),join(temp,'_headers'));
    let result=runAt(temp,'scripts/build-firmware.mjs',['--fixture','--output',receiptDir]);
    assert.equal(result.status,0,result.stderr);
    result=runAt(temp,'scripts/build-static.mjs',['--fixture','--release','fixture-test','--receipt',join(receiptDir,'build-receipt.json')]);
    assert.equal(result.status,0,result.stderr);
    const manifest=JSON.parse(await readFile(join(temp,'dist/releases/fixture-test/manifest.json')));
    assert.equal(manifest.provenance.mode,'fixture');
    for(const kind of ['receipt','contract']) {
      assert.match(manifest.provenance.evidence[kind].sha256,/^[0-9a-f]{64}$/);
      await readFile(join(temp,'dist',manifest.provenance.evidence[kind].path));
    }
    result=verifyAt(temp,['--fixture','--dist',join(temp,'dist')]);
    assert.equal(result.status,0,result.stderr);
    result=verifyAt(temp,['--dist',join(temp,'dist')]);
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/wrong provisional evidence mode/i);
  } finally { await rm(temp,{recursive:true,force:true}); }
});

test('release verifier rejects mutated and missing public provenance evidence', async () => {
  const temp=await mkdtemp(join(tmpdir(),'easy-flash-release-evidence-'));
  try {
    await cp(new URL('../private-candidates/pr70-f0ccd8b2/site',import.meta.url),join(temp,'dist'),{recursive:true});
    const current=JSON.parse(await readFile(join(temp,'dist/current.json')));
    const manifestPath=join(temp,'dist',current.manifest), manifest=JSON.parse(await readFile(manifestPath));
    const receiptPath=join(temp,'dist',manifest.provenance.evidence.receipt.path);
    await writeFile(receiptPath,Buffer.concat([await readFile(receiptPath),Buffer.from('\n')]));
    let result=verifyAt(temp,['--dist',join(temp,'dist')]);
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/receipt provenance evidence mismatch/i);
    await rm(join(temp,'dist'),{recursive:true,force:true});await cp(new URL('../private-candidates/pr70-f0ccd8b2/site',import.meta.url),join(temp,'dist'),{recursive:true});
    const freshManifest=JSON.parse(await readFile(manifestPath));
    await unlink(join(temp,'dist',freshManifest.provenance.evidence.contract.path));
    result=verifyAt(temp,['--dist',join(temp,'dist')]);
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/ENOENT|contract/i);
  } finally { await rm(temp,{recursive:true,force:true}); }
});

test('release verifier rejects provenance path traversal before reading evidence', async () => {
  const temp=await mkdtemp(join(tmpdir(),'easy-flash-release-traversal-'));
  try {
    await cp(new URL('../private-candidates/pr70-f0ccd8b2/site',import.meta.url),join(temp,'dist'),{recursive:true});
    const current=JSON.parse(await readFile(join(temp,'dist/current.json'))), manifestPath=join(temp,'dist',current.manifest);
    const manifest=JSON.parse(await readFile(manifestPath));
    manifest.provenance.evidence.receipt.path=`releases/${current.releaseId}/provenance/../../manifest.json`;
    await writeFile(manifestPath,JSON.stringify(manifest));
    const result=verifyAt(temp,['--dist',join(temp,'dist')]);
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/safe immutable relative path|outside immutable release/i);
  } finally { await rm(temp,{recursive:true,force:true}); }
});

test('release verifier rejects self-consistent but unbound public receipt claims', async () => {
  const temp=await mkdtemp(join(tmpdir(),'easy-flash-release-binding-'));
  try {
    await cp(new URL('../private-candidates/pr70-f0ccd8b2/site',import.meta.url),join(temp,'dist'),{recursive:true});
    const current=JSON.parse(await readFile(join(temp,'dist/current.json'))),manifestPath=join(temp,'dist',current.manifest);
    const manifest=JSON.parse(await readFile(manifestPath)),receiptPath=join(temp,'dist',manifest.provenance.evidence.receipt.path);
    const publicReceipt=JSON.parse(await readFile(receiptPath));
    publicReceipt.sourceReceipt.targets[0].environment='unrelated_environment';
    publicReceipt.sourceReceipt.receiptSha256='0'.repeat(64);
    const bytes=Buffer.from(JSON.stringify(publicReceipt,null,2)+'\n');
    await writeFile(receiptPath,bytes);
    manifest.provenance.evidence.receipt.sha256=createHash('sha256').update(bytes).digest('hex');
    await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
    const result=verifyAt(temp,['--dist',join(temp,'dist')]);
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/receipt.*digest|target.*binding|environment/i);
  } finally { await rm(temp,{recursive:true,force:true}); }
});

test('release verifier rejects manifest boot identity not bound to the immutable receipt', async () => {
  const temp=await mkdtemp(join(tmpdir(),'easy-flash-boot-identity-'));
  try {
    await cp(new URL('../private-candidates/pr70-f0ccd8b2/site',import.meta.url),join(temp,'dist'),{recursive:true});
    const current=JSON.parse(await readFile(join(temp,'dist/current.json'))),manifestPath=join(temp,'dist',current.manifest);
    const manifest=JSON.parse(await readFile(manifestPath));
    manifest.variants[0].bootIdentity.source='0'.repeat(40);
    await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
    const result=verifyAt(temp,['--dist',join(temp,'dist')]);
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/boot identity.*binding/i);
  } finally { await rm(temp,{recursive:true,force:true}); }
});

test('release verifier rejects a rehashed receipt from dirty or unrelated source authority', async () => {
  const temp=await mkdtemp(join(tmpdir(),'easy-flash-release-authority-'));
  try {
    await cp(new URL('../private-candidates/pr70-f0ccd8b2/site',import.meta.url),join(temp,'dist'),{recursive:true});
    const current=JSON.parse(await readFile(join(temp,'dist/current.json'))),manifestPath=join(temp,'dist',current.manifest);
    const manifest=JSON.parse(await readFile(manifestPath)),receiptPath=join(temp,'dist',manifest.provenance.evidence.receipt.path);
    const publicReceipt=JSON.parse(await readFile(receiptPath));
    publicReceipt.sourceReceipt.source.repository='https://example.invalid/unrelated.git';
    publicReceipt.sourceReceipt.source.clean=false;
    publicReceipt.sourceReceipt.mode='fixture';
    publicReceipt.sourceReceiptDigestSha256=jsonHash(publicReceipt.sourceReceipt);
    const {receiptDigestSha256:discarded,...unsigned}=publicReceipt;
    publicReceipt.receiptDigestSha256=jsonHash(unsigned);
    const bytes=Buffer.from(JSON.stringify(publicReceipt,null,2)+'\n');
    await writeFile(receiptPath,bytes);
    manifest.provenance.sourceReceiptDigestSha256=publicReceipt.sourceReceiptDigestSha256;
    manifest.provenance.receiptDigestSha256=publicReceipt.receiptDigestSha256;
    manifest.provenance.evidence.receipt.sha256=createHash('sha256').update(bytes).digest('hex');
    await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
    const result=verifyAt(temp,['--dist',join(temp,'dist')]);
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/mode|repository|clean|source authority/i);
  } finally { await rm(temp,{recursive:true,force:true}); }
});

test('release verifier rejects artifact paths outside the exact immutable release firmware prefix', async () => {
  const temp=await mkdtemp(join(tmpdir(),'easy-flash-release-artifact-path-'));
  try {
    await cp(new URL('../private-candidates/pr70-f0ccd8b2/site',import.meta.url),join(temp,'dist'),{recursive:true});
    const current=JSON.parse(await readFile(join(temp,'dist/current.json'))),manifestPath=join(temp,'dist',current.manifest);
    const manifest=JSON.parse(await readFile(manifestPath)),prefix=`releases/${current.releaseId}/`;
    manifest.variants[0].artifacts[0].path=`${'x'.repeat(prefix.length)}firmware/quinled-dig2go-merged.bin`;
    await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
    const result=verifyAt(temp,['--dist',join(temp,'dist')]);
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/artifact.*immutable release|artifact.*path/i);
  } finally { await rm(temp,{recursive:true,force:true}); }
});

test('workflow is least privilege, immutable, builds dependency, and never deploys', async () => {
  const workflow=await readFile(new URL('../.github/workflows/build.yml', import.meta.url),'utf8');
  assert.match(workflow,/permissions:\s*\n\s+contents: read/);
  assert.doesNotMatch(workflow,/uses:\s*[^\s]+@(?![0-9a-f]{40}\b)/);
  assert.match(workflow,/build-firmware\.mjs/);
  assert.match(workflow,/EASY_FLASH_RELEASE:\s*candidate-8e4e035b/);
  assert.match(workflow,/git diff --exit-code -- \. '\:\(exclude\)dist'/);
  assert.match(workflow,/upload-artifact/);
  assert.doesNotMatch(workflow,/vercel|deploy/i);
});

test('Vercel serves the tracked dist without a firmware-receipt build', async () => {
  const config=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url)));
  assert.equal(config.outputDirectory,'dist');
  assert.ok(!('buildCommand' in config) || config.buildCommand === null || config.buildCommand === '');
  assert.ok(config.headers.some(({source,headers})=>source==='/current.json'&&headers.some(({key,value})=>key==='Cache-Control'&&/no-cache/.test(value))));
  assert.ok(config.headers.some(({source,headers})=>source==='/releases/(.*)'&&headers.some(({key,value})=>key==='Cache-Control'&&/immutable/.test(value))));
});

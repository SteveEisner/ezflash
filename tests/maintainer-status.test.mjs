import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const html=()=>readFile('dist/index.html','utf8');
const script=()=>readFile('dist/maintainer/status.mjs','utf8');

test('status is the second accessible tab and read-only',async()=>{const [h,s]=await Promise.all([html(),script()]);assert.match(h,/role="tab"[^>]*>Flash/);assert.match(h,/role="tab"[^>]*>Status/);assert.match(h,/status\.mjs/);assert.match(h,/id="flashView"[^>]*>/);assert.match(h,/id="statusView"[^>]*hidden/);assert.match(s,/current\.json/);assert.match(s,/manifest\.json/);assert.match(s,/provenance.*receipt|receipt.*provenance/);assert.doesNotMatch(s,/innerHTML|fetch\([^)]*https?:/)});
test('status labels snapshot, build and deployment independently',async()=>{const s=await script();assert.match(s,/Snapshot generated/);assert.match(s,/Build time/);assert.match(s,/Deployment time/);assert.match(s,/Not provided/)});
test('status source and generated modules parse as executable JavaScript',async()=>{const {spawnSync}=await import('node:child_process');for(const file of ['easy-flash/maintainer/status.mjs','dist/maintainer/status.mjs']){const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});assert.equal(result.status,0,`${file}: ${result.stderr}`)}});
test('status rejects unsafe immutable-release evidence paths',async()=>{const s=await script();const result=await import('../easy-flash/maintainer/status.mjs?path-test');const good='releases/abc123/provenance/build-receipt.json';assert.equal(result.validateReleaseRelativePath(good,{releaseId:'abc123',kind:'receipt'}),good);for(const bad of ['/releases/abc123/provenance/x','https://evil.test/x','releases/abc123/../x','releases/abc123/provenance/%2e%2e/x','releases/abc123/provenance/x?next=1','releases/abc123\\provenance\\x','releases/other/provenance/x'])assert.throws(()=>result.validateReleaseRelativePath(bad,{releaseId:'abc123',kind:'receipt'}));});
test('flash remains default and status has no controls',async()=>{const h=await html();assert.match(h,/id="flashTab"[^>]*aria-selected="true"/);assert.doesNotMatch(h.match(/id="statusView"[\s\S]*?<\/section>/)?.[0]||'',/button[^>]*>Install|serial/i)});

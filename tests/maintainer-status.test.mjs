import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const html=()=>readFile('dist/index.html','utf8');
const script=()=>readFile('dist/maintainer/status.mjs','utf8');

test('status is the second accessible tab and read-only',async()=>{const [h,s]=await Promise.all([html(),script()]);assert.match(h,/role="tab"[^>]*>Flash/);assert.match(h,/role="tab"[^>]*>Status/);assert.match(h,/status\.mjs/);assert.match(h,/id="flashView"[^>]*>/);assert.match(h,/id="statusView"[^>]*hidden/);assert.match(s,/current\.json/);assert.match(s,/manifest\.json/);assert.match(s,/build-receipt\.json/);assert.doesNotMatch(s,/innerHTML|fetch\([^)]*https?:/)});
test('status labels snapshot, build and deployment independently',async()=>{const s=await script();assert.match(s,/Snapshot generated/);assert.match(s,/Build time/);assert.match(s,/Deployment time/);assert.match(s,/Not provided/)});
test('flash remains default and status has no controls',async()=>{const h=await html();assert.match(h,/id="flashTab"[^>]*aria-selected="true"/);assert.doesNotMatch(h.match(/id="statusView"[\s\S]*?<\/section>/)?.[0]||'',/button[^>]*>Install|serial/i)});

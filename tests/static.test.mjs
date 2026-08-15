import test from 'node:test'; import assert from 'node:assert/strict'; import {readFile} from 'node:fs/promises';
test('browser graph has no node imports',async()=>{for(const f of ['app.mjs','local-flash.mjs','profiles.mjs','firmware-ui.mjs','device-identity.mjs','safety-contract.mjs'])assert.doesNotMatch(await readFile(`easy-flash/${f}`,'utf8'),/node:/)});
test('static build complete',async()=>{for(const f of ['dist/index.html','dist/current.json','dist/_headers'])await readFile(f)});
test('support guidance exists',async()=>assert.match(await readFile('easy-flash/index.html','utf8'),/Chrome|Edge|serial/i));

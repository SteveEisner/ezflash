#!/usr/bin/env node
import {readFile,writeFile,cp,mkdir} from 'node:fs/promises';
import {jsonHash} from './release-provenance.mjs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const args=process.argv.slice(2), val=n=>{const i=args.indexOf(n);return i<0?undefined:args[i+1]};
const root=resolve(val('--root')||'build/v15-preview-firmware'), c3=resolve(val('--c3')||'../WLEDTubes-c3-athom-pin-fix/.pio/build/esp32-c3-athom_tubes/firmware.bin');
const sha=b=>createHash('sha256').update(b).digest('hex');
const receipt=JSON.parse(await readFile(join(root,'build-receipt.json'))); const expected='019e19d8b2d8ef2b9ce17e54cf04e89633daab61be5f276d3459b99a479d78cb'; const app=await readFile(c3);
if(app.length!==1217120||sha(app)!==expected) throw Error('corrected C3 artifact does not match accepted size/SHA');
const t=receipt.targets.find(x=>x.targetId==='athom-c3-tubes'); if(!t) throw Error('C3 target missing');
const old=await readFile(join(root,t.artifacts.usb.path)); const merged=Buffer.alloc(Math.max(old.length,0x10000+app.length),0xff); old.copy(merged); app.copy(merged,0x10000); const out=join(root,t.artifacts.usb.path); await writeFile(out,merged); await writeFile(join(root,t.artifacts.ota.path),app);
const components=t.artifacts.usb.components.map(c=>c.id==='application'?{...c,lengthBytes:app.length,sha256:expected}:c); const evidence={path:t.artifacts.usb.path,lengthBytes:merged.length,sha256:sha(merged),kind:'complete-merged-image',transport:'usb',writeOffset:0,components}; t.artifacts.usb=evidence; t.artifacts.ota={...t.artifacts.ota,lengthBytes:app.length,sha256:expected}; t.bootIdentity={...t.bootIdentity,source:'f1e48710c51e2fed3255a12d52e5605a8c863f63',fixCommit:'152e6c75',physicalAcceptance:{accepted:true,installedReadbackSha256:expected,note:'Greg physically accepted LEDs; lifecycle readback matched artifact'}};
receipt.source={...receipt.source,commit:'f1e48710c51e2fed3255a12d52e5605a8c863f63',clean:true}; receipt.provenanceNote='Preview v15 · PR #71; C3 includes local pin-inheritance/lifecycle correction pending upstream.'; delete receipt.receiptSha256; receipt.receiptSha256=jsonHash(receipt); await writeFile(join(root,'build-receipt.json'),JSON.stringify(receipt,null,2)+'\n'); console.log(JSON.stringify({c3ApplicationSha256:expected,c3MergedSha256:evidence.sha256,c3MergedSize:merged.length},null,2));

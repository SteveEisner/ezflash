#!/usr/bin/env node
import {cp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join,basename} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileEvidence,jsonHash,sha256} from './release-provenance.mjs';

const args=process.argv.slice(2), fixture=args.includes('--fixture');
const value=name=>{const i=args.indexOf(name); return i<0?undefined:args[i+1]};
const out=resolve(value('--output')||'build/easy-flash-firmware'), root=resolve('..'), lock=JSON.parse(await readFile(resolve(root,'WLEDTubes-Easy-Flash/dependency-lock.json'),'utf8'));
const source=resolve(value('--source')||join(root,'WLEDTubes'));
const run=(cmd,a,cwd=source)=>{const r=spawnSync(cmd,a,{cwd,stdio:'inherit'});if(r.status!==0)throw Error(`${cmd} failed (${r.status})`)};
await mkdir(out,{recursive:true});
let contractPath, partitionPath, usbPath, otaPath, clean=true, builtComponents;
if(fixture) {
  const easy=resolve(root,'WLEDTubes-Easy-Flash/easy-flash');
  const manifest=JSON.parse(await readFile(join(easy,'firmware-manifest.json'))), variant=manifest.variants[0], merged=variant.artifacts.find(a=>a.transport==='usb');
  contractPath=join(out,'fixture-update-contract.json'); partitionPath=join(out,'fixture-partition-evidence.json');
  await writeFile(contractPath,JSON.stringify({schemaVersion:1,targets:[{id:'quinled-dig2go',partition:{csvPath:'fixture-partition-evidence.json',otaSlots:[variant.partition.otaSlot]}}],artifacts:[{targetId:'quinled-dig2go',kind:'complete-merged-image',transport:'usb',components:merged.components.map(c=>({id:c.name,offset:c.offset,lengthBytes:c.sizeBytes}))}]}));
  await writeFile(partitionPath,JSON.stringify(variant.partition));
  usbPath=join(easy,'artifacts/previous-stable-control/usb/merged.bin'); otaPath=join(easy,'artifacts/previous-stable-control/ota/firmware.bin');
} else {
  const commit=spawnSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).stdout.trim(); if(commit!==lock.commit) throw Error(`dependency checkout ${commit} does not match lock ${lock.commit}`);
  clean=spawnSync('git',['status','--porcelain'],{cwd:source,encoding:'utf8'}).stdout.trim()===''; if(!clean) throw Error('dependency checkout is dirty');
  run('npm',['ci']); run('npm',['run','build']); run('node',['tools/update-contract/validate.mjs']); run('node',['tools/update-contract/generate.mjs','--check']); run('pio',['run','-e',lock.environment]);
  clean=spawnSync('git',['status','--porcelain'],{cwd:source,encoding:'utf8'}).stdout.trim()===''; if(!clean) throw Error('dependency build modified tracked source');
  contractPath=join(source,'contracts/update/update-contract.json');
  const contract=JSON.parse(await readFile(contractPath)), target=contract.targets.find(x=>x.id==='quinled-dig2go'); partitionPath=join(source,target.partition.csvPath);
  const build=join(source,'.pio/build',lock.environment), pkg=join(source,'.pio/libdeps',lock.environment);
  otaPath=join(build,'firmware.bin');
  const usb=contract.artifacts.find(x=>x.targetId===target.id&&x.kind==='complete-merged-image'&&x.transport==='usb');
  const sourceById={bootloader:join(build,'bootloader.bin'),partitions:join(build,'partitions.bin'),application:otaPath};
  const bootAppCandidates=[join(process.env.HOME||'', '.platformio/packages/framework-arduinoespressif32/tools/partitions/boot_app0.bin'),join(pkg,'framework-arduinoespressif32/tools/partitions/boot_app0.bin')];
  sourceById['boot-app0']=bootAppCandidates.find(p=>spawnSync('test',['-f',p]).status===0); if(!sourceById['boot-app0']) throw Error('authoritative framework boot_app0.bin not found');
  builtComponents=sourceById;
  usbPath=join(out,'merged.bin');
  const pioPath=spawnSync('sh',['-c','command -v pio'],{encoding:'utf8'}).stdout.trim(), shebang=(await readFile(pioPath,'utf8')).split('\n')[0];
  if(!shebang.startsWith('#!')) throw Error('PlatformIO Python interpreter is unavailable');
  const pioCore=process.env.PLATFORMIO_CORE_DIR||join(process.env.HOME,'.platformio'), esptool=join(pioCore,'packages/tool-esptoolpy/esptool.py');
  run(shebang.slice(2),[esptool,'--chip','esp32','merge_bin','-o',usbPath,...usb.components.flatMap(c=>[`0x${c.offset.toString(16)}`,sourceById[c.id]])]);
}
for(const [src,name] of [[contractPath,'update-contract.json'],[partitionPath,basename(partitionPath)],[usbPath,'merged.bin'],[otaPath,'firmware.bin']]) if(resolve(src)!==resolve(out,name)) await cp(src,join(out,name));
const contract=JSON.parse(await readFile(join(out,'update-contract.json'))), target=contract.targets.find(x=>x.id==='quinled-dig2go'), canonicalUsb=contract.artifacts.find(x=>x.targetId===target.id&&x.kind==='complete-merged-image'&&x.transport==='usb');
const evidence=async(name)=>{const e=await fileEvidence(join(out,name));return {...e,path:name}};
const usb=await evidence('merged.bin'), ota=await evidence('firmware.bin'), contractEvidence=await evidence('update-contract.json'), partition=await evidence(basename(partitionPath));
usb.kind='complete-merged-image';usb.transport='usb';usb.writeOffset=0;usb.components=[];
const bytes=await readFile(join(out,'merged.bin'));
for(const c of canonicalUsb.components) { const lengthBytes=builtComponents?(await readFile(builtComponents[c.id])).length:c.lengthBytes; const slice=bytes.subarray(c.offset,c.offset+lengthBytes); usb.components.push({id:c.id,offset:c.offset,lengthBytes,sha256:sha256(slice)}); }
ota.kind='application-image';ota.transport='ota';ota.buildOffset=target.partition.otaSlots[0].offset;
const receipt={schemaVersion:1,mode:fixture?'fixture':'production',source:{repository:lock.repository,commit:lock.commit,clean},environment:lock.environment,contract:contractEvidence,partition:{...partition,csvPath:target.partition.csvPath},artifacts:{usb,ota}};
receipt.receiptSha256=jsonHash(receipt); await writeFile(join(out,'build-receipt.json'),JSON.stringify(receipt,null,2)+'\n'); console.log(join(out,'build-receipt.json'));

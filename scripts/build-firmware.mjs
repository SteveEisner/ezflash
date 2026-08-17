#!/usr/bin/env node
import {cp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {basename,dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {fileEvidence,jsonHash,sha256} from './release-provenance.mjs';
import {pinnedEsptoolChip} from './pinned-esptool-chip.mjs';

const args=process.argv.slice(2),fixture=args.includes('--fixture'),value=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1]};
const root=fileURLToPath(new URL('..',import.meta.url)),lock=JSON.parse(await readFile(join(root,'dependency-lock.json'),'utf8')),source=resolve(value('--source')||join(resolve(root,'..'),'WLEDTubes')),out=resolve(value('--output')||'build/easy-flash-firmware');
const run=(cmd,a,cwd=source)=>{const result=spawnSync(cmd,a,{cwd,stdio:'inherit'});if(result.status!==0)throw Error(`${cmd} failed (${result.status})`);};
const evidence=async path=>{const item=await fileEvidence(path);return {path:basename(path),lengthBytes:item.lengthBytes,sha256:item.sha256};};
await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});

let contract,clean=true;
if(fixture){
	contract={schemaVersion:1,targets:lock.targets.map((item,index)=>({id:item.targetId,hardwareFamily:item.targetId,chipFamily:['ESP32','ESP32-C3','ESP32-S3'][index],board:item.printedModel,flashMode:index===2?'qio':'dio',flashSizeBytes:index===2?16777216:4194304,compiledProfile:{environment:item.environment},partition:{csvPath:`${item.targetId}.csv`,sha256:'0'.repeat(64),otaSlots:[{offset:65536,sizeBytes:index===2?6291456:1572864}]}})),artifacts:[]};
}else{
	const commit=spawnSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).stdout.trim();if(commit!==lock.commit)throw Error(`dependency checkout ${commit} does not match lock ${lock.commit}`);clean=spawnSync('git',['status','--porcelain'],{cwd:source,encoding:'utf8'}).stdout.trim()==='';if(!clean)throw Error('dependency checkout is dirty');
	run('npm',['ci']);run('npm',['run','build']);run('node',['tools/update-contract/validate.mjs']);run('node',['tools/update-contract/generate.mjs','--check']);contract=JSON.parse(await readFile(join(source,'contracts/update/update-contract.json')));
}
await writeFile(join(out,'update-contract.json'),JSON.stringify(contract,null,2)+'\n');
const contractEvidence=await evidence(join(out,'update-contract.json')),targets=[];
for(const locked of lock.targets){
	const target=contract.targets.find(item=>item.id===locked.targetId);if(!target)throw Error(`canonical target missing: ${locked.targetId}`);const expectedEnvironment=target.compiledProfile?.environment||'esp32_quinled_dig2go_tubes';if(expectedEnvironment!==locked.environment)throw Error(`environment mismatch for ${target.id}`);
	const targetOut=join(out,'targets',target.id);await mkdir(targetOut,{recursive:true});let usbPath=join(targetOut,'merged.bin'),otaPath=join(targetOut,'firmware.bin'),partitionPath=join(targetOut,basename(target.partition.csvPath)),components;
	if(fixture){
		const definitions=[['bootloader',target.chipFamily==='ESP32'?4096:1,64],['partitions',32768,64],['boot-app0',57344,64],['application',65536,256]],length=definitions.at(-1)[1]+definitions.at(-1)[2],bytes=Buffer.alloc(length);
		definitions.forEach(([id,offset,size],index)=>bytes.fill(index+1,offset,offset+size));await writeFile(usbPath,bytes);await writeFile(otaPath,bytes.subarray(65536));await writeFile(partitionPath,'# Name, Type, SubType, Offset, Size, Flags\nota_0,app,ota_0,0x10000,0x180000,\n');components=definitions.map(([id,offset,lengthBytes])=>({id,offset,lengthBytes,sha256:sha256(bytes.subarray(offset,offset+lengthBytes))}));
	}else{
		run('pio',['run','-e',locked.environment]);const build=join(source,'.pio/build',locked.environment),canonical=contract.artifacts.find(a=>a.targetId===target.id&&a.kind==='complete-merged-image'&&a.transport==='usb');if(!canonical)throw Error(`USB contract missing for ${target.id}`);
		const sourceById={bootloader:join(build,'bootloader.bin'),partitions:join(build,'partitions.bin'),application:join(build,'firmware.bin')};const pioCore=process.env.PLATFORMIO_CORE_DIR||join(process.env.HOME,'.platformio');sourceById['boot-app0']=join(pioCore,'packages/framework-arduinoespressif32/tools/partitions/boot_app0.bin');
		const pioPath=spawnSync('sh',['-c','command -v pio'],{encoding:'utf8'}).stdout.trim(),shebang=(await readFile(pioPath,'utf8')).split('\n')[0];if(!shebang.startsWith('#!'))throw Error('PlatformIO Python interpreter unavailable');const esptool=join(pioCore,'packages/tool-esptoolpy/esptool.py');
		// Preserve the contract identity above; only adapt it at the pinned build-tool boundary.
		const esptoolChip=pinnedEsptoolChip(target.chipFamily);
		run(shebang.slice(2),[esptool,'--chip',esptoolChip,'merge_bin','-o',usbPath,...canonical.components.flatMap(c=>[`0x${c.offset.toString(16)}`,sourceById[c.id]])]);await cp(sourceById.application,otaPath);await cp(join(source,target.partition.csvPath),partitionPath);
		const merged=await readFile(usbPath);components=[];for(const component of canonical.components){const bytes=await readFile(sourceById[component.id]);components.push({id:component.id,offset:component.offset,lengthBytes:bytes.length,sha256:sha256(merged.subarray(component.offset,component.offset+bytes.length))});}
	}
	const usb={...(await evidence(usbPath)),path:`targets/${target.id}/merged.bin`,kind:'complete-merged-image',transport:'usb',writeOffset:0,components};const ota={...(await evidence(otaPath)),path:`targets/${target.id}/firmware.bin`,kind:'application-image',transport:'ota',buildOffset:target.partition.otaSlots[0].offset};const partition={...(await evidence(partitionPath)),path:`targets/${target.id}/${basename(partitionPath)}`,csvPath:target.partition.csvPath};targets.push({targetId:target.id,environment:locked.environment,printedModel:locked.printedModel,contractTarget:target,partition,artifacts:{usb,ota}});
}
if(!fixture){clean=spawnSync('git',['status','--porcelain'],{cwd:source,encoding:'utf8'}).stdout.trim()==='';if(!clean)throw Error('dependency build modified tracked source');}
const receipt={schemaVersion:2,mode:fixture?'fixture':'provisional',source:{repository:lock.repository,commit:lock.commit,clean},contract:{...contractEvidence,path:'update-contract.json'},targets};receipt.receiptSha256=jsonHash(receipt);await writeFile(join(out,'build-receipt.json'),JSON.stringify(receipt,null,2)+'\n');console.log(join(out,'build-receipt.json'));

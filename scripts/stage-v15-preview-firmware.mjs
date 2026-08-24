#!/usr/bin/env node
import {spawnSync} from "node:child_process";
import {cp,mkdir,readFile,rm,writeFile} from "node:fs/promises";
import {basename,join,resolve} from "node:path";
import {fileEvidence,jsonHash,sha256} from "./release-provenance.mjs";
import {pinnedEsptoolChip} from "./pinned-esptool-chip.mjs";
import {V15_PREVIEW} from "./v15-preview-contract.mjs";
const args=process.argv.slice(2),value=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1]},source=resolve(value("--source")||"../WLEDTubes-v15-preview-build"),out=resolve(value("--output")||"build/v15-preview-firmware");
const git=(...items)=>{const result=spawnSync("git",items,{cwd:source,encoding:"utf8"});if(result.status!==0)throw Error(result.stderr);return result.stdout.trim();};
if(git("rev-parse","HEAD")!==V15_PREVIEW.sourceCommit||git("rev-parse","HEAD^{tree}")!==V15_PREVIEW.sourceTree)throw Error("source is not the exact reviewed PR71 commit/tree");
if(git("status","--porcelain"))throw Error("preview source worktree must be clean");
const run=(cmd,items)=>{const result=spawnSync(cmd,items,{cwd:source,stdio:"inherit"});if(result.status!==0)throw Error(`${cmd} failed (${result.status})`);};
const targetDefinitions={
  "quinled-dig2go":{chipFamily:"ESP32",board:"QuinLED Dig2Go",flashMode:"dio",flashSizeBytes:4194304,csvPath:"tools/WLED_ESP32_4MB_1MB_FS.csv",bootloaderOffset:4096,releaseIdentity:"DIG2GO_TUBES"},
  "athom-c3-tubes":{chipFamily:"ESP32-C3",board:"esp32-c3-devkitm-1",flashMode:"dio",flashSizeBytes:4194304,csvPath:"tools/WLED_ESP32_4MB_1MB_FS.csv",bootloaderOffset:0,releaseIdentity:"ESP32-C3_ATHOM_TUBES"},
  "waveshare-s3-tubes-remote":{chipFamily:"ESP32-S3",board:"esp32-s3-devkitc-1",flashMode:"keep",flashSizeBytes:16777216,csvPath:"tools/WLED_ESP32S3_WAVESHARE_16MB.csv",bootloaderOffset:0,releaseIdentity:"WAVESHARE_S3_TUBES_REMOTE"}
};
const contract={schemaVersion:1,targets:[],artifacts:[]};
for(const expected of V15_PREVIEW.targets){const definition=targetDefinitions[expected.id],csvBytes=await readFile(join(source,definition.csvPath)),large=definition.flashSizeBytes>4194304,partition={csvPath:definition.csvPath,sha256:sha256(csvBytes),otaSlots:large?[{id:"ota_0",offset:65536,sizeBytes:6291456},{id:"ota_1",offset:6356992,sizeBytes:6291456}]:[{id:"ota_0",offset:65536,sizeBytes:1572864},{id:"ota_1",offset:1638400,sizeBytes:1572864}]};contract.targets.push({id:expected.id,hardwareFamily:expected.id,chipFamily:definition.chipFamily,board:definition.board,flashMode:definition.flashMode,flashSizeBytes:definition.flashSizeBytes,compiledProfile:{environment:expected.environment,releaseIdentity:definition.releaseIdentity},partition});const common={targetId:expected.id,releaseClass:"Preview",tubesRelease:"15",wledBaseVersion:"16.0.1",releaseIdentity:definition.releaseIdentity,buildCommit:V15_PREVIEW.sourceCommit};contract.artifacts.push({...common,id:`${expected.id}-v15-usb-merged`,kind:"complete-merged-image",transport:"usb",writeOffset:0,components:[{id:"bootloader",offset:definition.bootloaderOffset},{id:"partitions",offset:32768},{id:"boot-app0",offset:57344},{id:"application",offset:65536}]},{...common,id:`${expected.id}-v15-ota-application`,kind:"application-image",transport:"ota",buildOffset:65536});}
await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});await writeFile(join(out,"update-contract.json"),JSON.stringify(contract,null,2)+"\n");
const evidence=async(path,relative)=>{const item=await fileEvidence(path);return {path:relative,lengthBytes:item.lengthBytes,sha256:item.sha256};},targets=[];
const printed={"quinled-dig2go":"QuinLED Dig2Go","athom-c3-tubes":"Athom ESP32-C3 controller","waveshare-s3-tubes-remote":"Waveshare ESP32-S3-Touch-AMOLED-2.16"};
for(const expected of V15_PREVIEW.targets){
  const target=contract.targets.find(item=>item.id===expected.id);if(!target||target.compiledProfile?.environment!==expected.environment)throw Error(`canonical target/environment mismatch: ${expected.id}`);
  const canonical=contract.artifacts.find(item=>item.targetId===expected.id&&item.kind==="complete-merged-image"&&item.transport==="usb"),application=contract.artifacts.find(item=>item.targetId===expected.id&&item.kind==="application-image"&&item.transport==="ota");if(!canonical||!application)throw Error(`canonical artifacts missing: ${expected.id}`);
  const build=join(source,".pio/build",expected.environment),targetOut=join(out,"targets",expected.id);await mkdir(targetOut,{recursive:true});
  const sources={bootloader:join(build,"bootloader.bin"),partitions:join(build,"partitions.bin"),application:join(build,"firmware.bin")},pioCore=process.env.PLATFORMIO_CORE_DIR||join(process.env.HOME,".platformio");sources["boot-app0"]=join(pioCore,"packages/framework-arduinoespressif32/tools/partitions/boot_app0.bin");
  const pio=spawnSync("sh",["-c","command -v pio"],{encoding:"utf8"}).stdout.trim(),shebang=(await readFile(pio,"utf8")).toString().split("\n")[0],mergedPath=join(targetOut,"merged.bin");if(!shebang.startsWith("#!"))throw Error("PlatformIO Python interpreter unavailable");
  run(shebang.slice(2),[join(pioCore,"packages/tool-esptoolpy/esptool.py"),"--chip",pinnedEsptoolChip(target.chipFamily),"merge_bin","-o",mergedPath,...canonical.components.flatMap(component=>[`0x${component.offset.toString(16)}`,sources[component.id]])]);
  await cp(sources.application,join(targetOut,"firmware.bin"));await cp(join(source,target.partition.csvPath),join(targetOut,basename(target.partition.csvPath)));
  const merged=await readFile(mergedPath),components=[];for(const component of canonical.components){const bytes=await readFile(sources[component.id]);components.push({id:component.id,offset:component.offset,lengthBytes:bytes.length,sha256:sha256(merged.subarray(component.offset,component.offset+bytes.length))});}
  const usb={...(await evidence(mergedPath,`targets/${expected.id}/merged.bin`)),kind:"complete-merged-image",transport:"usb",writeOffset:0,components},ota={...(await evidence(join(targetOut,"firmware.bin"),`targets/${expected.id}/firmware.bin`)),kind:"application-image",transport:"ota",buildOffset:target.partition.otaSlots[0].offset},partition={...(await evidence(join(targetOut,basename(target.partition.csvPath)),`targets/${expected.id}/${basename(target.partition.csvPath)}`)),csvPath:target.partition.csvPath};
  targets.push({targetId:expected.id,environment:expected.environment,printedModel:printed[expected.id],bootIdentity:{version:1,target:expected.id,source:V15_PREVIEW.sourceCommit,release:application.wledBaseVersion,tubes:Number(application.tubesRelease)},contractTarget:target,partition,artifacts:{usb,ota}});
}
if(git("status","--porcelain"))throw Error("preview staging modified the source worktree");
const contractEvidence=await evidence(join(out,"update-contract.json"),"update-contract.json"),receipt={schemaVersion:2,mode:"provisional",source:{repository:"https://github.com/SteveEisner/WLEDtubes.git",commit:V15_PREVIEW.sourceCommit,clean:true},contract:contractEvidence,targets};receipt.receiptSha256=jsonHash(receipt);await writeFile(join(out,"build-receipt.json"),JSON.stringify(receipt,null,2)+"\n");console.log(join(out,"build-receipt.json"));

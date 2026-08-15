#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {containedFile, fileEvidence, jsonHash, requireHash, safeRelative} from './release-provenance.mjs';

const dist=resolve('dist');
const current=JSON.parse(await readFile(resolve(dist,'current.json'),'utf8'));
if(!/^[a-z0-9][a-z0-9._-]*$/i.test(current.releaseId||'')) throw Error('mutable/invalid release id');
const releasePrefix=`releases/${current.releaseId}/`;
const expected=`${releasePrefix}manifest.json`;
if(current.manifest!==expected) throw Error('current manifest pointer is not immutable');
safeRelative(current.manifest,'manifest pointer');
const releaseDir=resolve(dist,'releases',current.releaseId);
const releaseFile=async(path,label,prefix=releasePrefix)=>{
  safeRelative(path,label);
  if(!path.startsWith(prefix)) throw Error(`${label} is mutable or outside immutable release`);
  return containedFile(releaseDir,path.slice(releasePrefix.length),label);
};

const manifest=JSON.parse(await readFile(await releaseFile(current.manifest,'manifest pointer'),'utf8'));
if(manifest.provenance?.mode!=='production'&&!process.argv.includes('--fixture')) throw Error('non-production release provenance rejected');
for(const key of ['receiptDigestSha256','sourceReceiptDigestSha256','contractSha256','partitionSha256']) requireHash(manifest.provenance?.[key],key);

const evidence={};
for(const kind of ['receipt','contract','partition']) {
  const claimed=manifest.provenance?.evidence?.[kind];
  if(!claimed) throw Error(`missing ${kind} provenance evidence`);
  requireHash(claimed.sha256,`${kind} evidence hash`);
  const path=await releaseFile(claimed.path,`${kind} evidence path`,`${releasePrefix}provenance/`);
  const actual=await fileEvidence(path);
  if(actual.sha256!==claimed.sha256) throw Error(`${kind} provenance evidence mismatch`);
  evidence[kind]={...claimed,path,bytes:await readFile(path)};
}

let receipt, contract;
try { receipt=JSON.parse(evidence.receipt.bytes); } catch { throw Error('build receipt evidence is not valid JSON'); }
try { contract=JSON.parse(evidence.contract.bytes); } catch { throw Error('update contract evidence is not valid JSON'); }
const partitionText=evidence.partition.bytes.toString('utf8');
if(receipt.mode==='fixture') { try { JSON.parse(partitionText); } catch { throw Error('fixture partition evidence is not valid JSON'); } }
else if(!/^\s*#\s*Name\s*,\s*Type\s*,\s*SubType\s*,\s*Offset\s*,\s*Size\s*,\s*Flags\s*$/im.test(partitionText)||!/^\s*[^#\s][^,]*,[^,]*,[^,]*,[^,]*,[^,]*/m.test(partitionText)) throw Error('partition evidence is not a canonical partition CSV');
const digestReceipt=structuredClone(receipt); delete digestReceipt.receiptDigestSha256; delete digestReceipt.receiptSha256;
if(jsonHash(digestReceipt)!==manifest.provenance.receiptDigestSha256) throw Error('receipt deterministic digest mismatch');
if(receipt.receiptDigestSha256!==manifest.provenance.receiptDigestSha256||receipt.receiptDigestAlgorithm!=='sha256-stable-json-v1'||receipt.pathBase!=='release-directory') throw Error('receipt digest or path contract mismatch');
if(receipt.sourceReceiptDigestAlgorithm!=='sha256-stable-json-v1'||jsonHash(receipt.sourceReceipt)!==manifest.provenance.sourceReceiptDigestSha256||receipt.sourceReceiptDigestSha256!==manifest.provenance.sourceReceiptDigestSha256) throw Error('source receipt deterministic digest mismatch');
if(receipt.schemaVersion!==1||receipt.mode!==manifest.provenance.mode) throw Error('receipt schema or mode mismatch');
if(receipt.source?.repository!=='https://github.com/SteveEisner/WLEDtubes.git'||receipt.source?.clean!==true) throw Error('wrong or mutable receipt source provenance');
requireHash(receipt.source?.commit,'receipt source commit','commit');
if(receipt.environment!=='esp32_quinled_dig2go_tubes') throw Error('wrong receipt build environment');
const sourceReceipt=receipt.sourceReceipt;
if(sourceReceipt?.schemaVersion!==1||sourceReceipt.mode!==receipt.mode||JSON.stringify(sourceReceipt.source)!==JSON.stringify(receipt.source)||sourceReceipt.environment!==receipt.environment) throw Error('normalized receipt does not match source receipt identity');
if(sourceReceipt.contract?.sha256!==receipt.contract?.sha256||sourceReceipt.contract?.lengthBytes!==receipt.contract?.lengthBytes||sourceReceipt.partition?.sha256!==receipt.partition?.sha256||sourceReceipt.partition?.lengthBytes!==receipt.partition?.lengthBytes||sourceReceipt.partition?.csvPath!==receipt.partition?.csvPath) throw Error('normalized receipt evidence does not match source receipt');
for(const kind of ['usb','ota']) {
  const original=sourceReceipt.artifacts?.[kind], normalized=receipt.artifacts?.[kind];
  if(!original||!normalized||original.sha256!==normalized.sha256||original.lengthBytes!==normalized.lengthBytes) throw Error(`${kind} normalized artifact does not match source receipt`);
}
if(receipt.contract?.sha256!==manifest.provenance.contractSha256||receipt.contract.sha256!==evidence.contract.sha256) throw Error('contract hash mismatch across provenance evidence');
if(receipt.partition?.sha256!==manifest.provenance.partitionSha256||receipt.partition.sha256!==evidence.partition.sha256) throw Error('partition hash mismatch across provenance evidence');
for(const [kind,item] of [['contract',receipt.contract],['partition',receipt.partition]]) {
  if(`${releasePrefix}${item.path}`!==manifest.provenance.evidence[kind].path) throw Error(`${kind} receipt evidence path mismatch`);
  if(item.lengthBytes!=null&&item.lengthBytes!==evidence[kind].bytes.length) throw Error(`${kind} receipt evidence length mismatch`);
}

if(contract.schemaVersion!==1) throw Error('unsupported update contract schema');
const contractTarget=contract.targets?.find(target=>target.id==='quinled-dig2go');
const contractUsb=contract.artifacts?.find(artifact=>artifact.targetId==='quinled-dig2go'&&artifact.kind==='complete-merged-image'&&artifact.transport==='usb');
if(!contractTarget||!contractUsb) throw Error('canonical Dig2Go USB contract missing');
if(receipt.mode==='production'&&contractTarget.partition?.sha256!==manifest.provenance.partitionSha256) throw Error('contract partition hash mismatch');

let count=0;
for(const variant of manifest.variants||[]) {
  if(variant.source?.repository!==receipt.source.repository||variant.source?.commit!==receipt.source.commit||variant.source?.clean!==receipt.source.clean) throw Error('manifest source does not match receipt');
  requireHash(variant.source?.commit,'source commit','commit'); requireHash(variant.partition?.tableSha256,'partition hash');
  if(variant.partition.tableSha256!==manifest.provenance.partitionSha256) throw Error('manifest partition hash mismatch');
  if(variant.target?.environment!==receipt.environment||(receipt.mode==='production'&&(variant.target?.hardwareFamily!==contractTarget.hardwareFamily||variant.target?.chip!==contractTarget.chipFamily||variant.target?.flashSizeBytes!==contractTarget.flashSizeBytes))) throw Error('wrong firmware environment or target');
  if(variant.partition?.otaSlot?.offset!==contractTarget.partition.otaSlots?.[0]?.offset||variant.partition?.otaSlot?.sizeBytes!==contractTarget.partition.otaSlots?.[0]?.sizeBytes) throw Error('partition geometry does not match contract');
  for(const artifact of variant.artifacts||[]) {
    const contractWriteOffset=contractUsb.writeOffset??(receipt.mode==='fixture'?0:undefined);
    if(artifact.kind!==contractUsb.kind||artifact.transport!==contractUsb.transport||artifact.offset!==contractWriteOffset) throw Error('wrong release artifact contract');
    const artifactPath=await releaseFile(artifact.path,'artifact path',`${releasePrefix}firmware/`);
    const actual=await fileEvidence(artifactPath);
    if(actual.lengthBytes!==artifact.sizeBytes||actual.sha256!==artifact.sha256) throw Error(`${artifact.path}: mismatch`);
    const receiptUsb=receipt.artifacts?.usb;
    if(!receiptUsb||`${releasePrefix}${receiptUsb.path}`!==artifact.path||receiptUsb.kind!==artifact.kind||receiptUsb.transport!==artifact.transport||receiptUsb.writeOffset!==artifact.offset||receiptUsb.lengthBytes!==artifact.sizeBytes||receiptUsb.sha256!==artifact.sha256) throw Error('USB artifact does not match build receipt');
    const bytes=await readFile(artifactPath), receiptComponents=new Map((receiptUsb.components||[]).map(component=>[component.id,component])), sourceComponents=new Map((sourceReceipt.artifacts?.usb?.components||[]).map(component=>[component.id,component]));
    let end=0;
    for(const component of [...(artifact.components||[])].sort((a,b)=>a.offset-b.offset)) {
      const receiptComponent=receiptComponents.get(component.name), contractComponent=contractUsb.components?.find(item=>item.id===component.name);
      const sourceComponent=sourceComponents.get(component.name);
      if(!receiptComponent||!sourceComponent||!contractComponent||contractComponent.offset!==component.offset||sourceComponent.offset!==component.offset||sourceComponent.lengthBytes!==component.sizeBytes||sourceComponent.sha256!==component.sha256||receiptComponent.offset!==component.offset||receiptComponent.lengthBytes!==component.sizeBytes||receiptComponent.sha256!==component.sha256) throw Error(`${component.name}: component provenance mismatch`);
      if(component.offset<end||component.offset+component.sizeBytes>bytes.length) throw Error('component bounds mismatch');
      const hash=createHash('sha256').update(bytes.subarray(component.offset,component.offset+component.sizeBytes)).digest('hex');
      if(hash!==component.sha256) throw Error(`${component.name}: mismatch`);
      end=component.offset+component.sizeBytes;
    }
    if(receiptComponents.size!==artifact.components?.length||sourceComponents.size!==artifact.components?.length) throw Error('receipt component set mismatch');
    count++;
  }
}
if(count!==1) throw Error('release must contain exactly one Dig2Go USB merged image');
console.log(`verified ${count} immutable release artifact with public provenance`);

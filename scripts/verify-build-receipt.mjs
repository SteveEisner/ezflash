#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import {containedFile,fileEvidence,jsonHash,receiptDir,requireHash} from './release-provenance.mjs';

export async function verifyBuildReceipt(path,{allowFixture=false}={}) {
  const receipt=JSON.parse(await readFile(path,'utf8')), base=receiptDir(path);
  if(receipt.schemaVersion!==1) throw Error('unsupported build receipt schema');
  if(!['production','fixture'].includes(receipt.mode)) throw Error('invalid build receipt mode');
  if(receipt.mode==='fixture'&&!allowFixture) throw Error('fixture receipt rejected by production build');
  if(receipt.mode==='production'&&receipt.source.clean!==true) throw Error('production source must be clean');
  if(receipt.source?.repository!=='https://github.com/SteveEisner/WLEDtubes.git') throw Error('unexpected source repository');
  requireHash(receipt.source?.commit,'source commit','commit');
  if(receipt.environment!=='esp32_quinled_dig2go_tubes') throw Error('unexpected build environment');
  requireHash(receipt.contract?.sha256,'contract hash'); requireHash(receipt.partition?.sha256,'partition hash');
  for(const item of [receipt.contract,receipt.partition,receipt.artifacts?.usb,receipt.artifacts?.ota]) {
    if(!item) throw Error('receipt is missing required evidence');
    const actual=await fileEvidence(await containedFile(base,item.path,'receipt file'));
    if(actual.lengthBytes!==item.lengthBytes||actual.sha256!==item.sha256) throw Error(`${item.path}: receipt evidence mismatch`);
  }
  const usb=await readFile(await containedFile(base,receipt.artifacts.usb.path,'USB artifact'));
  if(receipt.artifacts.usb.kind!=='complete-merged-image'||receipt.artifacts.usb.transport!=='usb'||receipt.artifacts.usb.writeOffset!==0) throw Error('invalid USB artifact identity');
  if(!Array.isArray(receipt.artifacts.usb.components)||!receipt.artifacts.usb.components.length) throw Error('USB components missing');
  let end=0;
  for(const component of [...receipt.artifacts.usb.components].sort((a,b)=>a.offset-b.offset)) {
    requireHash(component.sha256,`${component.id} hash`);
    if(!Number.isSafeInteger(component.offset)||!Number.isSafeInteger(component.lengthBytes)||component.offset<end||component.lengthBytes<=0||component.offset+component.lengthBytes>usb.length) throw Error('invalid/overlapping USB component bounds');
    if((await import('node:crypto')).createHash('sha256').update(usb.subarray(component.offset,component.offset+component.lengthBytes)).digest('hex')!==component.sha256) throw Error(`${component.id}: component mismatch`);
    end=component.offset+component.lengthBytes;
  }
  const claimed=receipt.receiptSha256; delete receipt.receiptSha256; requireHash(claimed,'receipt hash');
  if(jsonHash(receipt)!==claimed) throw Error('receipt hash mismatch'); receipt.receiptSha256=claimed;
  return receipt;
}

if(import.meta.url===`file://${process.argv[1]}`) { await verifyBuildReceipt(process.argv[2],{allowFixture:process.argv.includes('--fixture')}); console.log('build receipt verified'); }

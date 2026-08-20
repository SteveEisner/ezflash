#!/usr/bin/env node
import {cp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {resolve,basename,dirname} from 'node:path';
import {verifyBuildReceipt} from './verify-build-receipt.mjs';
import {jsonHash,sha256} from './release-provenance.mjs';
const args=process.argv.slice(2), value=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1]};
const root=resolve('.'), release=value('--release')||process.env.EASY_FLASH_RELEASE||'v0';
if(!/^[a-z0-9][a-z0-9._-]*$/i.test(release)) throw Error('invalid immutable release id');
const receiptPath=resolve(value('--receipt')||process.env.EASY_FLASH_BUILD_RECEIPT||'build/easy-flash-firmware/build-receipt.json');
const receipt=await verifyBuildReceipt(receiptPath,{allowFixture:args.includes('--fixture')});
const receiptRoot=dirname(receiptPath), out=resolve(root,'dist'), releaseRoot=resolve(out,'releases',release), provenanceRoot=resolve(releaseRoot,'provenance'); await rm(out,{recursive:true,force:true}); await mkdir(resolve(releaseRoot,'firmware'),{recursive:true}); await mkdir(provenanceRoot,{recursive:true});
for(const f of ['index.html','styles.css','firmware-bench.css','app.mjs','hosted-release.mjs','local-flash.mjs','profiles.mjs','firmware-ui.mjs','device-identity.mjs','safety-contract.mjs','operation-receipts.mjs','diagnose.mjs']) await cp(resolve(root,'easy-flash',f),resolve(out,f));
await cp(resolve(root,'easy-flash/maintainer'),resolve(out,'maintainer'),{recursive:true}); await cp(resolve(root,'easy-flash/maintainer/status.mjs'),resolve(out,'maintainer/status.mjs'));
await cp(resolve(root,'easy-flash/vendor'),resolve(out,'vendor'),{recursive:true});
const source=JSON.parse(await readFile(resolve(root,'easy-flash/firmware-manifest.json'),'utf8'));
if (source.variants.length !== 1) throw new Error('build-static rewrites exactly one manifest variant; a multi-variant manifest needs per-variant hosting before publish');
const variant=source.variants[0], artifact=receipt.artifacts.usb, name=basename(artifact.path), publicPath=`releases/${release}/firmware/${name}`;
await cp(resolve(receiptRoot,artifact.path),resolve(out,publicPath)); variant.source={repository:receipt.source.repository,commit:receipt.source.commit,clean:receipt.source.clean}; variant.target.environment=receipt.environment; variant.partition.tableSha256=receipt.partition.sha256;
variant.artifacts=[{kind:artifact.kind,transport:artifact.transport,path:publicPath,sizeBytes:artifact.lengthBytes,sha256:artifact.sha256,offset:artifact.writeOffset,components:artifact.components.map(c=>({name:c.id,offset:c.offset,sizeBytes:c.lengthBytes,sha256:c.sha256}))}];
const partitionName=basename(receipt.partition.path), contractName='update-contract.json';
await cp(resolve(receiptRoot,receipt.contract.path),resolve(provenanceRoot,contractName)); await cp(resolve(receiptRoot,receipt.partition.path),resolve(provenanceRoot,partitionName));
const {receiptSha256:sourceReceiptDigestSha256,...sourceReceipt}=receipt;
const publicReceipt={schemaVersion:1,receiptDigestAlgorithm:'sha256-stable-json-v1',pathBase:'release-directory',sourceReceiptDigestAlgorithm:'sha256-stable-json-v1',sourceReceiptDigestSha256,sourceReceipt,mode:receipt.mode,source:receipt.source,environment:receipt.environment,
  contract:{path:`provenance/${contractName}`,lengthBytes:receipt.contract.lengthBytes,sha256:receipt.contract.sha256},
  partition:{path:`provenance/${partitionName}`,csvPath:receipt.partition.csvPath,lengthBytes:receipt.partition.lengthBytes,sha256:receipt.partition.sha256},
  artifacts:{usb:{...receipt.artifacts.usb,path:`firmware/${name}`},ota:{...receipt.artifacts.ota,path:undefined,published:false}}};
publicReceipt.receiptDigestSha256=jsonHash(publicReceipt); const receiptBytes=Buffer.from(JSON.stringify(publicReceipt,null,2)+'\n'); await writeFile(resolve(provenanceRoot,'build-receipt.json'),receiptBytes);
source.provenance={receiptDigestSha256:publicReceipt.receiptDigestSha256,sourceReceiptDigestSha256,contractSha256:receipt.contract.sha256,partitionSha256:receipt.partition.sha256,mode:receipt.mode,evidence:{
  receipt:{path:`releases/${release}/provenance/build-receipt.json`,sha256:sha256(receiptBytes)},
  contract:{path:`releases/${release}/provenance/${contractName}`,sha256:receipt.contract.sha256},
  partition:{path:`releases/${release}/provenance/${partitionName}`,sha256:receipt.partition.sha256}}};
await writeFile(resolve(out,'releases',release,'manifest.json'),JSON.stringify(source,null,2)+'\n'); await writeFile(resolve(out,'current.json'),JSON.stringify({releaseId:release,manifest:`releases/${release}/manifest.json`,generatedAt:new Date().toISOString()},null,2)+'\n'); await cp(resolve(root,'_headers'),resolve(out,'_headers')); console.log(`built ${out} from verified ${receipt.mode} receipt`);

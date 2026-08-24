#!/usr/bin/env node
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {fileEvidence, jsonHash} from "./release-provenance.mjs";
import {verifyBuildReceipt} from "./verify-build-receipt.mjs";
import {assertV15PreviewReceipt,V15_PREVIEW} from "./v15-preview-contract.mjs";
const args=process.argv.slice(2),i=args.indexOf("--dist"),dist=resolve(i<0?"build/v15-preview-site":args[i+1]);
const current=JSON.parse(await readFile(resolve(dist,"current.json"))), manifest=JSON.parse(await readFile(resolve(dist,current.manifest))), staging=JSON.parse(await readFile(resolve(dist,"preview-staging-receipt.json")));
if(current.previewChannel!==V15_PREVIEW.channel||current.releaseId!==V15_PREVIEW.releaseId||manifest.preview?.sourceCommit!==V15_PREVIEW.sourceCommit||manifest.preview?.sourceTree!==V15_PREVIEW.sourceTree)throw Error("not the exact v15 PR71 preview channel");
const claimed=staging.receiptSha256;delete staging.receiptSha256;if(jsonHash(staging)!==claimed||staging.channel!==V15_PREVIEW.channel||staging.artifacts?.length!==3)throw Error("preview staging receipt mismatch");
assertV15PreviewReceipt(await verifyBuildReceipt(staging.sourceBuildReceipt));
for(let n=0;n<V15_PREVIEW.targets.length;n++){const expected=V15_PREVIEW.targets[n],artifact=staging.artifacts[n];if(artifact.targetId!==expected.id||artifact.environment!==expected.environment)throw Error("preview target mapping mismatch");const actual=await fileEvidence(resolve(dist,artifact.path));if(actual.lengthBytes!==artifact.sizeBytes||actual.sha256!==artifact.sha256)throw Error("preview artifact mismatch");}
console.log("verified isolated v15 PR71 preview and exact three-target staging receipt");

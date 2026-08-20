import assert from "node:assert/strict";
import test from "node:test";
import {loadHostedRelease} from "../hosted-release.mjs";

const definitions=[["quinled-dig2go","QuinLED Dig2Go","ESP32"],["athom-c3-tubes","Athom ESP32-C3 controller","ESP32-C3"],["waveshare-s3-tubes-remote","Waveshare ESP32-S3-Touch-AMOLED-2.16","ESP32-S3"]];
const manifest=()=>({schemaVersion:2,provisional:true,variants:definitions.map(([id,printedModel,chip])=>({id,hardwareTested:false,source:{commit:"b".repeat(40)},bootIdentity:{version:1,target:id,source:"b".repeat(40),release:"16.0.1",tubes:14},target:{printedModel,hardwareFamily:id,chip},artifacts:[{kind:"complete-merged-image",transport:"usb",path:`releases/r-1/firmware/${id}-merged.bin`,offset:0,sizeBytes:3,sha256:"a".repeat(64),components:[]}]}))});

test("loads one immutable three-target catalog with no-store",async()=>{const calls=[],fetchImpl=async(url,options)=>{calls.push([String(url),options]);return {ok:true,json:async()=>calls.length===1?{releaseId:"r-1"}:manifest()};};const release=await loadHostedRelease({fetchImpl,baseUrl:"https://flash.example/app/"});assert.equal(release.catalog.length,3);assert.match(release.catalog[1].artifact.url,/athom-c3-tubes-merged\.bin$/);assert.deepEqual(calls.map(([,options])=>options.cache),["no-store","no-store"]);});

for(const releaseId of ["../bad","v1/next","https://evil.example/r","v1?mutable","",42])test(`rejects unsafe release pointer ${JSON.stringify(releaseId)}`,async()=>{await assert.rejects(()=>loadHostedRelease({baseUrl:"https://flash.example/",fetchImpl:async()=>({ok:true,json:async()=>({releaseId})})}),/release pointer/i);});

for(const path of ["../merged.bin","/firmware/merged.bin","https://evil.example/merged.bin","releases/r-1/firmware/../merged.bin","releases/latest/firmware/merged.bin","releases/r-1/firmware/merged.bin?x=1"])test(`rejects unsafe artifact path ${path}`,async()=>{let count=0;const bad=manifest();bad.variants[0].artifacts[0].path=path;await assert.rejects(()=>loadHostedRelease({baseUrl:"https://flash.example/",fetchImpl:async()=>({ok:true,json:async()=>++count===1?{releaseId:"r-1"}:bad})}),/artifact path/i);});

test("fails closed for missing, duplicate, or unknown target catalogs",async()=>{for(const mutate of [value=>value.variants.pop(),value=>value.variants[2]=structuredClone(value.variants[1]),value=>value.variants[2].id="generic-s3"]){let count=0;const bad=manifest();mutate(bad);await assert.rejects(()=>loadHostedRelease({baseUrl:"https://flash.example/",fetchImpl:async()=>({ok:true,json:async()=>++count===1?{releaseId:"r-1"}:bad})}),/exactly three|catalog/i);}});

test("fails closed when immutable boot identity is missing or not source-bound",async()=>{for(const mutate of [value=>delete value.variants[0].bootIdentity,value=>value.variants[0].bootIdentity.source="c".repeat(40),value=>value.variants[0].bootIdentity.target="athom-c3-tubes"]){let count=0;const bad=manifest();mutate(bad);await assert.rejects(()=>loadHostedRelease({baseUrl:"https://flash.example/",fetchImpl:async()=>({ok:true,json:async()=>++count===1?{releaseId:"r-1"}:bad})}),/boot identity/i);}});

test("resolveDetectedTarget maps classic ESP32 dies to the plain-ESP32 target", async () => {
	const { resolveDetectedTarget } = await import("../hosted-release.mjs");
	const catalog=[{variant:{id:"dig2go",target:{chip:"ESP32"}}},{variant:{id:"s3",target:{chip:"ESP32-S3"}}}];
	assert.equal(resolveDetectedTarget(catalog,"ESP32-D0WD-V3").variant.id,"dig2go");
	assert.equal(resolveDetectedTarget(catalog,"ESP32-S3 (QFN56)").variant.id,"s3");
	assert.throws(()=>resolveDetectedTarget(catalog,"ESP32-C4"),/Unsupported/);
});

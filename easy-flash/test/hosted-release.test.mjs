import assert from "node:assert/strict";
import test from "node:test";

import { loadHostedRelease } from "../hosted-release.mjs";

const variant={id:"dig2go",target:{board:"QuinLED Dig2Go",hardwareFamily:"quinled-dig2go",chip:"ESP32"},artifacts:[{kind:"complete-merged-image",transport:"usb",path:"releases/r-1/firmware/merged.bin",offset:0,sizeBytes:3,sha256:"a".repeat(64),components:[]}]};

test("loads the same-origin pointer then its immutable manifest with no-store",async()=>{
	const calls=[];const fetchImpl=async(url,options)=>{calls.push([String(url),options]);return {ok:true,json:async()=>calls.length===1?{releaseId:"r-1"}:{schemaVersion:2,variants:[variant]}};};
	const selection=await loadHostedRelease({fetchImpl,baseUrl:"https://flash.example/app/"});
	assert.equal(selection.releaseId,"r-1");assert.equal(selection.artifact.url,"https://flash.example/app/releases/r-1/firmware/merged.bin");
	assert.deepEqual(calls.map(([url])=>url),["https://flash.example/app/current.json","https://flash.example/app/releases/r-1/manifest.json"]);
	assert.deepEqual(calls.map(([,options])=>options.cache),["no-store","no-store"]);
});

for(const releaseId of ["../bad","v1/next","https://evil.example/r","v1?mutable","",42]) test(`rejects unsafe release pointer ${JSON.stringify(releaseId)}`,async()=>{
	await assert.rejects(()=>loadHostedRelease({baseUrl:"https://flash.example/",fetchImpl:async()=>({ok:true,json:async()=>({releaseId})})}),/release pointer/i);
});

for(const path of ["../merged.bin","/firmware/merged.bin","https://evil.example/merged.bin","releases/r-1/firmware/../merged.bin","releases/latest/firmware/merged.bin","releases/r-1/firmware/merged.bin?x=1"]) test(`rejects unsafe artifact path ${path}`,async()=>{
	let count=0;const bad=structuredClone(variant);bad.artifacts[0].path=path;
	await assert.rejects(()=>loadHostedRelease({baseUrl:"https://flash.example/",fetchImpl:async()=>({ok:true,json:async()=>++count===1?{releaseId:"r-1"}:{schemaVersion:2,variants:[bad]}})}),/artifact path/i);
});

test("requires exactly one Dig2Go merged USB image",async()=>{
	let count=0;const wrong=structuredClone(variant);wrong.target.board="Other";
	await assert.rejects(()=>loadHostedRelease({baseUrl:"https://flash.example/",fetchImpl:async()=>({ok:true,json:async()=>++count===1?{releaseId:"r-1"}:{schemaVersion:2,variants:[wrong]}})}),/Dig2Go/i);
});

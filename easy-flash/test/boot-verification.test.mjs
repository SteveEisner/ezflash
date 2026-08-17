import assert from "node:assert/strict";
import test from "node:test";

import {parseWledTubesBootLine,verifyControllerBoot} from "../boot-verification.mjs";

const expected={version:1,target:"athom-c3-tubes",source:"0123456789abcdef0123456789abcdef01234567",release:"16.0.1",tubes:14};

function portFixture(chunks,{openFailures=0,info={usbVendorId:1,usbProductId:2}}={}) {
	let openCalls=0,closeCalls=0,cancelCalls=0,releaseCalls=0,open=false;
	const reader={async read(){const value=chunks.shift();return value===undefined?{done:true}:{done:false,value:new TextEncoder().encode(value)};},async cancel(){cancelCalls++;},releaseLock(){releaseCalls++;}};
	return {port:{getInfo:()=>info,get readable(){return open?{getReader:()=>reader}:null;},async open(){openCalls++;if(openCalls<=openFailures)throw Error("not ready");open=true;},async close(){closeCalls++;open=false;}},counts:()=>({openCalls,closeCalls,cancelCalls,releaseCalls})};
}

test("parser admits only one exact versioned boot identity line",()=>{
	assert.deepEqual(parseWledTubesBootLine("noise\nWLEDTUBES_BOOT v=1 target=athom-c3-tubes source=0123456789abcdef0123456789abcdef01234567 release=16.0.1 tubes=14\n"),expected);
	for(const text of ["WLED 16.0.1","chip=ESP32-C3","WLEDTUBES_BOOT target=athom-c3-tubes","x WLEDTUBES_BOOT v=1 target=athom-c3-tubes source=0123456789abcdef0123456789abcdef01234567 release=16.0.1 tubes=14"])
		assert.equal(parseWledTubesBootLine(text),null);
});

test("parser rejects duplicate or conflicting canonical identities regardless of order",()=>{
	const valid="WLEDTUBES_BOOT v=1 target=athom-c3-tubes source=0123456789abcdef0123456789abcdef01234567 release=16.0.1 tubes=14";
	const conflict="WLEDTUBES_BOOT v=1 target=quinled-dig2go source=1123456789abcdef0123456789abcdef01234567 release=16.0.2 tubes=15";
	assert.equal(parseWledTubesBootLine(`${valid}\n${valid}\n`),null);
	assert.equal(parseWledTubesBootLine(`${valid}\n${conflict}\n`),null);
	assert.equal(parseWledTubesBootLine(`${conflict}\n${valid}\n`),null);
	assert.deepEqual(parseWledTubesBootLine(`WLEDTUBES_BOOT v=1 target=bad source=nope\n${valid}\n`),expected);
});

test("bounded read proves exact identity without serial writes",async()=>{
	const fixture=portFixture(["boot noise\nWLEDTUBES_BOOT v=1 target=athom-c3-tubes source=0123456789abcdef0123456789abcdef01234567 release=16.0.1 tubes=14\n"]);
	const result=await verifyControllerBoot({port:fixture.port,expected,timeoutMs:50,maxBytes:8192,delay:async()=>{}});
	assert.equal(result.status,"verified");assert.deepEqual(result.observed,expected);assert.equal("writable" in fixture.port,false);assert.equal(fixture.counts().openCalls,1);assert.equal(fixture.counts().closeCalls,1);
});

test("bounded capture waits for completion and handles partial chunks",async()=>{
	const fixture=portFixture(["WLEDTUBES_","BOOT v=1 target=athom-c3-tubes source=0123456789abcdef0123456789abcdef01234567 release=16.0.1 tubes=14","\nnoise\n"]);
	const result=await verifyControllerBoot({port:fixture.port,expected,timeoutMs:50,delay:async()=>{}});
	assert.equal(result.status,"verified");assert.deepEqual(result.observed,expected);
});

test("valid identity conflicts before or after and duplicate captures fail closed",async()=>{
	const valid="WLEDTUBES_BOOT v=1 target=athom-c3-tubes source=0123456789abcdef0123456789abcdef01234567 release=16.0.1 tubes=14\n";
	const conflict="WLEDTUBES_BOOT v=1 target=athom-c3-tubes source=1123456789abcdef0123456789abcdef01234567 release=16.0.1 tubes=14\n";
	for(const chunks of [[valid,conflict],[conflict,valid],[valid,valid]]) {
		const result=await verifyControllerBoot({port:portFixture(chunks).port,expected,timeoutMs:50,delay:async()=>{}});
		assert.equal(result.status,"mismatch");
	}
});

test("rebinds one matching VID/PID port, preserves reusable original, and refuses ambiguity",async()=>{
	const original=portFixture(["WLEDTUBES_BOOT v=1 target=athom-c3-tubes source=0123456789abcdef0123456789abcdef01234567 release=16.0.1 tubes=14\n"]);
	assert.equal((await verifyControllerBoot({port:original.port,expected,enumeratePorts:async()=>{throw Error("must not enumerate");},timeoutMs:50,delay:async()=>{}})).port,original.port);
	const gone=portFixture([],{openFailures:8}),replacement=portFixture(["WLEDTUBES_BOOT v=1 target=athom-c3-tubes source=0123456789abcdef0123456789abcdef01234567 release=16.0.1 tubes=14\n"]);
	const rebound=await verifyControllerBoot({port:gone.port,expected,enumeratePorts:async()=>[replacement.port],timeoutMs:50,delay:async()=>{}});
	assert.equal(rebound.status,"verified");assert.equal(rebound.port,replacement.port);
	const a=portFixture([]),b=portFixture([]);
	const ambiguous=await verifyControllerBoot({port:gone.port,expected,enumeratePorts:async()=>[a.port,b.port],timeoutMs:50,delay:async()=>{}});
	assert.equal(ambiguous.status,"pending");assert.match(ambiguous.reason,/multiple/i);assert.equal(a.counts().openCalls,0);assert.equal(b.counts().openCalls,0);
	const other=portFixture([],{info:{usbVendorId:9,usbProductId:9}});
	const stale=await verifyControllerBoot({port:gone.port,expected,enumeratePorts:async()=>[other.port],timeoutMs:50,delay:async()=>{}});
	assert.equal(stale.status,"pending");assert.equal(other.counts().openCalls,0);
});

test("bounded discovery waits for re-enumeration, reuses a returned original, and requires USB IDs",async()=>{
	const replacement=portFixture(["WLEDTUBES_BOOT v=1 target=athom-c3-tubes source=0123456789abcdef0123456789abcdef01234567 release=16.0.1 tubes=14\n"]),gone=portFixture([],{openFailures:8});let polls=0;
	const delayed=await verifyControllerBoot({port:gone.port,expected,enumeratePorts:async()=>++polls===1?[]:[replacement.port],timeoutMs:50,delay:async()=>{}});
	assert.equal(delayed.status,"verified");assert.equal(polls,2);assert.equal(delayed.port,replacement.port);
	const returned=portFixture(["WLEDTUBES_BOOT v=1 target=athom-c3-tubes source=0123456789abcdef0123456789abcdef01234567 release=16.0.1 tubes=14\n"],{openFailures:1});
	const reused=await verifyControllerBoot({port:returned.port,expected,enumeratePorts:async()=>[returned.port],timeoutMs:50,delay:async()=>{}});
	assert.equal(reused.status,"verified");assert.equal(reused.port,returned.port);assert.equal(returned.counts().openCalls,2);
	const unidentifiedOriginal=portFixture([],{openFailures:8,info:{}}),unidentifiedCandidate=portFixture([],{info:{}});
	const unidentified=await verifyControllerBoot({port:unidentifiedOriginal.port,expected,enumeratePorts:async()=>[unidentifiedCandidate.port],timeoutMs:50,delay:async()=>{}});
	assert.equal(unidentified.status,"pending");assert.equal(unidentifiedCandidate.counts().openCalls,0);
});

test("wrong exact identity is mismatch while generic bytes remain pending",async()=>{
	const wrong=portFixture(["WLEDTUBES_BOOT v=1 target=quinled-dig2go source=0123456789abcdef0123456789abcdef01234567 release=16.0.1 tubes=14\n"]);
	assert.equal((await verifyControllerBoot({port:wrong.port,expected,timeoutMs:50,delay:async()=>{}})).status,"mismatch");
	const generic=portFixture(["WLED 16.0.1 ESP32-C3\n"]);
	assert.equal((await verifyControllerBoot({port:generic.port,expected,timeoutMs:5,delay:async()=>{}})).status,"pending");
});

test("open retry is bounded and a successful open is never repeated",async()=>{
	const fixture=portFixture([""],{openFailures:2});
	const result=await verifyControllerBoot({port:fixture.port,expected,timeoutMs:20,maxOpenAttempts:4,delay:async()=>{}});
	assert.equal(result.status,"pending");assert.equal(fixture.counts().openCalls,3);
});

test("capture is capped at 8 KiB",async()=>{
	const fixture=portFixture(["x".repeat(9000)]),result=await verifyControllerBoot({port:fixture.port,expected,timeoutMs:10,maxBytes:8192,delay:async()=>{}});
	assert.equal(result.bytesCaptured,8192);assert.equal(result.status,"pending");
});

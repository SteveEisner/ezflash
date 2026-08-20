import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createFlashRuntime } from "../local-flash.mjs";
import { loadFirmwareManifest } from "../firmware-manifest.mjs";
import { validateMergedImageBytes, validateMergedImageStructure } from "../safety-contract.mjs";

const hash=(bytes)=>Promise.resolve(createHash("sha256").update(bytes).digest("hex"));

test("local adapter validates required component IDs, bounds, overlap, and every slice hash",async()=>{
	const manifest=await loadFirmwareManifest(),variant=manifest.variants[0],artifact=variant.artifacts.find(({transport})=>transport==="usb");
	const bytes=new Uint8Array(await readFile(new URL(`../${artifact.path}`,import.meta.url)));
	assert.equal((await validateMergedImageBytes(variant.target,artifact,bytes,hash)).length,4);
	for(const mutate of [
		(value)=>{value.components[0].name="unknown";},
		(value)=>{value.components[1].offset=value.components[0].offset;},
		(value)=>{value.components.pop();},
		(value)=>{value.components[0].sizeBytes=Number.MAX_SAFE_INTEGER;},
	]) { const changed=structuredClone(artifact);mutate(changed);assert.throws(()=>validateMergedImageStructure(variant.target,changed)); }
	const corrupt=bytes.slice();corrupt[artifact.components[0].offset]^=1;await assert.rejects(validateMergedImageBytes(variant.target,{...artifact,sha256:await hash(corrupt)},corrupt,hash),/component bootloader hash mismatch/i);
});

test("allows a component at offset 0 (ESP32-S3 bootloader) while keeping sizes positive", async () => {
	const manifest=await loadFirmwareManifest(),variant=manifest.variants[0],artifact=variant.artifacts.find(({transport})=>transport==="usb");
	const zeroOffset=structuredClone(artifact);zeroOffset.components[0].offset=0;
	// Offset 0 is valid; only size must stay positive.
	const components=validateMergedImageStructure(variant.target,{...zeroOffset});
	assert.equal(components[0].imageStart,0);
	// A negative offset must still be rejected.
	const negative=structuredClone(artifact);negative.components[0].offset=-1;
	assert.throws(()=>validateMergedImageStructure(variant.target,negative),/non-negative safe integer/i);
});

class SerialMock extends EventTarget { constructor(port){super();this.port=port;this.requests=0;} async requestPort(){this.requests++;return this.port;} disconnect(port){const event=new Event("disconnect");Object.defineProperty(event,"port",{value:port});this.dispatchEvent(event);} }
function runtimeFixture({connectChip="ESP32",changedInfo=false}={}) {
	const port={getInfo:()=>changedInfo?{usbVendorId:9,usbProductId:2}:{usbVendorId:1,usbProductId:2}};let calls=0,writes=0,closed=0,boundary=0;const serial=new SerialMock(port);
	class Loader { async main(){calls++;return connectChip;} async writeFlash(){writes++;} async after(){} }
	class Transport { async disconnect(){closed++;} }
	return {serial,port,counts:()=>({calls,writes,closed,boundary}),runtime:createFlashRuntime({serial,Loader,TransportClass:Transport,cryptoImpl:webcrypto,delay:async()=>{},fetchImpl:async()=>{const manifest=await loadFirmwareManifest(),artifact=manifest.variants[0].artifacts[0];return new Response(await readFile(new URL(`../${artifact.path}`,import.meta.url)));}}),mark:()=>boundary++};
}

test("prepared token, exact port, physical model, and stored chip identity gate the pre-write boundary",async()=>{
	const manifest=await loadFirmwareManifest(),variant=manifest.variants[0],artifact={...variant.artifacts[0],url:"https://flash.test/releases/test/firmware/merged.bin"},fixture=runtimeFixture();
	const evidence=await fixture.runtime.connectToController({variant,onStatus(){}});const base={variant,artifact,sessionToken:evidence.token,port:evidence.port,onStatus(){},onProgress(){},beforeWrite:fixture.mark};
	await assert.rejects(fixture.runtime.installConnectedController({...base,physicalConfirmation:{asserted:false,targetId:variant.id,printedModel:variant.target.board}}),/printed .* label/i);assert.equal(fixture.counts().boundary,0);
	// A rejected assertion does not consume the prepared session.
	await fixture.runtime.installConnectedController({...base,physicalConfirmation:{asserted:true,targetId:variant.id,printedModel:variant.target.board}});assert.equal(fixture.counts().boundary,1);assert.equal(fixture.counts().writes,1);
	await assert.rejects(fixture.runtime.installConnectedController({...base,physicalConfirmation:{asserted:true,targetId:variant.id,printedModel:variant.target.board}}),/connect.*again/i);
});

test("wrong target/model, swapped USB device, unsupported chip, and serial disconnect invalidate safely",async()=>{
	const manifest=await loadFirmwareManifest(),variant=manifest.variants[0],artifact={...variant.artifacts[0],url:"https://flash.test/releases/test/firmware/merged.bin"};
	for(const confirmation of [{asserted:true,targetId:"other",printedModel:variant.target.board},{asserted:true,targetId:variant.id,printedModel:"Other board"}]) {const f=runtimeFixture(),e=await f.runtime.connectToController({variant,onStatus(){}});await assert.rejects(f.runtime.installConnectedController({variant,artifact,sessionToken:e.token,port:e.port,physicalConfirmation:confirmation,onStatus(){},onProgress(){}}),/printed .* label/i);assert.equal(f.counts().writes,0);}
	// A controller whose chip does not match the selected target is rejected at connect, before any install path.
	const wrong=runtimeFixture({connectChip:"ESP32-S3"});await assert.rejects(wrong.runtime.connectToController({variant,onStatus(){}}),/not the supported ESP32/i);assert.equal(wrong.counts().writes,0);
	// A USB device swapped after connect is caught by the port-identity recheck at pre-write (no chip re-read, no port re-open).
	const swapped=runtimeFixture(),e1=await swapped.runtime.connectToController({variant,onStatus(){}});swapped.port.getInfo=()=>({usbVendorId:9,usbProductId:2});await assert.rejects(swapped.runtime.installConnectedController({variant,artifact,sessionToken:e1.token,port:e1.port,physicalConfirmation:{asserted:true,targetId:variant.id,printedModel:variant.target.board},onStatus(){},onProgress(){}}),/USB controller changed/i);assert.equal(swapped.counts().writes,0);
	const gone=runtimeFixture(),e2=await gone.runtime.connectToController({variant,onStatus(){}});let reason=null;gone.runtime.setInvalidationHandler((event)=>reason=event.reason);gone.serial.disconnect(gone.port);await new Promise(setImmediate);assert.equal(reason,"disconnect");await assert.rejects(gone.runtime.installConnectedController({variant,artifact,sessionToken:e2.token,port:e2.port,physicalConfirmation:{asserted:true,targetId:variant.id,printedModel:variant.target.board},onStatus(){},onProgress(){}}),/connect.*again/i);
});

test("quad flash modes never reach the write; pass-through modes do",async()=>{
	const manifest=await loadFirmwareManifest(),variant=manifest.variants[0],artifact={...variant.artifacts[0],url:"https://flash.test/releases/test/firmware/merged.bin"};
	// qio/qout rewrite the bootloader header at write time and can brick boards whose flash wiring
	// cannot fast-boot quad mode (FD2 Waveshare S3, 2026-08-19). They must be refused before any write.
	for(const mode of ["qio","qout"]) {
		const f=runtimeFixture(),e=await f.runtime.connectToController({variant:{...variant,target:{...variant.target,flashMode:mode}},onStatus(){}});
		await assert.rejects(f.runtime.installConnectedController({variant:{...variant,target:{...variant.target,flashMode:mode}},artifact,sessionToken:e.token,port:e.port,physicalConfirmation:{asserted:true,targetId:variant.id,printedModel:variant.target.board},onStatus(){},onProgress(){}}),/refusing to patch the bootloader flash mode/i);
		assert.equal(f.counts().writes,0);
	}
	// "keep" (and an absent flashMode) still install normally.
	for(const mode of ["keep",undefined]) {
		const f=runtimeFixture(),v={...variant,target:{...variant.target,flashMode:mode}},e=await f.runtime.connectToController({variant:v,onStatus(){}});
		await f.runtime.installConnectedController({variant:v,artifact,sessionToken:e.token,port:e.port,physicalConfirmation:{asserted:true,targetId:variant.id,printedModel:variant.target.board},onStatus(){},onProgress(){}});
		assert.equal(f.counts().writes,1);
	}
});

test("chip families gate strictly: C61 is not C6, unknown families never collapse to ESP32",async()=>{
	const { chipFamily }=await import("../local-flash.mjs");
	assert.equal(chipFamily("ESP32-C61"),"ESP32-C61");
	assert.equal(chipFamily("ESP32-C6 (QFN40)"),"ESP32-C6");
	assert.equal(chipFamily("ESP32-D0WD-V3"),"ESP32");
	assert.equal(chipFamily("ESP32-PICO-D4"),"ESP32");
	// A future/unknown family must fail the match rather than pass as classic ESP32.
	assert.notEqual(chipFamily("ESP32-C4"),"ESP32");
	assert.notEqual(chipFamily("ESP32-H4"),"ESP32");
});

test("the write never patches the bootloader flash-size header from the catalog",async()=>{
	const f=runtimeFixture();let captured=null;
	const manifest=await loadFirmwareManifest(),variant=manifest.variants[0],artifact={...variant.artifacts[0],url:"https://flash.test/releases/test/firmware/merged.bin"};
	const e=await f.runtime.connectToController({variant,onStatus(){}});
	f.runtime; // capture writeFlash args via a wrapped fixture is not exposed; assert source contract instead
	const src=await readFile(new URL("../local-flash.mjs",import.meta.url),"utf8");
	assert.match(src,/flashSize:"keep"/);
	assert.doesNotMatch(src,/flashSize:flashSize\(/);
	await f.runtime.installConnectedController({variant,artifact,sessionToken:e.token,port:e.port,physicalConfirmation:{asserted:true,targetId:variant.id,printedModel:variant.target.board},onStatus(){},onProgress(){}});
	assert.equal(f.counts().writes,1);
});

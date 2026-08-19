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
	await assert.rejects(fixture.runtime.installConnectedController({...base,physicalConfirmation:{asserted:false,targetId:variant.id,printedModel:variant.target.board}}),/printed Dig2Go/i);assert.equal(fixture.counts().boundary,0);
	// A rejected assertion does not consume the prepared session.
	await fixture.runtime.installConnectedController({...base,physicalConfirmation:{asserted:true,targetId:variant.id,printedModel:variant.target.board}});assert.equal(fixture.counts().boundary,1);assert.equal(fixture.counts().writes,1);
	await assert.rejects(fixture.runtime.installConnectedController({...base,physicalConfirmation:{asserted:true,targetId:variant.id,printedModel:variant.target.board}}),/connect.*again/i);
});

test("wrong target/model, swapped USB device, unsupported chip, and serial disconnect invalidate safely",async()=>{
	const manifest=await loadFirmwareManifest(),variant=manifest.variants[0],artifact={...variant.artifacts[0],url:"https://flash.test/releases/test/firmware/merged.bin"};
	for(const confirmation of [{asserted:true,targetId:"other",printedModel:variant.target.board},{asserted:true,targetId:variant.id,printedModel:"Other board"}]) {const f=runtimeFixture(),e=await f.runtime.connectToController({variant,onStatus(){}});await assert.rejects(f.runtime.installConnectedController({variant,artifact,sessionToken:e.token,port:e.port,physicalConfirmation:confirmation,onStatus(){},onProgress(){}}),/printed Dig2Go/i);assert.equal(f.counts().writes,0);}
	// A controller whose chip does not match the selected target is rejected at connect, before any install path.
	const wrong=runtimeFixture({connectChip:"ESP32-S3"});await assert.rejects(wrong.runtime.connectToController({variant,onStatus(){}}),/not the supported ESP32/i);assert.equal(wrong.counts().writes,0);
	// A USB device swapped after connect is caught by the port-identity recheck at pre-write (no chip re-read, no port re-open).
	const swapped=runtimeFixture(),e1=await swapped.runtime.connectToController({variant,onStatus(){}});swapped.port.getInfo=()=>({usbVendorId:9,usbProductId:2});await assert.rejects(swapped.runtime.installConnectedController({variant,artifact,sessionToken:e1.token,port:e1.port,physicalConfirmation:{asserted:true,targetId:variant.id,printedModel:variant.target.board},onStatus(){},onProgress(){}}),/USB controller changed/i);assert.equal(swapped.counts().writes,0);
	const gone=runtimeFixture(),e2=await gone.runtime.connectToController({variant,onStatus(){}});let reason=null;gone.runtime.setInvalidationHandler((event)=>reason=event.reason);gone.serial.disconnect(gone.port);await new Promise(setImmediate);assert.equal(reason,"disconnect");await assert.rejects(gone.runtime.installConnectedController({variant,artifact,sessionToken:e2.token,port:e2.port,physicalConfirmation:{asserted:true,targetId:variant.id,printedModel:variant.target.board},onStatus(){},onProgress(){}}),/connect.*again/i);
});

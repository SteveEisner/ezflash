import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getHardwareArtifacts } from "../firmware-ui.mjs";
import {resolveDetectedTarget} from "../hosted-release.mjs";
import { loadFirmwareManifest } from "../firmware-manifest.mjs";

test("launch is connect-first with the controller list always expanded", async () => {
	const html=await readFile(new URL("../index.html",import.meta.url),"utf8");
	assert.match(html,/Choose your controller/); assert.match(html,/id="connect">Connect/); assert.match(html,/id="install" disabled hidden>Install/);
	assert.match(html,/deviceOptions|deviceSelect|selectedDeviceNote/); assert.match(html,/QuinLED Dig2Go/); assert.match(html,/Athom C3/); assert.match(html,/Waveshare S3/);
	assert.doesNotMatch(html,/physicalConfirmation|confirmedPrintedModel|type="checkbox"|operator-checkbox|computer detected a compatible chip, but cannot prove the board model/);
	assert.match(html,/target-specific Install|Install replaces the controller firmware/); assert.match(html,/write starts only/);
	assert.match(html,/<details id="advancedDetails">/); assert.match(html,/Buy\. Build\. <em>Rave\.<\/em>/); assert.match(html,/<summary>Advanced updates<\/summary>/); assert.match(html,/Coming soon<\/strong><p>OTA and nearby-device update tools will live here\. For now, use USB Easy Flash above\.<\/p>/); assert.doesNotMatch(html,/Targets|artifact|P2P.*button|button.*P2P/);
	assert.doesNotMatch(html,/Controller<\/span>|Lights<\/span>|Power<\/span>|Review<\/span>|firmwareCards|Download complete|Run safe demo/);
});

test("observed chip resolves exactly one immutable current-catalog target",()=>{
	const catalog=[
		["quinled-dig2go","ESP32"],
		["athom-c3-tubes","ESP32-C3"],
		["waveshare-s3-tubes-remote","ESP32-S3"],
	].map(([id,chip])=>({variant:{id,target:{chip}},artifact:{url:`https://flash.test/${id}.bin`}}));
	for(const [id,chip] of [["quinled-dig2go","ESP32"],["athom-c3-tubes","ESP32-C3 (revision 0.4)"],["waveshare-s3-tubes-remote","ESP32-S3"]])assert.equal(resolveDetectedTarget(catalog,chip).variant.id,id);
	assert.throws(()=>resolveDetectedTarget(catalog,"ESP32-C6"),/unsupported/i);
	assert.throws(()=>resolveDetectedTarget([...catalog,{...catalog[1],variant:{id:"duplicate",target:{chip:"ESP32-C3"}}}],"ESP32-C3"),/ambiguous/i);
});

test("catalog contains only the canonical Dig2Go artifact", async () => {
	const artifacts=getHardwareArtifacts(await loadFirmwareManifest());
	assert.deepEqual(artifacts.map(({id}) => id),["previous-stable-control"]);
	assert.equal(artifacts[0].target.board,"QuinLED Dig2Go");
});

test("connect detects in one step and install reuses the prepared session", async () => {
	const app=await readFile(new URL("../app.mjs",import.meta.url),"utf8");
	const flash=await readFile(new URL("../local-flash.mjs",import.meta.url),"utf8");
	assert.match(app,/connectToController/); assert.match(app,/installConnectedController/); assert.doesNotMatch(app,/window\.confirm/);
	assert.equal((flash.match(/serial\.requestPort\(\)/g)||[]).length,1);
	// chip identification runs inside connect (single open, one loader.main), not as a later manual step
	assert.ok(flash.indexOf("loader.main()") < flash.indexOf("active={token"));
	assert.match(flash,/session\.token !== sessionToken/); assert.match(flash,/eraseAll:false/); assert.match(flash,/boot-identity-verified/); assert.match(flash,/health:verification\.status===/);
	assert.doesNotMatch(flash,/Flash complete|result:\s*"complete"/i);
});

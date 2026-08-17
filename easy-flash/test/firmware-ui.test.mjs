import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getHardwareArtifacts } from "../firmware-ui.mjs";
import {resolveDetectedTarget} from "../hosted-release.mjs";
import { loadFirmwareManifest } from "../firmware-manifest.mjs";

test("launch is one connect then one explicit install", async () => {
	const html=await readFile(new URL("../index.html",import.meta.url),"utf8");
	assert.match(html,/Plug in your controller/); assert.match(html,/id="connect">Connect/); assert.match(html,/id="install" disabled hidden>Install/);
	assert.doesNotMatch(html,/<select|id="targetSelect"|type="checkbox"|physicalConfirmation|confirmedPrintedModel/); assert.match(html,/target-named Install action confirms the displayed candidate/); assert.match(html,/never starts automatically/);
	assert.match(html,/<details id="advancedDetails">/); assert.match(html,/Buy\. Build\. <em>Rave\.<\/em>/);
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

test("connect inspects once and install reuses the prepared session", async () => {
	const app=await readFile(new URL("../app.mjs",import.meta.url),"utf8");
	const flash=await readFile(new URL("../local-flash.mjs",import.meta.url),"utf8");
	assert.match(app,/connectToController/); assert.match(app,/installConnectedController/); assert.doesNotMatch(app,/window\.confirm/);
	assert.equal((flash.match(/serial\.requestPort\(\)/g)||[]).length,1);
	assert.ok(flash.indexOf("loader.main()") < flash.indexOf("active={token"));
	assert.match(flash,/session\.token !== sessionToken/); assert.match(flash,/eraseAll:false/); assert.match(flash,/health:"unverified"/);
	assert.doesNotMatch(flash,/Flash complete|result:\s*"complete"/i);
});

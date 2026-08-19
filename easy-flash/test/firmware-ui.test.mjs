import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getHardwareArtifacts } from "../firmware-ui.mjs";
import { loadFirmwareManifest } from "../firmware-manifest.mjs";

test("launch is connect-first with a hidden single-controller default and no dead select menu", async () => {
	const html=await readFile(new URL("../index.html",import.meta.url),"utf8");
	assert.match(html,/Plug in your controller/); assert.match(html,/id="connect">Connect\b/); assert.match(html,/id="selectedDeviceNote"/); assert.match(html,/id="deviceToggle" hidden>Different controller/); assert.match(html,/id="deviceSelect" .*hidden>/); assert.match(html,/id="install" disabled hidden>Install/);
	assert.match(html,/this is the controller I selected/); assert.match(html,/computer detected a compatible chip, but cannot prove the board model/);
	assert.match(html,/<details id="advancedDetails">/); assert.match(html,/Buy\. Build\. <em>Rave\.<\/em>/);
	assert.doesNotMatch(html,/Controller<\/span>|Lights<\/span>|Power<\/span>|Review<\/span>|firmwareCards|Download complete|Run safe demo/);
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
	assert.match(flash,/session\.token !== sessionToken/); assert.match(flash,/eraseAll:false/); assert.match(flash,/health:"unverified"/);
	assert.doesNotMatch(flash,/Flash complete|result:\s*"complete"/i);
});

import assert from "node:assert/strict";
import test from "node:test";

import { selectHostedTarget, validateHostedCatalog } from "../hosted-release.mjs";
import {readFile} from "node:fs/promises";
import {renderStatus} from "../maintainer/status.mjs";

const targets = [
	["quinled-dig2go", "QuinLED Dig2Go", "ESP32"],
	["athom-c3-tubes", "Athom ESP32-C3 controller", "ESP32-C3"],
	["waveshare-s3-tubes-remote", "Waveshare ESP32-S3-Touch-AMOLED-2.16", "ESP32-S3"]
];

function manifest() {
	return {schemaVersion: 2, provisional: true, variants: targets.map(([id, board, chip]) => ({
		id, label: board, hardwareTested: false,
		source: {repository: "repo", commit: "a".repeat(40)},
		bootIdentity: {version: 1, target: id, source: "a".repeat(40), release: "16.0.1", tubes: 14},
		target: {hardwareFamily: id, board, chip, flashSizeBytes: chip === "ESP32-S3" ? 16777216 : 4194304},
		artifacts: [{kind: "complete-merged-image", transport: "usb", path: `releases/pr70/firmware/${id}-merged.bin`, offset: 0, sizeBytes: 3, sha256: "a".repeat(64), components: []}]
	}))};
}

test("Status renders shared release evidence once and all three target artifacts",()=>{
	const nodes=[];
	globalThis.document={createElement(){return {children:[],append(...items){this.children.push(...items)},textContent:""}}};
	const root={replaceChildren(...items){nodes.push(...items)}};
	const manifest={provenance:{mode:"fixture"},variants:targets.map(([id,board,chip])=>({id,label:board,hardwareTested:false,source:{repository:"repo",commit:"commit"},target:{board,chip,environment:`env-${id}`},partition:{csv:`${id}.csv`,tableSha256:"b".repeat(64)},artifacts:[{kind:"complete-merged-image",sizeBytes:123,sha256:"a".repeat(64)}]}))};
	renderStatus(root,{current:{releaseId:"pr70",generatedAt:"now"},manifest,receipt:{ci:{runId:"42"}}});
	assert.equal(nodes.length,2);
	assert.equal(nodes[0].children[0].textContent,"Release evidence");
	assert.equal(nodes[1].children[0].textContent,"Supported firmware");
	assert.equal(nodes[1].children[1].children.length,3);
	for(const [,board] of targets){const card=nodes[1].children[1].children.find(node=>node.children?.[0]?.textContent?.includes(board));assert.ok(card,`missing ${board}`);}
	delete globalThis.document;
});


test("catalog admits exactly the three canonical PR #70 hardware targets", () => {
	const catalog = validateHostedCatalog(manifest(), "pr70", "https://flash.test/");
	assert.deepEqual(catalog.map(({variant}) => variant.id), targets.map(([id]) => id));
	assert.throws(() => validateHostedCatalog({...manifest(), variants: manifest().variants.slice(0, 2)}, "pr70", "https://flash.test/"), /exactly three/i);
});

test("target selection binds one exact immutable merged USB image", () => {
	const catalog = validateHostedCatalog(manifest(), "pr70", "https://flash.test/");
	const chosen = selectHostedTarget(catalog, "athom-c3-tubes");
	assert.equal(chosen.variant.target.chip, "ESP32-C3");
	assert.match(chosen.artifact.url, /athom-c3-tubes-merged\.bin$/);
	assert.throws(() => selectHostedTarget(catalog, "esp32-c3"), /unknown target/i);
});

test("wrong chip evidence is rejected when binding every exact target", async () => {
	const {createFlashRuntime} = await import("../local-flash.mjs");
	for (const [id, board, chip] of targets) {
		const port={getInfo:()=>({})};
		class Serial { async requestPort(){return port;} addEventListener(){} }
		class Loader { async main(){return chip === "ESP32-C3" ? "ESP32-S3" : "ESP32-C3";} }
		class Transport { async disconnect(){} }
		const runtime=createFlashRuntime({serial:new Serial(),Loader,TransportClass:Transport,cryptoImpl:{randomUUID:()=>"x"}});
		const evidence=await runtime.connectToController({onStatus(){}});
		assert.throws(()=>runtime.bindConnectedController({evidence,variant:{id,target:{board,chip}},artifact:{sha256:"a".repeat(64),url:"https://flash.test/merged.bin"}}), /does not match/i);
	}
});

test("build boundary maps only exact canonical chip identities for pinned esptool 3.1",async()=>{
	const {pinnedEsptoolChip}=await import("../../scripts/pinned-esptool-chip.mjs");
	assert.equal(pinnedEsptoolChip("ESP32"),"esp32");
	assert.equal(pinnedEsptoolChip("ESP32-C3"),"esp32c3");
	assert.equal(pinnedEsptoolChip("ESP32-S3"),"esp32s3beta2");
	for(const alias of ["esp32s3","esp32s3beta2","S3","ESP32-C6","esp32-c3","generic"])
		assert.throws(()=>pinnedEsptoolChip(alias),/unsupported canonical chip identity/);
});

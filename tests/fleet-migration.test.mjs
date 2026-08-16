import assert from "node:assert/strict";
import test from "node:test";

import { createFleetMigrationState, consumeBatchLine, summarizeFleetMigration, validateMigrationAuthority } from "../scripts/fleet-migration-state.mjs";

test("legacy batch evidence reports only emitted updated, skipped, and failed evidence", () => {
	const state=createFleetMigrationState();
	for (const line of [
		"BATCH_UPGRADE_OK mac=111111111111 profile=dig2go leds=112",
		"SKIPPED mac=222222222222 reason=ambiguous-identity",
		"FAILED mac=444444444444 reason=health-check",
		"BATCH_COMPLETE upgraded=1 migrated=0 skipped=1 failed=1",
	]) consumeBatchLine(state,line);
	const receipt=summarizeFleetMigration(state);
	assert.deepEqual(receipt.counts,{updated:1,skipped:1,failed:1});
	assert.equal("lateOrMissed" in receipt.counts,false);
	assert.equal(receipt.absentFleetStatus,"unknown");
	assert.equal(receipt.fleetCurrent,false);
});

test("fleet migration authority requires the pinned clean upstream checkout and frozen OTA bytes",()=>{
	const lock={repository:"https://github.com/SteveEisner/WLEDtubes.git",commit:"a".repeat(40),environment:"esp32_quinled_dig2go_tubes"};
	const checkout={remote:lock.repository,commit:lock.commit,clean:true};const artifact={sizeBytes:12,sha256:"b".repeat(64)};
	assert.doesNotThrow(()=>validateMigrationAuthority({lock,checkout,artifact,contractArtifact:{lengthBytes:12,sha256:artifact.sha256}}));
	for(const changed of [
		{checkout:{...checkout,commit:"c".repeat(40)}},
		{checkout:{...checkout,clean:false}},
		{checkout:{...checkout,remote:"https://example.test/fork.git"}},
		{artifact:{...artifact,sha256:"d".repeat(64)}},
	]) assert.throws(()=>validateMigrationAuthority({lock,checkout,artifact,contractArtifact:{lengthBytes:12,sha256:"b".repeat(64)},...changed}));
});

test("interrupted migration is a terminal failed receipt", async()=>{
	const {terminalResult}=await import("../scripts/run-fleet-migration.mjs");
	assert.deepEqual(terminalResult({complete:false},null,"SIGINT"),{status:"failed",exitCode:130,signal:"SIGINT"});
	assert.deepEqual(terminalResult({complete:false},null,"SIGTERM"),{status:"failed",exitCode:143,signal:"SIGTERM"});
	assert.deepEqual(terminalResult({complete:true},0,null,"SIGINT"),{status:"failed",exitCode:130,signal:"SIGINT"});
});

test("legacy force migration is explicitly broadcast and delegates to the established batch engine", async () => {
	const source=await import("node:fs/promises").then(({readFile})=>readFile("scripts/run-fleet-migration.mjs","utf8"));
	assert.match(source,/upgrade_batch\.sh/);
	assert.match(source,/legacy-broadcast/);
	assert.match(source,/TUBES_BATCH_PROFILES:"dig2go"/);
	assert.doesNotMatch(source,/target(?:ed)?[_ -]?mac/i);
});

test("operator copy keeps devices powered and distinguishes browser USB from laptop OTA", async () => {
	const html=await import("node:fs/promises").then(({readFile})=>readFile("easy-flash/index.html","utf8"));
	assert.match(html,/Make sure your devices remain plugged in and in range\./);
	assert.match(html,/local laptop adapter/i);
	assert.match(html,/does not mean every Tube you own is current/i);
	assert.match(html,/static site cannot switch Wi-Fi networks or run the legacy OTA service/i);
});

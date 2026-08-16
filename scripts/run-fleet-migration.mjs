#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { createFleetMigrationState, consumeBatchLine, summarizeFleetMigration, validateMigrationAuthority } from "./fleet-migration-state.mjs";

const execFileAsync=promisify(execFile);

export function terminalResult(state,exitCode,signal,interruptedSignal=null) {
	const terminalSignal=interruptedSignal || signal;
	if (terminalSignal) return {status:"failed",exitCode:terminalSignal==="SIGINT"?130:143,signal:terminalSignal};
	const code=exitCode ?? 1;
	return {status:code===0 && state.complete?"completed":"failed",exitCode:code,signal:null};
}

async function sha256File(path) { return createHash("sha256").update(await readFile(path)).digest("hex"); }
async function git(wledtubes,...args) { return (await execFileAsync("git",["-C",wledtubes,...args],{encoding:"utf8"})).stdout.trim(); }

// Pins the delegated updater to the reviewed source and OTA application bytes.
async function verifyAuthority(wledtubes) {
	const lock=JSON.parse(await readFile(new URL("../dependency-lock.json",import.meta.url),"utf8"));
	const contract=JSON.parse(await readFile(resolve(wledtubes,"contracts/update/update-contract.json"),"utf8"));
	const contractArtifact=contract.artifacts.find(({id})=>id==="dig2go-v14-ota-application");
	if (!contractArtifact?.path) throw new Error("Canonical Dig2Go OTA artifact is missing");
	const artifactPath=resolve(wledtubes,contractArtifact.path);
	const info=await stat(artifactPath);
	const checkout={commit:await git(wledtubes,"rev-parse","HEAD"),remote:await git(wledtubes,"config","--get","remote.origin.url"),clean:(await git(wledtubes,"status","--porcelain"))===""};
	const artifact={path:artifactPath,sizeBytes:info.size,sha256:await sha256File(artifactPath)};
	validateMigrationAuthority({lock,checkout,artifact,contractArtifact});
	return {lock,checkout,artifact};
}

// Runs the established OTA batch engine and always writes terminal evidence.
export async function runFleetMigration({serial,wledtubes,receipt}) {
	const runner=resolve(wledtubes,"usermods/Tubes/upgrade_batch.sh");
	await access(runner); await access(serial);
	const authority=await verifyAuthority(wledtubes);
	const firmwareDir=await mkdtemp(resolve(tmpdir(),"easy-flash-migration-"));
	await cp(authority.artifact.path,resolve(firmwareDir,"esp32_quinled_dig2go_tubes.bin"));
	const state=createFleetMigrationState();
	const child=spawn(runner,[serial],{cwd:dirname(runner),env:{...process.env,EASY_FLASH_MIGRATION_MODE:"legacy-broadcast",TUBES_BATCH_PROFILES:"dig2go",TUBES_FIRMWARE_DIR:firmwareDir},stdio:["inherit","pipe","pipe"]});
	for (const stream of [child.stdout,child.stderr]) {
		const lines=createInterface({input:stream});
		lines.on("line",line=>{consumeBatchLine(state,line);(stream===child.stdout?process.stdout:process.stderr).write(`${line}\n`);});
	}
	const closed=new Promise((resolveExit,reject)=>{child.once("error",reject);child.once("close",(code,signal)=>resolveExit({code,signal}));});
	let interruptedSignal=null;
	const forwardInt=()=>{interruptedSignal="SIGINT";if (!child.killed) child.kill("SIGINT");};
	const forwardTerm=()=>{interruptedSignal="SIGTERM";if (!child.killed) child.kill("SIGTERM");};
	process.on("SIGINT",forwardInt); process.on("SIGTERM",forwardTerm);
	const {code,signal}=await closed;
	const terminal=terminalResult(state,code,signal,interruptedSignal);
	const result={...summarizeFleetMigration(state),...terminal,finishedAt:new Date().toISOString(),runner,authority};
	try {
		await mkdir(dirname(receipt),{recursive:true});
		await writeFile(receipt,JSON.stringify(result,null,2)+"\n",{mode:0o600});
	} finally {
		process.removeListener("SIGINT",forwardInt);process.removeListener("SIGTERM",forwardTerm);
		await rm(firmwareDir,{recursive:true,force:true});
	}
	console.log(`Migration receipt: ${receipt}`);
	return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const args=process.argv.slice(2),value=(name)=>{const index=args.indexOf(name);return index<0?undefined:args[index+1];};
	const serial=value("--serial"),wledtubes=resolve(value("--wledtubes") || "../WLEDTubes");
	const receipt=resolve(value("--receipt") || `build/fleet-migration-${Date.now()}.json`);
	if (!serial) throw new Error("usage: npm run migrate:fleet -- --serial /dev/cu.usbserial-… [--wledtubes ../WLEDTubes] [--receipt path]");
	const result=await runFleetMigration({serial,wledtubes,receipt});
	process.exitCode=result.exitCode || (result.counts.failed ? 1 : 0);
}

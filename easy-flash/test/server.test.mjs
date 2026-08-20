import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PassThrough } from "node:stream";
import test from "node:test";
import { createEasyFlashServer } from "../server.mjs";

const server=createEasyFlashServer();
async function request(path){const response=new PassThrough(),chunks=[];response.statusCode=200;response.headers={};response.writeHead=(status,headers={})=>{response.statusCode=status;response.headers=Object.fromEntries(Object.entries(headers).map(([key,value])=>[key.toLowerCase(),String(value)]));return response;};response.on("data",chunk=>chunks.push(chunk));const complete=new Promise((resolve,reject)=>{response.on("finish",resolve);response.on("error",reject);});server.emit("request",{url:path,headers:{}},response);await complete;const bytes=Buffer.concat(chunks);return {status:response.statusCode,headers:{get:name=>response.headers[name.toLowerCase()]??null},text:async()=>bytes.toString("utf8"),json:async()=>JSON.parse(bytes),arrayBuffer:async()=>bytes};}

test("serves the laptop USB prototype without an unverified local-build artifact API", async () => {
	const page = await request(`/`);
	assert.equal(page.status, 200);
	assert.doesNotMatch(await page.text(), /LOCAL USB BETA/);
	assert.equal((await request(`/api/artifact`)).status, 404);
});

test("rejects path traversal", async () => {
	const response = await request(`/%2e%2e/package.json`);
	assert.notEqual(response.status, 200);
});

test("serves verified firmware manifest and transport-specific downloads", async () => {
	const manifestResponse = await request(`/api/firmware-manifest`);
	assert.equal(manifestResponse.status, 200);
	const manifest = await manifestResponse.json();
	assert.equal(manifest.variants.length, 1);
	assert.equal(manifest.variants.flatMap(({ artifacts }) => artifacts).length, 2);
	for (const transport of ["usb", "ota"]) {
		const response = await request(`/api/firmware/previous-stable-control/${transport}`);
		assert.equal(response.status, 200);
		assert.equal(response.headers.get("content-type"), "application/octet-stream");
		assert.match(response.headers.get("content-disposition"), transport === "usb" ? /previous-stable-control-usb-merged\.bin/ : /previous-stable-control-http-ota-app\.bin/);
		const artifact = manifest.variants[0].artifacts.find((item) => item.transport === transport);
		assert.equal(createHash("sha256").update(Buffer.from(await response.arrayBuffer())).digest("hex"), artifact.sha256);
	}
});

test("firmware API rejects misuse and traversal", async () => {
	for (const path of ["/api/firmware/previous-stable-control/serial", "/api/firmware/not-real/usb", "/api/firmware/%2e%2e/usb"]) {
		assert.notEqual((await request(path)).status, 200);
	}
});

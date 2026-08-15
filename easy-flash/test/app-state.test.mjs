import assert from "node:assert/strict";
import test from "node:test";
import { initEasyFlash } from "../app.mjs";
import { createDiagnoseRuntime, parseDiagnosticText } from "../diagnose.mjs";

class Element {
	constructor(doc){this.doc=doc;this.hidden=false;this.disabled=false;this.checked=false;this.textContent="";this.className="";this.listeners={};this.dataset={};}
	addEventListener(type,handler){this.listeners[type]=handler;}
	dispatch(type){return this.listeners[type]?.({target:this});}
	focus(){this.doc.activeElement=this;}
	append(){} replaceChildren(){}
}
function fixture({exactBoard=false}={}) {
	const doc={activeElement:null,documentElement:{dataset:{}},nodes:{},querySelector(selector){return this.nodes[selector];},createElement(){return new Element(this);}};
	for(const id of ["connect","install","physicalConfirmation","confirmedDig2Go","controllerState","controllerStatus","installTitle","instruction","actionNote","technicalDetails","resultPanel","resultTitle","resultMessage"]) doc.nodes[`#${id}`]=new Element(doc);
	doc.nodes["#install"].hidden=true;doc.nodes["#physicalConfirmation"].hidden=true;doc.nodes["#actionNote"].hidden=true;doc.nodes["#resultPanel"].hidden=true;
	const variant={id:"previous-stable-control",label:"Dig2Go",target:{board:"QuinLED Dig2Go"},artifacts:[]},artifact={transport:"usb",kind:"complete-merged-image"};variant.artifacts=[artifact];
	let installs=0,invalidator=null,lastArgs=null;
	const flash={setInvalidationHandler(handler){invalidator=handler;},async connectToController(){return {token:Object.freeze({id:"token"}),port:{id:"port"},chipName:"ESP32",portInfo:{usbVendorId:1,usbProductId:2},exactBoard};},async installConnectedController(args){installs++;lastArgs=args;return {chipName:"ESP32",sha256:"a".repeat(64),backup:"unavailable",writeEvidence:"Write call returned; no readback performed",readbackVerified:false,health:"unverified"};}};
	const releaseLoader=async()=>({releaseId:"test",variant,artifact:{...artifact,url:"https://flash.test/releases/test/firmware/merged.bin"}});const app=initEasyFlash({document:doc,releaseLoader,flash,navigator:{serial:{requestPort(){}}},isSecureContext:true});
	return {doc,app,flash,counts:()=>installs,args:()=>lastArgs,disconnect:()=>invalidator?.()};
}

test("UI seam blocks unchecked confirmation and passes exact target-bound assertion when checked",async()=>{
	const f=fixture();assert.equal(f.doc.nodes["#physicalConfirmation"].hidden,true);await f.app.connect();assert.equal(f.doc.nodes["#physicalConfirmation"].hidden,false);assert.equal(f.doc.activeElement,f.doc.nodes["#confirmedDig2Go"]);assert.match(f.doc.nodes["#controllerStatus"].textContent,/confirm.*then choose Install/i);
	await f.app.install();assert.equal(f.counts(),0);
	f.doc.nodes["#confirmedDig2Go"].checked=true;f.doc.nodes["#confirmedDig2Go"].dispatch("change");await f.app.install();assert.equal(f.counts(),1);
	assert.deepEqual(f.args().physicalConfirmation,{asserted:true,targetId:"previous-stable-control",printedModel:"QuinLED Dig2Go"});assert.equal(f.args().sessionToken.id,"token");assert.equal(f.args().port.id,"port");
});

test("unsupported Web Serial fails before opening a chooser",async()=>{
	const f=fixture();let chooser=0;f.flash.connectToController=async()=>{chooser++;};
	const doc=f.doc;const app=initEasyFlash({document:doc,navigator:{},isSecureContext:true,releaseLoader:async()=>({variant:{},artifact:{}}),flash:f.flash});
	await app.connect();assert.equal(chooser,0);assert.match(doc.nodes["#controllerStatus"].textContent,/Chrome or Edge.*HTTPS/i);
});

test("insecure context fails before opening a chooser",async()=>{
	const f=fixture();let chooser=0;f.flash.connectToController=async()=>{chooser++;};
	const app=initEasyFlash({document:f.doc,navigator:{serial:{requestPort(){}}},isSecureContext:false,releaseLoader:async()=>({variant:{},artifact:{}}),flash:f.flash});
	await app.connect();assert.equal(chooser,0);assert.match(f.doc.nodes["#controllerStatus"].textContent,/HTTPS/i);
});

test("one chooser cancellation leaves the idle reconnect state without a write",async()=>{
	const f=fixture();let chooser=0;f.flash.connectToController=async()=>{chooser++;const error=new Error("cancelled");error.name="NotFoundError";throw error;};
	await f.app.connect();assert.equal(chooser,1);assert.equal(f.counts(),0);assert.equal(f.app.getSelection(),null);assert.equal(f.doc.nodes["#install"].hidden,true);assert.match(f.doc.nodes["#controllerStatus"].textContent,/No controller was selected/i);
});

test("exact evidence focuses Install; disconnect resets confirmation and prevents stale reuse",async()=>{
	const f=fixture({exactBoard:true});await f.app.connect();assert.equal(f.doc.nodes["#physicalConfirmation"].hidden,true);assert.equal(f.doc.activeElement,f.doc.nodes["#install"]);assert.match(f.doc.nodes["#controllerStatus"].textContent,/choose Install/i);
	f.doc.nodes["#confirmedDig2Go"].checked=true;f.disconnect();assert.equal(f.doc.nodes["#confirmedDig2Go"].checked,false);assert.equal(f.doc.nodes["#install"].hidden,true);assert.equal(f.doc.nodes["#install"].disabled,true);assert.equal(f.doc.activeElement,f.doc.nodes["#connect"]);assert.match(f.doc.nodes["#controllerStatus"].textContent,/disconnected.*reconnect/i);await f.app.install();assert.equal(f.counts(),0);
});

test("install failure returns to focused reconnect and success states the no-readback health limitation",async()=>{
	const failed=fixture({exactBoard:true});failed.flash.installConnectedController=async()=>{throw new Error("write failed");};await failed.app.connect();await failed.app.install();assert.equal(failed.app.getSelection(),null);assert.equal(failed.doc.activeElement,failed.doc.nodes["#connect"]);assert.match(failed.doc.nodes["#controllerStatus"].textContent,/Install stopped: write failed.*Reconnect/i);
	const ok=fixture({exactBoard:true});await ok.app.connect();await ok.app.install();assert.equal(ok.counts(),1);assert.match(ok.doc.nodes["#controllerStatus"].textContent,/health proof is unavailable/i);assert.match(ok.doc.nodes["#resultMessage"].textContent,/did not read the flash back.*(?:or automatically|and did not).*prove/i);
});


test("caps diagnostics at raw bytes before decoding non-ASCII chunks", async () => {
  const port = mockPort({ chunks: ["é".repeat(5000)] });
  const result = await createDiagnoseRuntime({ serial: { requestPort: async () => port }, maxBytes: 4 }).inspect();
  assert.equal(new TextEncoder().encode(result.raw).byteLength, 4);
  assert.equal(result.raw, "éé");
});


function mockPort({ chunks = [], rejectRead = false, hang = false } = {}) {
  let released = false;
  let closed = false;
  let cancelled = false;
  const reader = {
    async read() {
      if (rejectRead) throw new Error("device disconnected");
      if (hang) return await new Promise(() => {});
      const chunk = chunks.shift();
      return chunk === undefined ? { done: true } : { value: new TextEncoder().encode(chunk), done: false };
    },
    releaseLock() { released = true; },
    async cancel() { cancelled = true; },
  };
  let isOpen = false;
  return {
    get readable() { return isOpen ? { getReader: () => reader } : null; },
    async open(options) { this.openOptions = options; isOpen = true; },
    async close() { closed = true; },
    getInfo: () => ({ usbVendorId: 1234 }),
    state: () => ({ released, closed, cancelled }),
  };
}

test("parses exact rescue and button banners without broad rescue matches", () => {
  assert.equal(parseDiagnosticText("WLED rescue mode active. Flash over serial, or send 'format'/'reboot'.").rescue, true);
  assert.equal(parseDiagnosticText("AP mode active; no network yet").rescue, false);
  assert.equal(parseDiagnosticText("WLED button diagnostics: STUCK_BUTTON").buttonProblem, true);
  assert.equal(parseDiagnosticText("WLED button diagnostics: healthy").buttonDiagnostics, "healthy");
  assert.equal(parseDiagnosticText("WLED button diagnostics: AVAILABLE").buttonDiagnostics, "available");
  assert.equal(parseDiagnosticText("WLED button diagnostics: INACTIVE").buttonDiagnostics, "inactive");
  assert.equal(parseDiagnosticText("WLED button diagnostics: AVAILABLE").buttonProblem, false);
  assert.equal(parseDiagnosticText("WLED button diagnostics: disabled (WLED_DISABLE_STUCK_BUTTON_DIAGNOSTICS)").buttonDiagnostics, "disabled");
});

test("opens a closed port, reads telemetry, and closes only what it opened", async () => {
  const port = mockPort({ chunks: ["WLED button diagnostics: healthy\n"] });
  const result = await createDiagnoseRuntime({ serial: { requestPort: async () => port } }).inspect();
  assert.equal(port.openOptions.baudRate, 115200);
  assert.equal(result.buttonDiagnostics, "healthy");
  assert.deepEqual(port.state(), { released: true, closed: true, cancelled: false });
});

test("timeout cancels and cleans up the bounded read", async () => {
  const port = mockPort({ hang: true });
  const result = await createDiagnoseRuntime({ serial: { requestPort: async () => port }, timeoutMs: 5 }).inspect();
  assert.equal(result.state, "unsupported");
  assert.deepEqual(port.state(), { released: true, closed: true, cancelled: true });
});

test("missing telemetry is not healthy and disconnect still releases and closes", async () => {
  const port = mockPort({ rejectRead: true });
  const result = await createDiagnoseRuntime({ serial: { requestPort: async () => port } }).inspect();
  assert.equal(result.state, "unsupported");
  assert.deepEqual(port.state(), { released: true, closed: true, cancelled: false });
});

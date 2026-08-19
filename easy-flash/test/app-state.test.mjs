import assert from "node:assert/strict";
import test from "node:test";
import { initEasyFlash } from "../app.mjs";
import { createDiagnoseRuntime, parseDiagnosticText } from "../diagnose.mjs";

class Element {
	constructor(doc){this.doc=doc;this.hidden=false;this.disabled=false;this.checked=false;this.textContent="";this.className="";this.listeners={};this.dataset={};this.value="";}
	addEventListener(type,handler){this.listeners[type]=handler;}
	dispatch(type){return this.listeners[type]?.({target:this});}
	focus(){this.doc.activeElement=this;}
	append(){} replaceChildren(){}
}
function tick(){return new Promise((resolve)=>setTimeout(resolve,0));}
function fixture({exactBoard=false}={}) {
	const doc={activeElement:null,documentElement:{dataset:{}},nodes:{},querySelector(selector){return this.nodes[selector];},createElement(){const el=new Element(this);el.addEventListener=Element.prototype.addEventListener.bind(el);return el;}};
	for(const id of ["connect","install","deviceSelect","deviceOptions","physicalConfirmation","confirmedDig2Go","controllerState","controllerStatus","installTitle","instruction","actionNote","technicalDetails","resultPanel","resultTitle","resultMessage"]) doc.nodes[`#${id}`]=new Element(doc);
	doc.nodes["#install"].hidden=true;doc.nodes["#physicalConfirmation"].hidden=true;doc.nodes["#actionNote"].hidden=true;doc.nodes["#resultPanel"].hidden=true;
	const variant={id:"previous-stable-control",label:"Dig2Go",target:{board:"QuinLED Dig2Go",chip:"ESP32"},artifacts:[]},artifact={transport:"usb",kind:"complete-merged-image"};variant.artifacts=[artifact];
	let installs=0,invalidator=null,lastArgs=null,connects=0;
	const flash={
		setInvalidationHandler(handler){invalidator=handler;},
		async connectToController(){connects++;return {token:Object.freeze({id:"token"}),port:{id:"port"},chipName:"ESP32",chipFamily:"ESP32",portInfo:{usbVendorId:1,usbProductId:2},proof:"chip-only",exactBoard};},
		async installConnectedController(args){installs++;lastArgs=args;return {chipName:"ESP32",sha256:"a".repeat(64),backup:"unavailable",writeEvidence:"Write call returned; no readback performed",readbackVerified:false,health:"unverified"};}
	};
	const releaseLoader=async()=>({releaseId:"test",variant,artifact:{...artifact,url:"https://flash.test/releases/test/firmware/merged.bin"}});
	const app=initEasyFlash({document:doc,releaseLoader,flash,navigator:{serial:{requestPort(){}}},isSecureContext:true});
	return {doc,app,flash,counts:()=>installs,connects:()=>connects,args:()=>lastArgs,disconnect:()=>invalidator?.()};
}

test("connect identifies the chip in one step; install stays gated on confirmation",async()=>{
	const f=fixture();await tick();
	// device auto-selected during load, so connect is enabled
	assert.equal(f.doc.nodes["#connect"].disabled,false);
	await f.app.connect();assert.equal(f.connects(),1);assert.equal(f.doc.nodes["#physicalConfirmation"].hidden,false);assert.match(f.doc.nodes["#controllerStatus"].textContent,/ESP32.*match.*QuinLED Dig2Go/i);
	// unchecked confirmation blocks install
	await f.app.install();assert.equal(f.counts(),0);
	f.doc.nodes["#confirmedDig2Go"].checked=true;f.doc.nodes["#confirmedDig2Go"].dispatch("change");await f.app.install();assert.equal(f.counts(),1);
	assert.deepEqual(f.args().physicalConfirmation,{asserted:true,targetId:"previous-stable-control",printedModel:"QuinLED Dig2Go"});assert.equal(f.args().sessionToken.id,"token");assert.equal(f.args().port.id,"port");
});

test("connect rejects a mismatched chip before install is offered",async()=>{
	const f=fixture();await tick();f.flash.connectToController=async()=>{const error=new Error("This is a ESP32-S3, not the supported ESP32 controller");throw error;};
	await f.app.connect();assert.match(f.doc.nodes["#controllerStatus"].textContent,/ESP32-S3.*not the supported ESP32/i);assert.equal(f.doc.nodes["#physicalConfirmation"].hidden,true);assert.equal(f.doc.nodes["#install"].hidden,true);await f.app.install();assert.equal(f.counts(),0);
});

test("unsupported Web Serial fails before opening a chooser",async()=>{
	const f=fixture();await tick();f.flash.connectToController=async()=>{throw new Error("should not open");};
	const doc=f.doc;const app=initEasyFlash({document:doc,navigator:{},isSecureContext:true,releaseLoader:async()=>({variant:{id:"x",target:{board:"QuinLED Dig2Go",chip:"ESP32"}},artifact:{}}),flash:f.flash});await tick();
	await app.connect();assert.equal(f.connects(),0);assert.match(doc.nodes["#controllerStatus"].textContent,/Chrome or Edge.*HTTPS/i);
});

test("insecure context fails before opening a chooser",async()=>{
	const f=fixture();await tick();f.flash.connectToController=async()=>{throw new Error("should not open");};
	const doc=f.doc;const app=initEasyFlash({document:doc,navigator:{serial:{requestPort(){}}},isSecureContext:false,releaseLoader:async()=>({variant:{id:"x",target:{board:"QuinLED Dig2Go",chip:"ESP32"}},artifact:{}}),flash:f.flash});await tick();
	await app.connect();assert.equal(f.connects(),0);assert.match(doc.nodes["#controllerStatus"].textContent,/HTTPS/i);
});

test("one chooser cancellation leaves the idle reconnect state without a write",async()=>{
	const f=fixture();await tick();let chooser=0;f.flash.connectToController=async()=>{chooser++;const error=new Error("cancelled");error.name="NotFoundError";throw error;};
	await f.app.connect();assert.equal(chooser,1);assert.equal(f.counts(),0);assert.equal(f.app.getSelection(),null);assert.equal(f.doc.nodes["#install"].hidden,true);assert.match(f.doc.nodes["#controllerStatus"].textContent,/No controller was selected/i);
});

test("disconnect resets confirmation and prevents stale install",async()=>{
	const f=fixture({exactBoard:true});await tick();await f.app.connect();
	f.doc.nodes["#confirmedDig2Go"].checked=true;f.disconnect();assert.equal(f.doc.nodes["#confirmedDig2Go"].checked,false);assert.equal(f.doc.nodes["#install"].hidden,true);assert.equal(f.doc.nodes["#install"].disabled,true);assert.equal(f.doc.activeElement,f.doc.nodes["#connect"]);assert.match(f.doc.nodes["#controllerStatus"].textContent,/disconnected.*reconnect/i);await f.app.install();assert.equal(f.counts(),0);
});

test("install failure returns to focused reconnect and success states the no-readback health limitation",async()=>{
	const failed=fixture({exactBoard:true});await tick();failed.flash.installConnectedController=async()=>{throw new Error("write failed");};await failed.app.connect();failed.doc.nodes["#confirmedDig2Go"].checked=true;failed.doc.nodes["#confirmedDig2Go"].dispatch("change");await failed.app.install();assert.equal(failed.app.getSelection(),null);assert.equal(failed.doc.activeElement,failed.doc.nodes["#connect"]);assert.match(failed.doc.nodes["#controllerStatus"].textContent,/Install stopped: write failed.*Reconnect/i);
	const ok=fixture({exactBoard:true});await tick();await ok.app.connect();ok.doc.nodes["#confirmedDig2Go"].checked=true;ok.doc.nodes["#confirmedDig2Go"].dispatch("change");await ok.app.install();assert.equal(ok.counts(),1);assert.match(ok.doc.nodes["#controllerStatus"].textContent,/health proof is unavailable/i);assert.match(ok.doc.nodes["#resultMessage"].textContent,/did not read the flash back.*(?:or automatically|and did not).*prove/i);
});

test("caps diagnostics at raw bytes before decoding non-ASCII chunks", async () => {
  const port = mockPort({ chunks: ["é".repeat(5000)] });
  const result = await createDiagnoseRuntime({ serial: { requestPort: async () => port }, maxBytes: 4 }).inspect();
  assert.equal(new TextEncoder().encode(result.raw).byteLength, 4);
  assert.equal(result.raw, "éé");
});

test("drops incomplete UTF-8 at a one-byte boundary without replacement inflation", async () => {
  const result = await createDiagnoseRuntime({ serial: { requestPort: async () => mockPort({ chunks: ["é"] }) }, maxBytes: 1 }).inspect();
  assert.equal(result.raw, "");
  assert.equal(new TextEncoder().encode(result.raw).byteLength, 0);
});

test("caps oversized chunks while retaining only complete multibyte characters", async () => {
  const result = await createDiagnoseRuntime({ serial: { requestPort: async () => mockPort({ chunks: ["éXYZ"] }) }, maxBytes: 3 }).inspect();
  assert.equal(result.raw, "éX");
  assert.ok(new TextEncoder().encode(result.raw).byteLength <= 3);
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